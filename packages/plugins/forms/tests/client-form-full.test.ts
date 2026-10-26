import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { JSDOM } from "jsdom";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { initForms } from "../src/client/index.js";
import type { PublicFormDefinition } from "../src/public-definition.js";

const definition: PublicFormDefinition = {
	name: "Party",
	slug: "party",
	pages: [{ fields: [] }],
	settings: { submitLabel: "Join" },
	status: "active",
	_turnstileSiteKey: null,
};

vi.mock("emdash/plugin-utils", () => ({ getPublicPluginApiRouteHandler: () => undefined }));
vi.mock("../src/public-definition.js", () => ({
	loadPublicFormDefinition: () => Promise.resolve(definition),
}));

beforeAll(() => {
	const { window } = new JSDOM("", { url: "https://example.com" });
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", window.document);
	vi.stubGlobal("FormData", window.FormData);
	vi.stubGlobal("sessionStorage", window.sessionStorage);
});

afterAll(() => {
	window.close();
	vi.unstubAllGlobals();
});

async function mountForm() {
	const { default: FormEmbed } = await import("../src/astro/FormEmbed.astro");
	const container = await AstroContainer.create();
	document.body.innerHTML = await container.renderToString(FormEmbed, {
		props: { node: { formId: "party" } },
	});
	initForms();
	return {
		form: document.querySelector<HTMLFormElement>("[data-ec-form]")!,
		button: document.querySelector<HTMLButtonElement>(".ec-form-submit")!,
		status: document.querySelector("[data-form-status]")!,
	};
}

describe("submitting to a form that filled up", () => {
	test("shows the organizer's message and stops inviting a retry", async () => {
		const { form, button, status } = await mountForm();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				status: 409,
				json: async () => ({
					success: false,
					error: { code: "FORM_FULL", message: "Sold out, see you next year." },
				}),
			})),
		);

		form.requestSubmit();
		await vi.waitFor(() => expect(button.textContent).toBe("Join"));

		expect(status.textContent).toBe("Sold out, see you next year.");
		expect(status.classList.contains("ec-form-status--closed")).toBe(true);
		expect(button.disabled).toBe(true);
	});

	test("other rejections keep the generic message and leave the button usable", async () => {
		const { form, button, status } = await mountForm();
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				status: 500,
				json: async () => ({
					success: false,
					error: { code: "INTERNAL_ERROR", message: "Database exploded" },
				}),
			})),
		);

		form.requestSubmit();
		await vi.waitFor(() => expect(button.textContent).toBe("Join"));

		expect(status.textContent).toBe("Something went wrong. Please try again.");
		expect(button.disabled).toBe(false);
	});
});
