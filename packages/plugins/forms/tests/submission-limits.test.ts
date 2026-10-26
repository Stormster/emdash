import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleCleanup } from "../src/handlers/cron.js";
import {
	formsCreateHandler,
	formsDuplicateHandler,
	formsUpdateHandler,
} from "../src/handlers/forms.js";
import { submissionDeleteHandler } from "../src/handlers/submissions.js";
import { definitionHandler, submitHandler } from "../src/handlers/submit.js";
import {
	formCreateSchema,
	formDuplicateSchema,
	formUpdateSchema,
	submitSchema,
} from "../src/schemas.js";
import type { FormDefinition, Submission } from "../src/types.js";
import { createFormsStorage, holdFirstCall, type FormsStorage } from "./real-storage.js";

type Storage = FormsStorage["storage"];

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const requestMeta = { ip: "203.0.113.1", userAgent: "test", referer: null, headers: {} };

const nameField = {
	id: "f1",
	type: "text",
	label: "Name",
	name: "name",
	required: true,
	width: "full",
};
const fileField = {
	id: "f2",
	type: "file",
	label: "CV",
	name: "cv",
	required: false,
	width: "full",
	validation: { accept: ".pdf", maxFileSize: 8 },
};

let harness: FormsStorage;

beforeEach(async () => {
	harness = await createFormsStorage();
});

afterEach(async () => {
	await harness.db.destroy();
});

async function createForm(
	settings: Record<string, unknown> = {},
	fields: unknown[] = [nameField],
): Promise<string> {
	const created = await formsCreateHandler({
		input: formCreateSchema.parse({
			name: "Camp",
			slug: "camp",
			pages: [{ fields }],
			settings: { spamProtection: "none", ...settings },
		}),
		storage: harness.storage,
	} as never);
	return created.id;
}

function submit(
	formId: string,
	{
		storage = harness.storage,
		data = { name: "Jane" },
		files,
		...extra
	}: {
		storage?: Storage;
		data?: Record<string, unknown>;
		files?: Record<string, unknown>;
		[key: string]: unknown;
	} = {},
) {
	return submitHandler({
		input: submitSchema.parse({ formId, data, files }),
		storage,
		kv: { get: async () => null },
		log,
		requestMeta,
		...extra,
	} as never);
}

function update(input: Record<string, unknown>) {
	return formsUpdateHandler({
		input: formUpdateSchema.parse(input),
		storage: harness.storage,
		log,
	} as never);
}

function definition(id: string, storage: Storage = harness.storage) {
	return definitionHandler({
		input: { id },
		storage,
		kv: { get: async () => null },
	} as never);
}

async function setCount(formId: string, submissionCount: number) {
	await harness.storage.forms.updateIf(formId, { where: {}, set: { submissionCount } });
}

async function storedForm(formId: string): Promise<FormDefinition> {
	const form = await harness.storage.forms.get(formId);
	if (!form) throw new Error("form missing");
	return form as FormDefinition;
}

async function submissionIds(formId: string): Promise<string[]> {
	const result = await harness.storage.submissions.query({ where: { formId }, limit: 100 });
	return result.items.map((item) => item.id);
}

const formFull = { code: "FORM_FULL", status: 409 };

describe("the last place", () => {
	it("goes to exactly one of two overlapping submissions", async () => {
		const formId = await createForm({ maxSubmissions: 30 });
		await setCount(formId, 29);

		// The first submission reads the form at 29 of 30, then waits at the claim while the second
		// takes the place.
		const held = holdFirstCall(harness.storage.forms, ["updateIf"]);
		const first = submit(formId, {
			storage: { ...harness.storage, forms: held.proxy },
			data: { name: "First" },
		});
		await held.reached;
		await expect(submit(formId, { data: { name: "Second" } })).resolves.toMatchObject({
			success: true,
		});
		held.release();

		await expect(first).rejects.toMatchObject({ ...formFull, message: "This form is full." });
		expect((await storedForm(formId)).submissionCount).toBe(30);
		const saved = await harness.storage.submissions.query({ where: { formId }, limit: 10 });
		expect(saved.items.map((item) => (item.data as Submission).data.name)).toEqual(["Second"]);
	});

	it("rejects with the form's own message when it has one", async () => {
		const formId = await createForm({ maxSubmissions: 1, fullMessage: "All beds are taken." });
		await submit(formId);

		await expect(submit(formId)).rejects.toMatchObject({
			...formFull,
			message: "All beds are taken.",
		});
	});

	it("sends no notification, autoresponder or webhook for a rejected submission", async () => {
		const formId = await createForm({
			maxSubmissions: 1,
			notifyEmails: ["team@example.com"],
			autoresponder: { subject: "Thanks", body: "Got it" },
			webhookUrl: "https://hooks.example.com/camp",
		});
		await setCount(formId, 1);
		const send = vi.fn(async () => {});
		const fetch = vi.fn(async () => new Response(null));

		await expect(submit(formId, { email: { send }, http: { fetch } })).rejects.toMatchObject(
			formFull,
		);

		expect(send).not.toHaveBeenCalled();
		expect(fetch).not.toHaveBeenCalled();
	});

	it("leaves a form without a limit accepting submissions", async () => {
		const formId = await createForm();
		await setCount(formId, 10_000);

		await expect(submit(formId)).resolves.toMatchObject({ success: true });
		expect((await storedForm(formId)).submissionCount).toBe(10_001);
	});
});

describe("a submission that fails after taking a place", () => {
	const pdf = (bytes: number[]) => ({
		cv: { filename: "cv.pdf", contentType: "application/pdf", bytes },
	});

	it("gives the place back when the file type is not allowed", async () => {
		const formId = await createForm({ maxSubmissions: 1 }, [nameField, fileField]);
		const upload = vi.fn();

		await expect(
			submit(formId, {
				files: { cv: { filename: "cv.exe", contentType: "application/x-msdownload", bytes: [1] } },
				media: { upload, delete: vi.fn() },
			}),
		).rejects.toMatchObject({ status: 400 });

		expect(upload).not.toHaveBeenCalled();
		expect((await storedForm(formId)).submissionCount).toBe(0);
		await expect(submit(formId)).resolves.toMatchObject({ success: true });
	});

	it("gives the place back when the file is too large", async () => {
		const formId = await createForm({ maxSubmissions: 1 }, [nameField, fileField]);

		await expect(
			submit(formId, {
				files: pdf([1, 2, 3, 4, 5, 6, 7, 8, 9]),
				media: { upload: vi.fn(), delete: vi.fn() },
			}),
		).rejects.toMatchObject({ status: 400 });

		expect((await storedForm(formId)).submissionCount).toBe(0);
	});

	it("gives the place back when the upload fails", async () => {
		const formId = await createForm({ maxSubmissions: 1 }, [nameField, fileField]);
		const upload = vi.fn(async () => {
			throw new Error("bucket unavailable");
		});

		await expect(
			submit(formId, { files: pdf([1, 2]), media: { upload, delete: vi.fn() } }),
		).rejects.toThrow("bucket unavailable");

		expect((await storedForm(formId)).submissionCount).toBe(0);
		expect(await submissionIds(formId)).toHaveLength(0);
	});

	it("gives the place back when the save fails", async () => {
		const formId = await createForm({ maxSubmissions: 1 }, [nameField, fileField]);
		const upload = vi.fn(async () => ({ mediaId: "m1", storageKey: "k1", url: "/k1" }));
		const failingSubmissions = new Proxy(harness.storage.submissions, {
			get(target, prop) {
				if (prop === "put") {
					return async () => {
						throw new Error("disk full");
					};
				}
				const value: unknown = Reflect.get(target, prop);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});

		await expect(
			submit(formId, {
				storage: { ...harness.storage, submissions: failingSubmissions },
				files: pdf([1, 2]),
				media: { upload, delete: vi.fn() },
			}),
		).rejects.toThrow("disk full");

		expect((await storedForm(formId)).submissionCount).toBe(0);
		expect(await submissionIds(formId)).toHaveLength(0);
	});
});

describe("a full form with a file field", () => {
	it("rejects before uploading the visitor's file", async () => {
		const formId = await createForm({ maxSubmissions: 1 }, [nameField, fileField]);
		await setCount(formId, 1);
		const upload = vi.fn(async () => ({ mediaId: "m1", storageKey: "k1", url: "/k1" }));

		await expect(
			submit(formId, {
				files: { cv: { filename: "cv.pdf", contentType: "application/pdf", bytes: [1, 2] } },
				media: { upload, delete: vi.fn() },
			}),
		).rejects.toMatchObject(formFull);

		expect(upload).not.toHaveBeenCalled();
		expect((await storedForm(formId)).submissionCount).toBe(1);
	});
});

describe("submissions that never reach the inbox", () => {
	it("do not take a place when the honeypot catches them", async () => {
		const formId = await createForm({ maxSubmissions: 1, spamProtection: "honeypot" });

		await expect(submit(formId, { data: { name: "Bot", _hp: "x" } })).resolves.toMatchObject({
			success: true,
		});

		expect((await storedForm(formId)).submissionCount).toBe(0);
		expect(await submissionIds(formId)).toHaveLength(0);
		await expect(submit(formId)).resolves.toMatchObject({ success: true });
	});

	it("do not take a place when they fail validation", async () => {
		const formId = await createForm({ maxSubmissions: 1 });

		await expect(submit(formId, { data: {} })).resolves.toMatchObject({ success: false });

		expect((await storedForm(formId)).submissionCount).toBe(0);
	});
});

describe("freeing a place", () => {
	it("reopens a full form when a submission is deleted", async () => {
		const formId = await createForm({ maxSubmissions: 1 });
		await submit(formId);
		await expect(submit(formId)).rejects.toMatchObject(formFull);

		const [id] = await submissionIds(formId);
		await submissionDeleteHandler({ input: { id }, storage: harness.storage } as never);

		await expect(submit(formId)).resolves.toMatchObject({ success: true });
		expect((await storedForm(formId)).submissionCount).toBe(1);
	});

	it("reopens a full form when retention cleanup deletes old submissions", async () => {
		const formId = await createForm({ maxSubmissions: 1, retentionDays: 30 });
		await submit(formId);
		const [id] = await submissionIds(formId);
		const sub = (await harness.storage.submissions.get(id!)) as Submission;
		const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
		await harness.storage.submissions.put(id!, { ...sub, createdAt: old });

		await handleCleanup({ storage: harness.storage, log } as never);

		await expect(submit(formId)).resolves.toMatchObject({ success: true });
	});
});

describe("changing the limit", () => {
	it("reopens a full form when the limit is raised", async () => {
		const formId = await createForm({ maxSubmissions: 1 });
		await submit(formId);
		await expect(submit(formId)).rejects.toMatchObject(formFull);

		await update({ id: formId, settings: { maxSubmissions: 2 } });

		await expect(submit(formId)).resolves.toMatchObject({ success: true });
		expect((await storedForm(formId)).submissionCount).toBe(2);
	});

	it("closes the form and keeps its submissions when the limit is lowered below the count", async () => {
		const formId = await createForm({ maxSubmissions: 5 });
		await submit(formId);
		await submit(formId);

		await update({ id: formId, settings: { maxSubmissions: 1 } });

		await expect(submit(formId)).rejects.toMatchObject(formFull);
		expect(await submissionIds(formId)).toHaveLength(2);
		expect((await storedForm(formId)).submissionCount).toBe(2);
	});

	it("removes the limit when it is cleared with null", async () => {
		const formId = await createForm({ maxSubmissions: 1 });
		await submit(formId);

		const updated = await update({ id: formId, settings: { maxSubmissions: null } });

		expect(updated.settings).not.toHaveProperty("maxSubmissions");
		expect((await storedForm(formId)).settings).not.toHaveProperty("maxSubmissions");
		await expect(submit(formId)).resolves.toMatchObject({ success: true });
	});

	it("clears the limit and the autoresponder together when both are sent as null", async () => {
		const formId = await createForm({
			maxSubmissions: 1,
			autoresponder: { subject: "Thanks", body: "See you at camp" },
		});
		await submit(formId);

		await update({
			id: formId,
			settings: { maxSubmissions: null, autoresponder: null, submitLabel: "Sign up" },
		});

		const settings = (await storedForm(formId)).settings;
		expect(settings).not.toHaveProperty("maxSubmissions");
		expect(settings).not.toHaveProperty("autoresponder");
		expect(settings.submitLabel).toBe("Sign up");
		await expect(submit(formId)).resolves.toMatchObject({ success: true });
	});

	it("keeps the limit when only the autoresponder is cleared", async () => {
		const formId = await createForm({
			maxSubmissions: 1,
			autoresponder: { subject: "Thanks", body: "See you at camp" },
		});
		await submit(formId);

		await update({ id: formId, settings: { autoresponder: null } });

		const settings = (await storedForm(formId)).settings;
		expect(settings).not.toHaveProperty("autoresponder");
		expect(settings.maxSubmissions).toBe(1);
		await expect(submit(formId)).rejects.toMatchObject(formFull);
	});

	it("keeps the autoresponder when only the limit is cleared", async () => {
		const autoresponder = { subject: "Thanks", body: "See you at camp" };
		const formId = await createForm({ maxSubmissions: 1, autoresponder });

		await update({ id: formId, settings: { maxSubmissions: null } });

		const settings = (await storedForm(formId)).settings;
		expect(settings).not.toHaveProperty("maxSubmissions");
		expect(settings.autoresponder).toEqual(autoresponder);
	});

	it("keeps the limit when other settings are saved", async () => {
		const formId = await createForm({ maxSubmissions: 3, fullMessage: "No beds left." });

		await update({ id: formId, settings: { submitLabel: "Sign up" } });

		expect((await storedForm(formId)).settings).toMatchObject({
			maxSubmissions: 3,
			fullMessage: "No beds left.",
			submitLabel: "Sign up",
		});
	});

	it("drops an emptied full message so visitors see the default", async () => {
		const formId = await createForm({ maxSubmissions: 1, fullMessage: "No beds left." });
		await submit(formId);

		await update({ id: formId, settings: { fullMessage: "" } });

		expect((await storedForm(formId)).settings).not.toHaveProperty("fullMessage");
		await expect(submit(formId)).rejects.toMatchObject({
			...formFull,
			message: "This form is full.",
		});
	});

	it("stores no empty full message on create", async () => {
		const formId = await createForm({ maxSubmissions: 1, fullMessage: "" });

		expect((await storedForm(formId)).settings).not.toHaveProperty("fullMessage");
	});
});

describe("a paused form with a limit", () => {
	it("returns FORM_PAUSED whether or not places are left", async () => {
		const formId = await createForm({ maxSubmissions: 1 });
		await update({ id: formId, status: "paused" });
		await expect(submit(formId)).rejects.toMatchObject({ code: "FORM_PAUSED", status: 410 });

		await setCount(formId, 1);
		await expect(submit(formId)).rejects.toMatchObject({ code: "FORM_PAUSED", status: 410 });
		await expect(definition(formId)).rejects.toMatchObject({ code: "FORM_PAUSED", status: 410 });
	});

	it("rejects a submission that started before the form was paused", async () => {
		const formId = await createForm();

		const held = holdFirstCall(harness.storage.forms, ["updateIf"]);
		const pending = submit(formId, { storage: { ...harness.storage, forms: held.proxy } });
		await held.reached;
		await update({ id: formId, status: "paused" });
		held.release();

		await expect(pending).rejects.toMatchObject({ code: "FORM_PAUSED", status: 410 });
		expect((await storedForm(formId)).submissionCount).toBe(0);
		expect(await submissionIds(formId)).toHaveLength(0);
	});
});

describe("the public definition", () => {
	it("is unchanged for a form without a limit", async () => {
		const formId = await createForm({ submitLabel: "Send" });

		const def = await definition(formId);

		expect(def).toEqual({
			name: "Camp",
			slug: "camp",
			pages: (await storedForm(formId)).pages,
			settings: { spamProtection: "none", submitLabel: "Send" },
			status: "active",
			_turnstileSiteKey: null,
		});
		expect(def).not.toHaveProperty("full");
		expect(def).not.toHaveProperty("remaining");
		expect(def.settings).not.toHaveProperty("fullMessage");
	});

	it("reports places left without the count unless remaining places are shown", async () => {
		const formId = await createForm({ maxSubmissions: 2 });
		await submit(formId);

		const def = await definition(formId);

		expect(def.full).toBe(false);
		expect(def).not.toHaveProperty("remaining");
		expect(def.settings.fullMessage).toBe("This form is full.");
	});

	it("reports the remaining places when the form shows them", async () => {
		const formId = await createForm({ maxSubmissions: 2, showRemaining: true });
		await submit(formId);
		expect(await definition(formId)).toMatchObject({ full: false, remaining: 1 });

		await submit(formId);
		expect(await definition(formId)).toMatchObject({ full: true, remaining: 0 });
	});

	it("reports a full form with its own message", async () => {
		const formId = await createForm({ maxSubmissions: 1, fullMessage: "All beds are taken." });
		await setCount(formId, 3);

		const def = await definition(formId);

		expect(def.full).toBe(true);
		expect(def.settings.fullMessage).toBe("All beds are taken.");
	});

	it("reads only the form document", async () => {
		const formId = await createForm({ maxSubmissions: 2, showRemaining: true });
		const calls: string[] = [];
		const counted = new Proxy(harness.storage.forms, {
			get(target, prop) {
				const value: unknown = Reflect.get(target, prop);
				if (typeof value !== "function") return value;
				return (...args: unknown[]) => {
					calls.push(String(prop));
					return (value as (...a: unknown[]) => unknown).apply(target, args);
				};
			},
		});

		await definition(formId, { ...harness.storage, forms: counted });

		expect(calls).toEqual(["get"]);
	});
});

describe("duplicating a form with a limit", () => {
	it("copies the limit and starts the copy with every place free", async () => {
		const formId = await createForm({
			maxSubmissions: 1,
			fullMessage: "No beds left.",
			showRemaining: true,
		});
		await submit(formId);

		const copy = await formsDuplicateHandler({
			input: formDuplicateSchema.parse({ id: formId }),
			storage: harness.storage,
		} as never);

		const stored = await storedForm(copy.id);
		expect(stored.submissionCount).toBe(0);
		expect(stored.settings).toMatchObject({
			maxSubmissions: 1,
			fullMessage: "No beds left.",
			showRemaining: true,
		});
		await expect(submit(copy.id)).resolves.toMatchObject({ success: true });
		await expect(submit(copy.id)).rejects.toMatchObject(formFull);
	});
});
