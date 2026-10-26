import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import type { PublicFormDefinition } from "../src/public-definition.js";

let definition: PublicFormDefinition;

vi.mock("emdash/plugin-utils", () => ({ getPublicPluginApiRouteHandler: () => undefined }));
vi.mock("../src/public-definition.js", () => ({
	loadPublicFormDefinition: () => Promise.resolve(definition),
}));

beforeEach(() => {
	definition = {
		name: "Party",
		slug: "party",
		pages: [{ fields: [] }],
		settings: { submitLabel: "Join" },
		status: "active",
		_turnstileSiteKey: null,
	};
});

async function render(): Promise<Document> {
	const { default: FormEmbed } = await import("../src/astro/FormEmbed.astro");
	const container = await AstroContainer.create();
	const html = await container.renderToString(FormEmbed, { props: { node: { formId: "party" } } });
	return new DOMParser().parseFromString(html, "text/html");
}

beforeAll(async () => {
	const { JSDOM } = await import("jsdom");
	vi.stubGlobal("DOMParser", new JSDOM().window.DOMParser);
});

afterAll(() => {
	vi.unstubAllGlobals();
});

describe("FormEmbed submission limit", () => {
	test("a full form shows the organizer's message instead of the form", async () => {
		definition.full = true;
		definition.settings.fullMessage = "Sold out, see you next year.";
		const doc = await render();

		expect(doc.querySelector("[data-ec-form]")).toBeNull();
		expect(doc.querySelector(".ec-form-submit")).toBeNull();
		expect(doc.body.textContent).toContain("Sold out, see you next year.");
	});

	test("a full form does not also show a places-left line", async () => {
		definition.full = true;
		definition.remaining = 0;
		definition.settings.fullMessage = "This form is full.";
		const doc = await render();

		expect(doc.body.textContent).not.toContain("places left");
	});

	test("shows how many places are left above the form", async () => {
		definition.remaining = 3;
		const doc = await render();

		const form = doc.querySelector("[data-ec-form]")!;
		expect(form).not.toBeNull();
		const note = [...doc.querySelectorAll("p")].find((p) =>
			p.textContent?.includes("3 places left"),
		)!;
		expect(note).toBeDefined();
		expect(note.compareDocumentPosition(form) & 4).toBeTruthy();
	});

	test("says '1 place left' in the singular", async () => {
		definition.remaining = 1;
		const doc = await render();

		expect(doc.body.textContent).toContain("1 place left");
		expect(doc.body.textContent).not.toContain("1 places left");
	});

	test("a form with no limit renders just the form", async () => {
		const doc = await render();

		expect(doc.querySelector("[data-ec-form]")).not.toBeNull();
		expect(doc.body.textContent).not.toMatch(/places? left/);
		expect(doc.querySelector("[role=status]")).toBeNull();
	});
});
