import { describe, expect, it } from "vitest";

import { exportSchema, formCreateSchema, formUpdateSchema } from "../src/schemas.js";

describe("exportSchema", () => {
	it("accepts minute-precision ISO datetime bounds", () => {
		const from = "2026-09-01T14:30Z";
		const to = "2026-09-01T15:30Z";
		expect(exportSchema.parse({ formId: "contact", format: "csv", from, to })).toEqual({
			formId: "contact",
			format: "csv",
			from,
			to,
		});
	});
});

describe("formUpdateSchema", () => {
	it("leaves settings the caller did not send alone", () => {
		// A partial settings update must not carry defaults for the keys it omits: the update handler
		// merges the parse result over the stored settings, so an injected `spamProtection: "honeypot"`
		// silently turns off a form's Turnstile when all the caller wanted was a new notification address.
		const parsed = formUpdateSchema.parse({
			id: "01JBQ8Z0000000000000000000",
			settings: { notifyEmails: ["editor@example.com"] },
		});

		expect(parsed.settings).toEqual({ notifyEmails: ["editor@example.com"] });
	});

	it("still validates the settings it is given", () => {
		expect(() =>
			formUpdateSchema.parse({
				id: "01JBQ8Z0000000000000000000",
				settings: { spamProtection: "captcha" },
			}),
		).toThrow();
	});
});

const createInput = (settings: Record<string, unknown>) => ({
	name: "Contact",
	slug: "contact",
	pages: [
		{
			fields: [
				{
					id: "email",
					name: "email",
					label: "Email",
					type: "email",
					required: true,
					width: "full",
				},
			],
		},
	],
	settings,
});

describe("submission limit settings", () => {
	const id = "01JBQ8Z0000000000000000000";

	it("accept a whole-number limit of at least 1, a full message and the remaining-places switch", () => {
		const settings = { maxSubmissions: 30, fullMessage: "No beds left.", showRemaining: true };
		expect(formCreateSchema.parse(createInput(settings)).settings).toMatchObject(settings);
		expect(formUpdateSchema.parse({ id, settings }).settings).toEqual(settings);
	});

	it("reject a limit below 1, a fraction, or a number sent as text", () => {
		for (const maxSubmissions of [0, -1, 1.5, "30"]) {
			expect(formCreateSchema.safeParse(createInput({ maxSubmissions })).success).toBe(false);
			expect(formUpdateSchema.safeParse({ id, settings: { maxSubmissions } }).success).toBe(false);
		}
	});

	it("accept null to clear the limit on update only", () => {
		expect(formUpdateSchema.parse({ id, settings: { maxSubmissions: null } }).settings).toEqual({
			maxSubmissions: null,
		});
		expect(formCreateSchema.safeParse(createInput({ maxSubmissions: null })).success).toBe(false);
	});

	it("accept an empty full message", () => {
		expect(formUpdateSchema.parse({ id, settings: { fullMessage: "" } }).settings).toEqual({
			fullMessage: "",
		});
	});

	it("leave a form without a limit when none is sent", () => {
		const parsed = formCreateSchema.parse(createInput({}));
		expect(parsed.settings).not.toHaveProperty("maxSubmissions");
		expect(parsed.settings).not.toHaveProperty("showRemaining");
	});
});

describe("formCreateSchema", () => {
	it("applies the settings defaults", () => {
		const parsed = formCreateSchema.parse(createInput({}));

		expect(parsed.settings).toMatchObject({
			confirmationMessage: "Thank you for your submission.",
			notifyEmails: [],
			digestEnabled: false,
			digestHour: 9,
			retentionDays: 0,
			spamProtection: "honeypot",
			submitLabel: "Submit",
		});
	});
});
