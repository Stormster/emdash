// @vitest-environment jsdom
import { setupI18n, type Messages } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pages } from "../src/admin.js";

type Props = {
	label?: React.ReactNode;
	description?: React.ReactNode;
	value?: string;
	placeholder?: string;
	checked?: boolean;
	onChange?: React.ChangeEventHandler<never>;
	onCheckedChange?: (checked: boolean) => void;
	onClick?: React.MouseEventHandler;
	children?: React.ReactNode;
	"aria-label"?: string;
};

vi.mock("@cloudflare/kumo", () => ({
	Badge: ({ children }: Props) => <span>{children}</span>,
	Button: ({ children, onClick, "aria-label": ariaLabel }: Props) => (
		<button type="button" onClick={onClick} aria-label={ariaLabel}>
			{children}
		</button>
	),
	Checkbox: ({ label, checked, onCheckedChange }: Props) => (
		<label>
			{label}
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onCheckedChange?.(e.target.checked)}
			/>
		</label>
	),
	Input: ({ label, description, value, onChange, placeholder }: Props) => (
		<div>
			<label>
				{label}
				<input value={value} onChange={onChange} placeholder={placeholder} />
			</label>
			<div>{description}</div>
		</div>
	),
	InputArea: ({ label, description, value, onChange, placeholder }: Props) => (
		<div>
			<label>
				{label}
				<textarea value={value} onChange={onChange} placeholder={placeholder} />
			</label>
			<div>{description}</div>
		</div>
	),
	Loader: () => <div role="status" aria-label="Loading" />,
	Select: ({ label, value }: Props) => <div>{label ?? value}</div>,
}));

let updates: Array<{ route: string; body: Record<string, unknown> }> = [];

function makeForm(id: string, settings: Record<string, unknown>) {
	return {
		id,
		name: `Form ${id}`,
		slug: `form-${id}`,
		status: "active",
		submissionCount: 12,
		lastSubmissionAt: null,
		createdAt: "2026-10-01T00:00:00.000Z",
		updatedAt: "2026-10-01T00:00:00.000Z",
		pages: [
			{
				fields: [
					{ id: "f1", type: "text", label: "Name", name: "name", required: false, width: "full" },
				],
			},
		],
		settings: {
			confirmationMessage: "Thanks",
			notifyEmails: [],
			digestEnabled: false,
			digestHour: 9,
			retentionDays: 0,
			spamProtection: "honeypot",
			submitLabel: "Submit",
			...settings,
		},
	};
}

function stubForms(forms: ReturnType<typeof makeForm>[]) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const route = url.split("/emdash-forms/")[1] ?? url;
			if (route === "forms/list") {
				return new Response(JSON.stringify({ success: true, data: { items: forms } }));
			}
			updates.push({ route, body: JSON.parse(init?.body as string) });
			return new Response(JSON.stringify({ success: true, data: {} }));
		}),
	);
}

beforeEach(() => {
	updates = [];
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const FormsListPage = pages!["/"]!;

async function openEditor(name: string) {
	render(<FormsListPage />);
	const row = (await screen.findByText(name)).closest("tr")!;
	fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
}

function limitInput(): HTMLInputElement {
	return screen.getByLabelText("Maximum submissions") as HTMLInputElement;
}

describe("forms list", () => {
	it("shows taken places against the limit, and the plain count without one", async () => {
		stubForms([makeForm("a", { maxSubmissions: 30 }), makeForm("b", {})]);
		render(<FormsListPage />);

		const limited = (await screen.findByText("Form a")).closest("tr")!;
		const unlimited = screen.getByText("Form b").closest("tr")!;
		expect(within(limited).getByText("12 / 30")).toBeTruthy();
		expect(within(unlimited).getByText("12")).toBeTruthy();
		expect(within(unlimited).queryByText(/\//)).toBeNull();
	});
});

describe("form editor submission limit", () => {
	it("shows the current limit, how many places are taken and the help text", async () => {
		stubForms([makeForm("a", { maxSubmissions: 30 })]);
		await openEditor("Form a");

		expect(limitInput().value).toBe("30");
		expect(screen.getByText("12 of 30 places taken")).toBeTruthy();
		expect(screen.getByText(/Leave empty for no limit\./)).toBeTruthy();
	});

	it("sends null when a limit that was set is cleared, so the merge drops it", async () => {
		stubForms([makeForm("a", { maxSubmissions: 30 })]);
		await openEditor("Form a");

		fireEvent.change(limitInput(), { target: { value: "" } });
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await vi.waitFor(() => expect(updates).toHaveLength(1));
		expect(updates[0]!.route).toBe("forms/update");
		expect((updates[0]!.body.settings as Record<string, unknown>).maxSubmissions).toBeNull();
	});

	it("sends the new number when the limit is changed", async () => {
		stubForms([makeForm("a", { maxSubmissions: 30 })]);
		await openEditor("Form a");

		fireEvent.change(limitInput(), { target: { value: "50" } });
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await vi.waitFor(() => expect(updates).toHaveLength(1));
		expect((updates[0]!.body.settings as Record<string, unknown>).maxSubmissions).toBe(50);
	});

	it("does not send a limit for a form that never had one", async () => {
		stubForms([makeForm("a", {})]);
		await openEditor("Form a");
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await vi.waitFor(() => expect(updates).toHaveLength(1));
		expect(updates[0]!.body.settings).not.toHaveProperty("maxSubmissions");
	});

	it("does not send null when creating a form", async () => {
		stubForms([]);
		render(<FormsListPage />);
		fireEvent.click((await screen.findAllByRole("button", { name: /Create Form/ }))[0]!);

		fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Party" } });
		fireEvent.click(screen.getByRole("button", { name: /Add Field/ }));
		fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Guest" } });
		fireEvent.click(screen.getByRole("button", { name: "Create Form" }));

		await vi.waitFor(() => expect(updates).toHaveLength(1));
		expect(updates[0]!.route).toBe("forms/create");
		expect(updates[0]!.body.settings).not.toHaveProperty("maxSubmissions");
	});

	it("saves the full message and show-remaining choice with the limit", async () => {
		stubForms([makeForm("a", {})]);
		await openEditor("Form a");

		fireEvent.change(limitInput(), { target: { value: "20" } });
		const message = screen.getByLabelText("Message when full") as HTMLTextAreaElement;
		expect(message.placeholder).toBe("This form is full.");
		fireEvent.change(message, { target: { value: "Sold out, see you next year." } });
		fireEvent.click(screen.getByLabelText("Show remaining places"));
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await vi.waitFor(() => expect(updates).toHaveLength(1));
		expect(updates[0]!.body.settings).toMatchObject({
			maxSubmissions: 20,
			fullMessage: "Sold out, see you next year.",
			showRemaining: true,
		});
	});

	it("notes that deleting old submissions frees places only with both a limit and retention", async () => {
		const note = "Deleting old submissions frees their places.";

		stubForms([makeForm("a", { maxSubmissions: 30, retentionDays: 90 })]);
		await openEditor("Form a");
		expect(screen.getByText(note)).toBeTruthy();
		cleanup();

		stubForms([makeForm("b", { retentionDays: 90 })]);
		await openEditor("Form b");
		expect(screen.queryByText(note)).toBeNull();
		cleanup();

		stubForms([makeForm("c", { maxSubmissions: 30 })]);
		await openEditor("Form c");
		expect(screen.queryByText(note)).toBeNull();
	});
});

describe("with the admin's Lingui context", () => {
	function renderWithCatalog(messages: Messages, { production = false } = {}) {
		// Outside production Lingui compiles a missing message at runtime; a production host does not.
		if (production) vi.stubEnv("NODE_ENV", "production");
		const i18n = setupI18n({ locale: "de", messages: { de: messages } });
		vi.unstubAllEnvs();
		render(
			<I18nProvider i18n={i18n}>
				<FormsListPage />
			</I18nProvider>,
		);
	}

	async function openEditorWithCatalog(name: string, messages: Messages, options = {}) {
		renderWithCatalog(messages, options);
		const row = (await screen.findByText(name)).closest("tr")!;
		fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
	}

	it("shows the limit settings in the admin's language", async () => {
		stubForms([makeForm("a", { maxSubmissions: 30, retentionDays: 90 })]);
		await openEditorWithCatalog("Form a", {
			"Maximum submissions": "Maximale Einsendungen",
			"Leave empty for no limit.": "Leer lassen für kein Limit.",
			"{taken} of {max} places taken": ["", ["taken"], " von ", ["max"], " Plätzen belegt"],
			"Message when full": "Nachricht, wenn voll",
			"Visitors see this instead of the form once every place is taken.":
				"Besucher sehen dies statt des Formulars, sobald alle Plätze belegt sind.",
			"Show remaining places": "Freie Plätze anzeigen",
			'Shows visitors how many places are left, for example "3 places left".':
				'Zeigt Besuchern, wie viele Plätze frei sind, zum Beispiel "3 Plätze frei".',
			"Deleting old submissions frees their places.":
				"Das Löschen alter Einsendungen gibt ihre Plätze frei.",
		});

		expect(screen.getByLabelText("Maximale Einsendungen")).toBeTruthy();
		expect(screen.getByText("Leer lassen für kein Limit.")).toBeTruthy();
		expect(screen.getByText("12 von 30 Plätzen belegt")).toBeTruthy();
		expect(screen.getByLabelText("Nachricht, wenn voll")).toBeTruthy();
		expect(
			screen.getByText("Besucher sehen dies statt des Formulars, sobald alle Plätze belegt sind."),
		).toBeTruthy();
		expect(screen.getByLabelText("Freie Plätze anzeigen")).toBeTruthy();
		expect(
			screen.getByText(
				'Zeigt Besuchern, wie viele Plätze frei sind, zum Beispiel "3 Plätze frei".',
			),
		).toBeTruthy();
		expect(screen.getByText("Das Löschen alter Einsendungen gibt ihre Plätze frei.")).toBeTruthy();
	});

	it("shows the taken count in the forms list in the admin's language", async () => {
		stubForms([makeForm("a", { maxSubmissions: 30 })]);
		renderWithCatalog({ "{taken} / {max}": [["taken"], " von ", ["max"]] });

		const row = (await screen.findByText("Form a")).closest("tr")!;
		expect(within(row).getByText("12 von 30")).toBeTruthy();
	});

	it("fills in the counts when a production host's catalog does not have the new messages yet", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		stubForms([makeForm("a", { maxSubmissions: 30 })]);
		await openEditorWithCatalog("Form a", {}, { production: true });

		expect(screen.getByText("12 of 30 places taken")).toBeTruthy();
		expect(screen.queryByText(/\{taken\}|\{max\}/)).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		const row = (await screen.findByText("Form a")).closest("tr")!;
		expect(within(row).getByText("12 / 30")).toBeTruthy();
	});
});
