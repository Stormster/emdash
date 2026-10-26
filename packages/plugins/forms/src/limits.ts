import type { FormDefinition } from "./types.js";

export const DEFAULT_FULL_MESSAGE = "This form is full.";

/** The form's submission limit, or `undefined` when it has none. */
export function submissionLimit(form: FormDefinition): number | undefined {
	const max = form.settings.maxSubmissions;
	return typeof max === "number" ? max : undefined;
}

/** Places left on a form with a limit, or `undefined` when it has none. */
export function placesRemaining(form: FormDefinition): number | undefined {
	const max = submissionLimit(form);
	if (max === undefined) return undefined;
	return Math.max(0, max - form.submissionCount);
}
