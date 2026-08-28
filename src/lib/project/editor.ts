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

export interface SourceEditorEdit {
	source: string;
	selectionStart: number;
	selectionEnd: number;
}

export const SOURCE_EDITOR_INDENT = '  ';

const SOURCE_EDITOR_DELIMITERS: Record<string, string> = {
	'(': ')',
	'[': ']',
	'{': '}',
};

function clampOffset(source: string, value: number): number {
	return Math.max(0, Math.min(source.length, Number.isFinite(value) ? value : 0));
}

function normalizedSelection(source: string, selectionStart: number, selectionEnd: number): { start: number; end: number } {
	const first = clampOffset(source, selectionStart);
	const second = clampOffset(source, selectionEnd);
	return { start: Math.min(first, second), end: Math.max(first, second) };
}

/**
 * Insert a matching closing delimiter and leave the caret inside the pair.
 * When text is selected, the pair wraps that selection just like an IDE.
 */
export function insertSourceDelimiterPair(
	source: string,
	delimiter: string,
	selectionStart: number,
	selectionEnd = selectionStart,
): SourceEditorEdit | undefined {
	const closing = SOURCE_EDITOR_DELIMITERS[delimiter];
	if (!closing) return undefined;
	const selection = normalizedSelection(source, selectionStart, selectionEnd);
	const nextSource = `${source.slice(0, selection.start)}${delimiter}${source.slice(selection.start, selection.end)}${closing}${source.slice(selection.end)}`;
	return {
		source: nextSource,
		selectionStart: selection.start + 1,
		selectionEnd: selection.end + 1,
	};
}

/**
 * Consume a closing delimiter when it is already immediately after the
 * caret. This prevents typing `)` or `]` after an auto-closed pair from
 * producing a duplicate character.
 */
export function skipSourceClosingDelimiter(
	source: string,
	delimiter: string,
	selectionStart: number,
	selectionEnd = selectionStart,
): SourceEditorEdit | undefined {
	const selection = normalizedSelection(source, selectionStart, selectionEnd);
	if (selection.start !== selection.end || source[selection.start] !== delimiter) return undefined;
	const caret = selection.start + 1;
	return { source, selectionStart: caret, selectionEnd: caret };
}

function lineStartAt(source: string, offset: number): number {
	const newline = source.lastIndexOf('\n', Math.max(0, offset - 1));
	return newline === -1 ? 0 : newline + 1;
}

function selectedLineStarts(source: string, start: number, end: number): number[] {
	const firstLineStart = lineStartAt(source, start);
	const lastLineStart = lineStartAt(source, Math.max(start, end - 1));
	const starts: number[] = [];
	for (let lineStart = firstLineStart; lineStart <= lastLineStart; ) {
		starts.push(lineStart);
		const newline = source.indexOf('\n', lineStart);
		if (newline === -1 || newline >= lastLineStart) break;
		lineStart = newline + 1;
	}
	return starts;
}

/**
 * Indent the line(s) touched by a textarea selection using the editor's soft
 * tab width. The returned offsets are ready to pass to setSelectionRange.
 */
export function indentSourceSelection(
	source: string,
	selectionStart: number,
	selectionEnd = selectionStart,
	indent = SOURCE_EDITOR_INDENT,
): SourceEditorEdit {
	const selection = normalizedSelection(source, selectionStart, selectionEnd);
	const starts = selectedLineStarts(source, selection.start, selection.end);
	const insertion = starts.map((start) => ({ start, length: indent.length }));
	let nextSource = source;
	for (let index = insertion.length - 1; index >= 0; index -= 1) {
		const edit = insertion[index];
		nextSource = `${nextSource.slice(0, edit.start)}${indent}${nextSource.slice(edit.start)}`;
	}
	return {
		source: nextSource,
		selectionStart: selection.start + indent.length,
		selectionEnd: selection.end + indent.length * starts.length,
	};
}

/**
 * Remove one soft-tab (or a single tab) from each selected line. Partial
 * selections inside leading whitespace collapse to the new line start, just
 * like an IDE's outdent command.
 */
export function dedentSourceSelection(
	source: string,
	selectionStart: number,
	selectionEnd = selectionStart,
	indent = SOURCE_EDITOR_INDENT,
): SourceEditorEdit {
	const selection = normalizedSelection(source, selectionStart, selectionEnd);
	const starts = selectedLineStarts(source, selection.start, selection.end);
	const removals = starts
		.map((start) => {
			const leadingSpaces = source.slice(start, start + indent.length).match(/^ +/)?.[0].length ?? 0;
			if (leadingSpaces) return { start, length: Math.min(indent.length, leadingSpaces) };
			if (source[start] === '\t') return { start, length: 1 };
			return undefined;
		})
		.filter((removal): removal is { start: number; length: number } => removal !== undefined);
	let nextSource = source;
	for (let index = removals.length - 1; index >= 0; index -= 1) {
		const removal = removals[index];
		nextSource = `${nextSource.slice(0, removal.start)}${nextSource.slice(removal.start + removal.length)}`;
	}

	const mapOffset = (offset: number): number => {
		let removed = 0;
		for (const removal of removals) {
			if (offset <= removal.start) break;
			if (offset <= removal.start + removal.length) return removal.start - removed;
			removed += removal.length;
		}
		return offset - removed;
	};
	return {
		source: nextSource,
		selectionStart: mapOffset(selection.start),
		selectionEnd: mapOffset(selection.end),
	};
}

/**
 * Insert a newline and carry the current line's indentation forward. A line
 * ending in a JavaScript/Strudel opener gets one additional soft tab.
 */
export function insertSourceNewline(
	source: string,
	selectionStart: number,
	selectionEnd = selectionStart,
	indent = SOURCE_EDITOR_INDENT,
): SourceEditorEdit {
	const selection = normalizedSelection(source, selectionStart, selectionEnd);
	const lineStart = lineStartAt(source, selection.start);
	const prefix = source.slice(lineStart, selection.start);
	const leading = prefix.match(/^[\t ]*/)?.[0] ?? '';
	const trimmedPrefix = prefix.trimEnd();
	const continuationIndent = /(?:[([{]|=>)$/.test(trimmedPrefix) ? `${leading}${indent}` : leading;
	const replacement = `\n${continuationIndent}`;
	const nextSource = `${source.slice(0, selection.start)}${replacement}${source.slice(selection.end)}`;
	const caret = selection.start + replacement.length;
	return { source: nextSource, selectionStart: caret, selectionEnd: caret };
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
	const { start, end } = normalizedSelection(source, selectionStart, selectionEnd);
	return {
		source: `${source.slice(0, start)}${inserted}${source.slice(end)}`,
		caret: start + inserted.length,
	};
}
