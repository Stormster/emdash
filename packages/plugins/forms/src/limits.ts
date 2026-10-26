import type { FormDefinition } from "./types.js";

export const DEFAULT_FULL_MESSAGE = "This form is full.";

/** Places left on a form with a limit, or `undefined` when it has none. */
export function placesRemaining(form: FormDefinition): number | undefined {
	const max = form.settings.maxSubmissions;
	if (max === undefined) return undefined;
	return Math.max(0, max - form.submissionCount);
}
