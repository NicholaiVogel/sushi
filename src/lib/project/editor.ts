/**
 * Return one gutter entry for every logical source line.
 *
 * Keeping this separate from the rendered editor makes the line model easy to
 * test and ensures an empty source still has a visible first line.
 */
export function getSourceLineNumbers(source: string): number[] {
	return Array.from({ length: Math.max(1, source.split('\n').length) }, (_, index) => index + 1);
}

export interface SourceTextReplacement {
	source: string;
	caret: number;
}

/**
 * Replace a textarea selection while keeping the caret immediately after the
 * inserted text. Clipboard events expose selection offsets rather than the
 * selected text, so keeping this operation pure makes paste behavior easy to
 * exercise without a browser runtime.
 */
export function replaceSourceSelection(
	source: string,
	inserted: string,
	selectionStart: number,
	selectionEnd = selectionStart,
): SourceTextReplacement {
	const clamp = (value: number) => Math.max(0, Math.min(source.length, Number.isFinite(value) ? value : 0));
	const first = clamp(selectionStart);
	const second = clamp(selectionEnd);
	const start = Math.min(first, second);
	const end = Math.max(first, second);
	return {
		source: `${source.slice(0, start)}${inserted}${source.slice(end)}`,
		caret: start + inserted.length,
	};
}
