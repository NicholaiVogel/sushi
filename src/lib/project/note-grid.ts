import {
	appendSourceExpressionCall,
	extendTrackSourceRangeWithRest,
	getSourceBlockDetails,
	getSourceGlobals,
	replaceSourceTrackExpression,
	updateTrackRange,
	type SourceGlobals,
} from './source-mapper';

export type NoteGridSourceKind = 'note' | 'n';
export type NoteGridDurationMode = 'none' | 'dur' | 'duration' | 'legato';

export interface NoteGridNote {
	id: string;
	slot: number;
	stackIndex: number;
	startCycle: number;
	durationCycles: number;
	midi: number;
	sourceValue: string;
}

export interface NoteGridScale {
	name: string;
	root: string;
	mode: 'major' | 'minor';
	rootMidi: number;
	intervals: readonly number[];
}

interface NoteGridCall {
	name: NoteGridSourceKind;
	callStart: number;
	callEnd: number;
	literalStart: number;
	literalEnd: number;
	quote: string;
	content: string;
}

interface DurationCall {
	method: Exclude<NoteGridDurationMode, 'none'>;
	callStart: number;
	callEnd: number;
	argumentStart: number;
	argumentEnd: number;
	insidePattern: boolean;
	quote?: string;
	content?: string;
	numeric?: number;
}

export interface NoteGrid {
	trackId: string;
	sourceKind: NoteGridSourceKind;
	steps: number;
	/** Display-space cycles occupied by one authored note-grid cycle. */
	patternCycles: number;
	/** Display-space duration of one source step. */
	stepCycle: number;
	/** Source-space duration of one authored step before seqPLoop scaling. */
	sourceStepCycle: number;
	/** Start offsets within each authored grid cell, expressed as fractions. */
	startOffsets: number[];
	/** Source values in each grid cell; multiple values share one onset. */
	values: string[][];
	/** Whether note duration controls belong inside the seqPLoop part. */
	durationInsidePattern: boolean;
	tokens: string[];
	durations: number[];
	durationMode: NoteGridDurationMode;
	sound: string;
	octaveShift: number;
	scale?: NoteGridScale;
	notes: NoteGridNote[];
	/** True when the track is represented by one static, editable event row. */
	editable: true;
}

export type NoteGridResult =
	| { ok: true; grid: NoteGrid }
	| { ok: false; reason: string };

export type NoteGridEdit =
	| { type: 'set'; slot: number; midi: number; stackIndex?: number }
	| { type: 'delete'; slot: number; stackIndex?: number }
	| { type: 'move'; slot: number; targetSlot: number; midi?: number; stackIndex?: number }
	| { type: 'resize'; slot: number; durationCycles: number; stackIndex?: number }
	| { type: 'trim-start'; slot: number; startCycle: number; stackIndex?: number }
	/** @deprecated Kept for source-grid callers that still use whole-cell starts. */
	| { type: 'trim-start'; slot: number; startSlot: number; stackIndex?: number };

const NOTE_LITERAL_PATTERN = /^([A-Ga-g])([#b]?)(-?\d+)$/;
const NUMBER_LITERAL_PATTERN = /^-?\d+$/;
const NUMERIC_LITERAL_SOURCE = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?';
const NUMERIC_EXPRESSION_PATTERN = new RegExp(`^${NUMERIC_LITERAL_SOURCE}$`);
const SCALE_PATTERN = /^([A-Ga-g])([#b]?)(-?\d+)?:((?:major)|(?:minor))$/i;
const ROOT_PITCHES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MAJOR_INTERVALS = [0, 2, 4, 5, 7, 9, 11] as const;
const MINOR_INTERVALS = [0, 2, 3, 5, 7, 8, 10] as const;
// Keep extended timeline lanes source-editable through the 137-cycle project cap.
const MAX_GRID_STEPS = 1024;
const DEFAULT_NOTE_OCTAVE = 3;

function isIdentifierCharacter(value: string | undefined): boolean {
	return value !== undefined && /[A-Za-z0-9_$]/.test(value);
}

function skipString(source: string, start: number): number {
	const quote = source[start];
	let escaped = false;
	for (let index = start + 1; index < source.length; index += 1) {
		const character = source[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (character === '\\') {
			escaped = true;
			continue;
		}
		if (character === quote) return index + 1;
	}
	return source.length;
}

function findCallEnd(source: string, open: number): number | undefined {
	let depth = 1;
	for (let index = open + 1; index < source.length; index += 1) {
		const character = source[index];
		const next = source[index + 1];
		if (character === '"' || character === "'" || character === '`') {
			index = skipString(source, index) - 1;
			continue;
		}
		if (character === '/' && next === '/') {
			const lineEnd = source.indexOf('\n', index + 2);
			index = (lineEnd === -1 ? source.length : lineEnd) - 1;
			continue;
		}
		if (character === '/' && next === '*') {
			const commentEnd = source.indexOf('*/', index + 2);
			index = (commentEnd === -1 ? source.length : commentEnd + 2) - 1;
			continue;
		}
		if (character === '(' || character === '[' || character === '{') depth += 1;
		if (character === ')' && --depth === 0) return index;
	}
	return undefined;
}

function splitFirstArgument(source: string, start: number, end: number): { start: number; end: number; text: string } {
	let depth = 0;
	for (let index = start; index < end; index += 1) {
		const character = source[index];
		if (character === '"' || character === "'" || character === '`') {
			index = skipString(source, index) - 1;
			continue;
		}
		if (character === '(' || character === '[' || character === '{') depth += 1;
		if (character === ')' || character === ']' || character === '}') depth = Math.max(0, depth - 1);
		if (character === ',' && depth === 0) return { start, end: index, text: source.slice(start, index) };
	}
	return { start, end, text: source.slice(start, end) };
}

function staticArgument(source: string, start: number, end: number): { value: string; valueStart: number; valueEnd: number; quote?: string } | undefined {
	const argument = splitFirstArgument(source, start, end);
	const leading = argument.text.match(/^\s*/)?.[0].length ?? 0;
	const trimmedStart = argument.start + leading;
	const trimmed = source.slice(trimmedStart, argument.end).trimEnd();
	if (!trimmed) return undefined;
	const quote = source[trimmedStart];
	if (quote === '"' || quote === "'" || quote === '`') {
		const literalEnd = skipString(source, trimmedStart);
		if (literalEnd > argument.end || source.slice(literalEnd, argument.end).trim()) return undefined;
		const raw = source.slice(trimmedStart + 1, literalEnd - 1);
		if (quote === '`' && /\$\{/.test(raw)) return undefined;
		return { value: unescapeString(raw, quote), valueStart: trimmedStart + 1, valueEnd: literalEnd - 1, quote };
	}
	if (!NUMERIC_EXPRESSION_PATTERN.test(trimmed)) return undefined;
	return { value: trimmed, valueStart: trimmedStart, valueEnd: argument.end - (argument.text.length - argument.text.trimEnd().length) };
}

function unescapeString(value: string, quote: string): string {
	const escapedQuote = `\\${quote}`;
	return value.replaceAll(escapedQuote, quote).replaceAll('\\\\', '\\');
}

function findNamedCalls(source: string, names: readonly string[], methodOnly = false): Array<{ name: string; start: number; end: number; argument: ReturnType<typeof staticArgument> }> {
	const calls: Array<{ name: string; start: number; end: number; argument: ReturnType<typeof staticArgument> }> = [];
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		const next = source[index + 1];
		if (character === '"' || character === "'" || character === '`') {
			index = skipString(source, index) - 1;
			continue;
		}
		if (character === '/' && next === '/') {
			const lineEnd = source.indexOf('\n', index + 2);
			index = (lineEnd === -1 ? source.length : lineEnd) - 1;
			continue;
		}
		if (character === '/' && next === '*') {
			const commentEnd = source.indexOf('*/', index + 2);
			index = (commentEnd === -1 ? source.length : commentEnd + 2) - 1;
			continue;
		}

		for (const name of names) {
			if (!source.startsWith(name, index)) continue;
			const before = source[index - 1];
			const afterName = source[index + name.length];
			if (isIdentifierCharacter(before) || isIdentifierCharacter(afterName)) continue;
			if (methodOnly ? before !== '.' : before === '.') continue;
			let open = index + name.length;
			while (/\s/.test(source[open] ?? '')) open += 1;
			if (source[open] !== '(') continue;
			const close = findCallEnd(source, open);
			if (close === undefined) continue;
			const argument = staticArgument(source, open + 1, close);
			calls.push({ name, start: index, end: close + 1, argument });
			index = close;
			break;
		}
	}
	return calls;
}

function parseNoteCall(expression: string): NoteGridCall | undefined {
	const calls = findNamedCalls(expression, ['note', 'n']);
	const staticCalls = calls.filter((call) => call.argument?.quote !== undefined);
	if (calls.length !== staticCalls.length || staticCalls.length !== 1) return undefined;
	const call = staticCalls[0];
	if (!call.argument?.quote || (call.name !== 'note' && call.name !== 'n')) return undefined;
	return {
		name: call.name,
		callStart: call.start,
		callEnd: call.end,
		literalStart: call.argument.valueStart,
		literalEnd: call.argument.valueEnd,
		quote: call.argument.quote,
		content: call.argument.value,
	};
}

interface StaticSlowCall {
	callStart: number;
	callEnd: number;
	argumentStart: number;
	argumentEnd: number;
	factor: number;
}

function parseStaticSlowCall(expression: string): StaticSlowCall | 'unsupported' | undefined {
	const calls = findNamedCalls(expression, ['slow'], true);
	if (!calls.length) return undefined;
	if (calls.length !== 1) return 'unsupported';
	const call = calls[0];
	const argument = call.argument;
	if (!argument || argument.quote !== undefined) return 'unsupported';
	const factor = Number(argument.value);
	if (!Number.isFinite(factor) || factor <= 0) return 'unsupported';
	return {
		callStart: call.start,
		callEnd: call.end,
		argumentStart: argument.valueStart,
		argumentEnd: argument.valueEnd,
		factor,
	};
}

function findMatchingBracket(source: string, open: number): number | undefined {
	let depth = 1;
	for (let index = open + 1; index < source.length; index += 1) {
		const character = source[index];
		const next = source[index + 1];
		if (character === '"' || character === "'" || character === '`') {
			index = skipString(source, index) - 1;
			continue;
		}
		if (character === '/' && next === '/') {
			const lineEnd = source.indexOf('\n', index + 2);
			index = (lineEnd === -1 ? source.length : lineEnd) - 1;
			continue;
		}
		if (character === '/' && next === '*') {
			const commentEnd = source.indexOf('*/', index + 2);
			index = (commentEnd === -1 ? source.length : commentEnd + 2) - 1;
			continue;
		}
		if (character === '[') depth += 1;
		if (character === ']' && --depth === 0) return index;
	}
	return undefined;
}

function seqPLoopRange(expression: string): { start: number; end: number } | undefined {
	if (!/^\s*seqPLoop\s*\(/.test(expression)) return undefined;
	const seqOpen = expression.indexOf('(');
	for (let index = seqOpen + 1; index < expression.length; index += 1) {
		const character = expression[index];
		const next = expression[index + 1];
		if (character === '"' || character === "'" || character === '`') {
			index = skipString(expression, index) - 1;
			continue;
		}
		if (character === '/' && next === '/') {
			const lineEnd = expression.indexOf('\n', index + 2);
			index = (lineEnd === -1 ? expression.length : lineEnd) - 1;
			continue;
		}
		if (character === '/' && next === '*') {
			const commentEnd = expression.indexOf('*/', index + 2);
			index = (commentEnd === -1 ? expression.length : commentEnd + 2) - 1;
			continue;
		}
		if (character !== '[') continue;
		const end = findMatchingBracket(expression, index);
		return end === undefined ? undefined : { start: index, end };
	}
	return undefined;
}

interface SeqPLoopPart {
	start: number;
	end: number;
	bodyStart: number;
	bodyEnd: number;
	body: string;
}

interface SeqPLoopParts {
	open: number;
	close: number;
	parts: SeqPLoopPart[];
}

function findBalancedCallEnd(source: string, open: number): number | undefined {
	let depth = 1;
	for (let index = open + 1; index < source.length; index += 1) {
		const character = source[index];
		const next = source[index + 1];
		if (character === '"' || character === "'" || character === '`') {
			index = skipString(source, index) - 1;
			continue;
		}
		if (character === '/' && next === '/') {
			const lineEnd = source.indexOf('\n', index + 2);
			index = (lineEnd === -1 ? source.length : lineEnd) - 1;
			continue;
		}
		if (character === '/' && next === '*') {
			const commentEnd = source.indexOf('*/', index + 2);
			index = (commentEnd === -1 ? source.length : commentEnd + 2) - 1;
			continue;
		}
		if (character === '(') depth += 1;
		if (character === ')' && --depth === 0) return index;
	}
	return undefined;
}

function seqPLoopParts(expression: string): SeqPLoopParts | undefined {
	const prefix = /^\s*seqPLoop\s*\(/.exec(expression);
	if (!prefix) return undefined;
	const open = expression.indexOf('(', prefix.index);
	const close = open < 0 ? undefined : findBalancedCallEnd(expression, open);
	if (close === undefined) return undefined;
	const parts: SeqPLoopPart[] = [];
	const rangePattern = new RegExp(`^\\[\\s*(${NUMERIC_LITERAL_SOURCE})\\s*,\\s*(${NUMERIC_LITERAL_SOURCE})\\s*,`);
	for (let index = open + 1; index < close;) {
		while (index < close && (/[\s,]/.test(expression[index] ?? ''))) index += 1;
		if (index >= close) break;
		if (expression[index] !== '[') {
			index += 1;
			continue;
		}
		const bracketEnd = findMatchingBracket(expression, index);
		if (bracketEnd === undefined || bracketEnd > close) return undefined;
		const partText = expression.slice(index, bracketEnd + 1);
		const match = partText.match(rangePattern);
		if (match) {
			const bodyStart = index + match[0].length;
			parts.push({
				start: Number(match[1]),
				end: Number(match[2]),
				bodyStart,
				bodyEnd: bracketEnd,
				body: expression.slice(bodyStart, bracketEnd),
			});
		}
		index = bracketEnd + 1;
	}
	return { open, close, parts };
}

function isEmptySeqPLoopPart(body: string): boolean {
	return /^\s*(?:s|sound)\s*\(\s*["'`]~["'`]\s*\)\s*$/.test(body);
}

function canonicalizeLegacyNoteGridSource(source: string, trackId: string): string | undefined {
	const block = getSourceBlockDetails(source).find((candidate) => candidate.id === trackId);
	if (!block?.marker || !block.expression) return undefined;
	const expression = block.expression;
	const loop = seqPLoopParts(expression);
	if (!loop || loop.parts.length < 2) return undefined;
	const notePart = loop.parts[0];
	if (notePart.start !== block.timing.startCycle) return undefined;
	const noteExpression = expression.slice(notePart.bodyStart, notePart.bodyEnd).trim();
	const noteCall = parseNoteCall(noteExpression);
	if (!noteCall || parseDurationCall(noteExpression) !== undefined || parseDurationCall(expression) !== undefined) return undefined;
	const parsedTokens = parseTokens(noteCall);
	if (!parsedTokens || !parsedTokens.raw.length) return undefined;
	const slowCall = parseStaticSlowCall(noteExpression);
	if (slowCall === 'unsupported') return undefined;
	const authoredTokens = [...parsedTokens.raw];
	// Older range edits appended rests to the note section and then moved its
	// boundary again. They are extension cells, not part of the authored grid.
	while (authoredTokens.length > 1 && (authoredTokens.at(-1) === '~' || authoredTokens.at(-1) === '-')) authoredTokens.pop();
	const nominalPatternCycles = slowCall ? slowCall.factor : authoredTokens.length;
	const outerSpan = block.timing.endCycle - block.timing.startCycle;
	if (!Number.isFinite(nominalPatternCycles) || nominalPatternCycles <= 0 || !Number.isFinite(outerSpan) || outerSpan <= nominalPatternCycles) return undefined;
	const stepCycle = nominalPatternCycles / authoredTokens.length;
	const extraSteps = Math.round((outerSpan - nominalPatternCycles) / stepCycle);
	if (extraSteps <= 0 || Math.abs(extraSteps * stepCycle - (outerSpan - nominalPatternCycles)) > 0.000001) return undefined;
	const tailParts = loop.parts.slice(1);
	if (tailParts.some((part) => !isEmptySeqPLoopPart(part.body) && part.body.trim() !== noteExpression.trim())) return undefined;
	const nextTokens = [...authoredTokens, ...Array(extraSteps).fill('~')];
	const expandedNoteExpression = replaceRange(noteExpression, noteCall.literalStart, noteCall.literalEnd, escapeString(nextTokens.join(' '), noteCall.quote));
	const outerSuffix = expression.slice(loop.close + 1);
	const canonicalExpression = `seqPLoop([${formatNumber(block.timing.startCycle)}, ${formatNumber(block.timing.endCycle)}, ${expandedNoteExpression}])${outerSuffix}`;
	return replaceSourceTrackExpression(source, trackId, ({ label }) => ({ label, expression: canonicalExpression }));
}

/** Normalize source-generated static note timing and repair legacy range tails. */
export function normalizeNoteGridSourceRanges(source: string): string {
	let normalized = source;
	for (const block of getSourceBlockDetails(source)) {
		const currentBlock = getSourceBlockDetails(normalized).find((candidate) => candidate.id === block.id);
		const loop = currentBlock?.expression ? seqPLoopParts(currentBlock.expression) : undefined;
		if (currentBlock?.marker && loop?.parts.some((part) => part.end <= part.start)) {
			const validParts = loop.parts.filter((part) => part.end > part.start);
			if (validParts.length) {
				const start = Math.min(...validParts.map((part) => part.start));
				const end = Math.max(...validParts.map((part) => part.end));
				normalized = updateTrackRange(normalized, block.id, start, end);
			}
		}
		const canonical = canonicalizeLegacyNoteGridSource(normalized, block.id);
		if (canonical && canonical !== normalized) normalized = canonical;
		const stretched = normalizeStaticNoteGridSourceRange(normalized, block.id);
		if (stretched && stretched !== normalized) normalized = stretched;
	}
	return normalized;
}

function normalizeStaticNoteGridSourceRange(source: string, trackId: string): string | undefined {
	const block = getSourceBlockDetails(source).find((candidate) => candidate.id === trackId);
	if (!block?.marker || !block.expression) return undefined;
	const loop = seqPLoopParts(block.expression);
	if (!loop || loop.parts.length !== 1) return undefined;
	const part = loop.parts[0];
	const noteExpression = block.expression.slice(part.bodyStart, part.bodyEnd).trim();
	const noteCall = parseNoteCall(noteExpression);
	if (!noteCall || !parseTokens(noteCall) || hasUnsupportedExpression(block.expression)) return undefined;
	const bodySlow = parseStaticSlowCall(noteExpression);
	if (bodySlow === 'unsupported') return undefined;
	const expressionSlow = parseStaticSlowCall(block.expression);
	if (expressionSlow === 'unsupported' || (expressionSlow && !bodySlow)) return undefined;
	const targetPatternCycles = block.timing.endCycle - block.timing.startCycle;
	if (!Number.isFinite(targetPatternCycles) || targetPatternCycles <= 0) return undefined;

	let nextNoteExpression = noteExpression;
	if (bodySlow) {
		if (Math.abs(bodySlow.factor - targetPatternCycles) < 0.000001) return undefined;
		nextNoteExpression = replaceRange(noteExpression, bodySlow.argumentStart, bodySlow.argumentEnd, formatNumber(targetPatternCycles));
	} else {
		nextNoteExpression = appendSourceExpressionCall(noteExpression, `.slow(${formatNumber(targetPatternCycles)})`);
	}
	const nextExpression = replaceRange(block.expression, part.bodyStart, part.bodyEnd, ` ${nextNoteExpression}`);
	return replaceSourceTrackExpression(source, trackId, ({ label }) => ({ label, expression: nextExpression }));
}

function isInsideSeqPLoopPart(expression: string, index: number): boolean {
	const range = seqPLoopRange(expression);
	return range !== undefined && index > range.start && index < range.end;
}

function parseDurationCall(expression: string): DurationCall | undefined | 'unsupported' {
	const calls = findNamedCalls(expression, ['dur', 'duration', 'legato'], true);
	if (calls.length > 1) return 'unsupported';
	const call = calls[0];
	if (!call) return undefined;
	const open = expression.indexOf('(', call.start + call.name.length);
	const close = call.end - 1;
	const argument = staticArgument(expression, open + 1, close);
	if (!argument) return 'unsupported';
	if (argument.quote !== undefined) return { method: call.name as DurationCall['method'], callStart: call.start, callEnd: call.end, argumentStart: argument.valueStart, argumentEnd: argument.valueEnd, insidePattern: isInsideSeqPLoopPart(expression, call.start), quote: argument.quote, content: argument.value };
	const numeric = Number(argument.value);
	if (!Number.isFinite(numeric) || numeric <= 0) return 'unsupported';
	return { method: call.name as DurationCall['method'], callStart: call.start, callEnd: call.end, argumentStart: argument.valueStart, argumentEnd: argument.valueEnd, insidePattern: isInsideSeqPLoopPart(expression, call.start), numeric };
}

function parseScale(expression: string, globals: SourceGlobals): NoteGridScale | undefined {
	const calls = findNamedCalls(expression, ['scale'], true);
	if (calls.length !== 1) return undefined;
	const call = calls[0];
	const open = expression.indexOf('(', call.start + call.name.length);
	const close = call.end - 1;
	const argument = staticArgument(expression, open + 1, close);
	const rawArgument = splitFirstArgument(expression, open + 1, close).text.trim();
	const raw = rawArgument === 'key' ? globals.key : argument?.value ?? rawArgument;
	if (!raw) return undefined;
	const match = raw.trim().match(SCALE_PATTERN);
	if (!match) return undefined;
	const root = `${match[1].toUpperCase()}${match[2]}`;
	const pitchClass = ROOT_PITCHES[match[1].toUpperCase()] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
	const octave = match[3] === undefined ? DEFAULT_NOTE_OCTAVE : Number(match[3]);
	const mode = match[4].toLowerCase() as 'major' | 'minor';
	return {
		name: raw.trim(),
		root,
		mode,
		rootMidi: (octave + 1) * 12 + ((pitchClass + 12) % 12),
		intervals: mode === 'major' ? MAJOR_INTERVALS : MINOR_INTERVALS,
	};
}

function parseOctaveShift(expression: string): number | undefined {
	const calls = findNamedCalls(expression, ['octave'], true);
	if (calls.length > 1) return undefined;
	const call = calls[0];
	if (!call) return 0;
	const open = expression.indexOf('(', call.start + call.name.length);
	const argument = staticArgument(expression, open + 1, call.end - 1);
	if (!argument || argument.quote !== undefined) return undefined;
	const value = Number(argument.value);
	return Number.isFinite(value) ? value : undefined;
}

function hasUnsupportedExpression(expression: string): boolean {
	if (/\barrange\s*\(/.test(expression)) return true;
	// A single numeric .slow() is the explicit timing stretcher used by static
	// note grids. Dynamic or repeated slow calls remain read-only.
	if (parseStaticSlowCall(expression) === 'unsupported') return true;
	const unsupported = [
		'add', 'sub', 'mul', 'div', 'transpose', 'scaleTranspose', 'strans',
		'fast', 'rev', 'early', 'late', 'jux', 'juxBy', 'layer',
		'arp', 'chord', 'ply', 'iter', 'chunk', 'struct', 'mask', 'euclid',
		'every', 'sometimes', 'often', 'rarely', 'degrade', 'off', 'superimpose',
		'repeatCycles', 'arrange',
	];
	return unsupported.some((method) => findNamedCalls(expression, [method], true).length > 0);
}

function seqPLoopPatternCycles(expression: string, noteCall: NoteGridCall): number {
	const slowCall = parseStaticSlowCall(expression);
	if (slowCall && slowCall !== 'unsupported') return slowCall.factor;
	const range = seqPLoopRange(expression);
	if (!range) return 1;
	const rangeText = expression.slice(range.start, noteCall.callStart);
	const match = rangeText.match(new RegExp(`^\\[\\s*(${NUMERIC_LITERAL_SOURCE})\\s*,\\s*(${NUMERIC_LITERAL_SOURCE})\\s*,`));
	if (!match) return 1;
	const start = Number(match[1]);
	const end = Number(match[2]);
	return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 1;
}

interface ParsedGridTokens {
	raw: string[];
	values: string[][];
	startOffsets: number[];
	durationFractions: number[];
}

interface WeightedGridPart {
	value: string;
	weight: number;
}

function splitGridTokens(content: string): string[] | undefined {
	const tokens: string[] = [];
	for (let index = 0; index < content.length;) {
		while (/\s/.test(content[index] ?? '')) index += 1;
		if (index >= content.length) break;
		const start = index;
		if (content[index] === '[') {
			let depth = 1;
			index += 1;
			while (index < content.length && depth > 0) {
				if (content[index] === '[') depth += 1;
				else if (content[index] === ']') depth -= 1;
				index += 1;
			}
			if (depth !== 0) return undefined;
		} else {
			while (index < content.length && !/\s/.test(content[index] ?? '')) index += 1;
		}
		while (content[index - 1] === ',') {
			while (/\s/.test(content[index] ?? '')) index += 1;
			while (index < content.length && !/\s/.test(content[index] ?? '')) index += 1;
		}
		const token = content.slice(start, index);
		if (!token) return undefined;
		tokens.push(token);
	}
	return tokens.length && tokens.length <= MAX_GRID_STEPS ? tokens : undefined;
}

function parseWeightedGridPart(raw: string): WeightedGridPart | undefined {
	const match = raw.match(new RegExp(`^(.+?)(?:[@_](${NUMERIC_LITERAL_SOURCE}))$`));
	const value = match ? match[1] : raw;
	const weight = match ? Number(match[2]) : 1;
	if (!value || !Number.isFinite(weight) || weight <= 0) return undefined;
	return { value, weight };
}

function splitStackValues(raw: string): string[] | undefined {
	const values = raw.split(',').map((value) => value.trim()).filter(Boolean);
	if (!values.length || values.some((value) => /[\[\]<>*/]/.test(value))) return undefined;
	return values.filter((value) => value !== '~' && value !== '-');
}

function parseGridToken(raw: string): { values: string[]; startOffset: number; durationFraction: number } | undefined {
	if (!raw.startsWith('[')) {
		const values = splitStackValues(raw);
		return values === undefined ? undefined : { values, startOffset: 0, durationFraction: 1 };
	}
	if (!raw.endsWith(']')) return undefined;
	const parts = raw.slice(1, -1).trim().replace(/,\s+/g, ',').split(/\s+/).filter(Boolean).map(parseWeightedGridPart);
	if (!parts.length || parts.some((part) => !part)) return undefined;
	const parsed = parts as WeightedGridPart[];
	const noteParts = parsed.filter((part) => part.value !== '~' && part.value !== '-');
	if (noteParts.length === 0) return { values: [], startOffset: 0, durationFraction: 1 };
	if (noteParts.length !== 1 || parsed.some((part) => part.value === '' || (part.value !== '~' && part.value !== '-' && /[\[\]<>*/]/.test(part.value)))) return undefined;
	const values = splitStackValues(noteParts[0].value);
	if (!values?.length) return undefined;
	const noteIndex = parsed.findIndex((part) => part.value !== '~' && part.value !== '-');
	const totalWeight = parsed.reduce((total, part) => total + part.weight, 0);
	const startWeight = parsed.slice(0, noteIndex).reduce((total, part) => total + part.weight, 0);
	return {
		values,
		startOffset: startWeight / totalWeight,
		durationFraction: parsed[noteIndex].weight / totalWeight,
	};
}

function parseTokens(call: NoteGridCall): ParsedGridTokens | undefined {
	const raw = splitGridTokens(call.content);
	if (!raw) return undefined;
	const parsed = raw.map(parseGridToken);
	if (parsed.some((token) => !token)) return undefined;
	const tokens = parsed as Array<{ values: string[]; startOffset: number; durationFraction: number }>;
	if (tokens.some((token) => token.values.some((value) => value.includes('@') || value.includes('_') || value.includes('<') || value.includes('>') || value.includes('[') || value.includes(']') || value.includes('*') || value.includes('/')))) return undefined;
	return {
		raw,
		values: tokens.map((token) => token.values),
		startOffsets: tokens.map((token) => token.startOffset),
		durationFractions: tokens.map((token) => token.durationFraction),
	};
}

function noteToMidi(value: string): number | undefined {
	const match = value.match(NOTE_LITERAL_PATTERN);
	if (!match) return undefined;
	const pitchClass = ROOT_PITCHES[match[1].toUpperCase()] + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
	const midi = (Number(match[3]) + 1) * 12 + pitchClass;
	return Number.isInteger(midi) && midi >= 0 && midi <= 127 ? midi : undefined;
}

function scaleDegreeToMidi(scale: NoteGridScale, degree: number, octaveShift: number): number {
	const octave = Math.floor(degree / scale.intervals.length);
	const index = ((degree % scale.intervals.length) + scale.intervals.length) % scale.intervals.length;
	return scale.rootMidi + octave * 12 + scale.intervals[index] + octaveShift * 12;
}

function scaleMidiToDegree(scale: NoteGridScale, midi: number, octaveShift: number): { midi: number; degree: number } {
	let nearest = { midi: scaleDegreeToMidi(scale, 0, octaveShift), degree: 0 };
	for (let degree = -64; degree <= 64; degree += 1) {
		const candidateMidi = scaleDegreeToMidi(scale, degree, octaveShift);
		if (Math.abs(candidateMidi - midi) < Math.abs(nearest.midi - midi)) nearest = { midi: candidateMidi, degree };
	}
	return nearest;
}

function parseDurationValues(
	durationCall: DurationCall | undefined,
	tokenCount: number,
	stepCycle: number,
	defaultDurations = Array(tokenCount).fill(stepCycle),
): { durations: number[]; mode: NoteGridDurationMode } | undefined {
	if (!durationCall) return { durations: [...defaultDurations], mode: 'none' };
	if (durationCall.numeric !== undefined) {
		const unit = durationCall.method === 'legato' ? stepCycle * durationCall.numeric : durationCall.numeric;
		return { durations: Array(tokenCount).fill(unit), mode: durationCall.method };
	}
	const values = durationCall.content?.trim().split(/\s+/).filter(Boolean) ?? [];
	if (values.length !== tokenCount || values.some((value) => value !== '~' && !NUMERIC_EXPRESSION_PATTERN.test(value))) return undefined;
	const durations = values.map((value) => {
		if (value === '~') return stepCycle;
		const numeric = Number(value);
		return durationCall.method === 'legato' ? stepCycle * numeric : numeric;
	});
	if (durations.some((value) => !Number.isFinite(value) || value <= 0)) return undefined;
	return { durations, mode: durationCall.method };
}

function soundName(expression: string): string {
	const calls = findNamedCalls(expression, ['s', 'sound'], true);
	const argument = calls.find((call) => call.argument?.quote !== undefined)?.argument?.value;
	const token = argument?.match(/[A-Za-z][A-Za-z0-9_-]*/)?.[0];
	return token ?? 'sine';
}

function formatNumber(value: number): string {
	const rounded = Math.round(value * 1_000_000) / 1_000_000;
	return String(rounded);
}

function escapeString(value: string, quote: string): string {
	return value.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`);
}

function formatOffsetToken(value: string, offset: number): string {
	const units = Math.max(0, Math.min(3, Math.round(offset * 4)));
	if (units === 0) return value;
	return `[${[...Array(units).fill('~'), value, ...Array(3 - units).fill('~')].join(' ')}]`;
}

function formatStackToken(values: string[], offset: number): string {
	return values.length ? formatOffsetToken(values.join(','), offset) : '~';
}

function sourceValueForMidi(grid: NoteGrid, midi: number): { midi: number; value: string } {
	const normalized = Math.max(0, Math.min(127, Math.round(midi)));
	if (grid.sourceKind === 'note') return { midi: normalized, value: midiToNoteName(normalized) };
	if (!grid.scale) return { midi: normalized, value: '0' };
	const nearest = scaleMidiToDegree(grid.scale, normalized, grid.octaveShift);
	return { midi: nearest.midi, value: String(nearest.degree) };
}

function durationSourceValues(grid: NoteGrid, durations: number[]): string[] {
	return durations.map((duration) => {
		if (grid.durationMode === 'legato') return formatNumber(duration / grid.stepCycle);
		return formatNumber(grid.durationInsidePattern ? duration / grid.patternCycles : duration);
	});
}

function replaceRange(source: string, start: number, end: number, replacement: string): string {
	return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

export function midiToNoteName(midi: number): string {
	const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
	const normalized = Math.max(0, Math.min(127, Math.round(midi)));
	return `${names[normalized % 12]}${Math.floor(normalized / 12) - 1}`;
}

export function parseNoteGrid(source: string, trackId: string, globals = getSourceGlobals(source)): NoteGridResult {
	const block = getSourceBlockDetails(source).find((candidate) => candidate.id === trackId);
	if (!block?.expression) return { ok: false, reason: 'This source block has no editable Strudel expression.' };
	const canonicalSource = canonicalizeLegacyNoteGridSource(source, trackId);
	if (canonicalSource && canonicalSource !== source) return parseNoteGrid(canonicalSource, trackId, globals);
	const stretchedSource = normalizeStaticNoteGridSourceRange(source, trackId);
	if (stretchedSource && stretchedSource !== source) return parseNoteGrid(stretchedSource, trackId, globals);
	const expression = block.expression;
	if (hasUnsupportedExpression(expression)) return { ok: false, reason: 'This pattern changes pitch or timing procedurally, so it stays source-editable but is read-only in the note editor.' };
	const noteCall = parseNoteCall(expression);
	if (!noteCall) return { ok: false, reason: 'Use one static note(...) or n(...) pattern for note-grid editing.' };
	const parsedTokens = parseTokens(noteCall);
	if (!parsedTokens) return { ok: false, reason: 'This note pattern uses unsupported nested or dynamic mini-notation; use static note values, rests, or comma-stacked notes.' };
	const tokens = parsedTokens.values;
	const rawTokens = parsedTokens.raw;
	const startOffsets = parsedTokens.startOffsets;
	const steps = tokens.length;
	const sourceStepCycle = 1 / steps;
	const patternCycles = seqPLoopPatternCycles(expression, noteCall);
	const stepCycle = patternCycles * sourceStepCycle;
	const scale = noteCall.name === 'n' ? parseScale(expression, globals) : undefined;
	if (noteCall.name === 'n' && !scale) return { ok: false, reason: 'Numeric note grids require a static .scale(key) or .scale("Root:major/minor") call.' };
	if (noteCall.name === 'note' && findNamedCalls(expression, ['scale'], true).length > 0) return { ok: false, reason: 'Use n(...).scale(...) for scale-aware note-grid editing.' };
	const octaveShift = parseOctaveShift(expression);
	if (octaveShift === undefined) return { ok: false, reason: 'The note grid needs a static numeric .octave(...) value.' };
	const durationCall = parseDurationCall(expression);
	if (durationCall === 'unsupported') return { ok: false, reason: 'Use one static .dur(...), .duration(...), or .legato(...) value for note lengths.' };
	const durationInsidePattern = /^\s*seqPLoop\s*\(/.test(expression) && (!durationCall || durationCall.insidePattern);
	const durationScale = durationInsidePattern ? patternCycles : 1;
	const parsedDurations = parseDurationValues(
		durationCall,
		tokens.length,
		sourceStepCycle,
		parsedTokens.durationFractions.map((fraction) => sourceStepCycle * fraction),
	);
	if (!parsedDurations) return { ok: false, reason: 'Note durations must be one static number or one flat value for each grid step.' };

	const notes: NoteGridNote[] = [];
	for (let slot = 0; slot < tokens.length; slot += 1) {
		for (let stackIndex = 0; stackIndex < tokens[slot].length; stackIndex += 1) {
			const token = tokens[slot][stackIndex];
			let midi: number | undefined;
			if (noteCall.name === 'note') midi = noteToMidi(token);
			else if (NUMBER_LITERAL_PATTERN.test(token) && scale) midi = scaleDegreeToMidi(scale, Number(token), octaveShift);
			if (midi === undefined || midi < 0 || midi > 127) return { ok: false, reason: `The note value "${token}" is outside the supported MIDI range.` };
			notes.push({
				id: stackIndex === 0 ? `note-${slot}` : `note-${slot}-${stackIndex}`,
				slot,
				stackIndex,
				startCycle: (slot + startOffsets[slot]) * stepCycle,
				durationCycles: parsedDurations.durations[slot] * durationScale,
				midi,
				sourceValue: token,
			});
		}
	}

	return {
		ok: true,
		grid: {
			trackId,
			sourceKind: noteCall.name,
			steps,
			patternCycles,
			stepCycle,
			sourceStepCycle,
			startOffsets,
			values: tokens,
			tokens: rawTokens,
			durations: parsedDurations.durations.map((duration) => duration * durationScale),
			durationMode: parsedDurations.mode,
			durationInsidePattern,
			sound: soundName(expression),
			octaveShift,
			...(scale ? { scale } : {}),
			notes,
			editable: true,
		},
	};
}

export function snapMidiToNoteGrid(grid: NoteGrid, midi: number): number {
	const normalized = Math.max(0, Math.min(127, Math.round(midi)));
	return grid.sourceKind === 'n' && grid.scale
		? scaleMidiToDegree(grid.scale, normalized, grid.octaveShift).midi
		: normalized;
}

/**
 * Add empty source-grid cells before a track range is extended. The range
 * mapper runs separately, so doing this first keeps each existing note at its
 * original duration instead of stretching the old pattern across the larger
 * clip. Full-length source lanes repeat their authored pattern for the old
 * clip span; explicit seqPLoop lanes already describe that span directly.
 */
export function extendNoteGridSourceRange(source: string, trackId: string, previousEndCycle: number, nextEndCycle: number): string {
	if (!Number.isFinite(previousEndCycle) || !Number.isFinite(nextEndCycle) || nextEndCycle <= previousEndCycle) return source;
	const canonicalSource = canonicalizeLegacyNoteGridSource(source, trackId);
	if (canonicalSource && canonicalSource !== source) return extendNoteGridSourceRange(canonicalSource, trackId, previousEndCycle, nextEndCycle);
	const stretchedSource = normalizeStaticNoteGridSourceRange(source, trackId);
	if (stretchedSource && stretchedSource !== source) return extendNoteGridSourceRange(stretchedSource, trackId, previousEndCycle, nextEndCycle);
	const block = getSourceBlockDetails(source).find((candidate) => candidate.id === trackId);
	if (!block) return source;
	const parsed = parseNoteGrid(source, trackId);
	if (!parsed.ok) return extendTrackSourceRangeWithRest(source, trackId, previousEndCycle, nextEndCycle);
	const grid = parsed.grid;
	if (!Number.isFinite(grid.stepCycle) || grid.stepCycle <= 0) return extendTrackSourceRangeWithRest(source, trackId, previousEndCycle, nextEndCycle);
	const extensionCycles = nextEndCycle - previousEndCycle;
	const extensionSteps = Math.round(extensionCycles / grid.stepCycle);
	if (extensionSteps <= 0 || Math.abs(extensionSteps * grid.stepCycle - extensionCycles) > 0.000001) return extendTrackSourceRangeWithRest(source, trackId, previousEndCycle, nextEndCycle);

	const fullTrackSpan = Math.max(grid.patternCycles, previousEndCycle - block.timing.startCycle);
	const repeatCount = block.timing.mode === 'full'
		? Math.max(1, Math.round(fullTrackSpan / grid.patternCycles))
		: 1;
	const baseTokens = Array.from({ length: repeatCount }, () => grid.tokens).flat();
	const baseValues = Array.from({ length: repeatCount }, () => grid.values).flat();
	const baseDurations = Array.from({ length: repeatCount }, () => grid.durations).flat();
	const baseOffsets = Array.from({ length: repeatCount }, () => grid.startOffsets).flat();
	const nextTokens = [...baseTokens, ...Array(extensionSteps).fill('~')];
	const nextValues = [...baseValues, ...Array.from({ length: extensionSteps }, () => [])];
	const nextDurations = [...baseDurations, ...Array(extensionSteps).fill(grid.stepCycle)];
	const nextOffsets = [...baseOffsets, ...Array(extensionSteps).fill(0)];
	const nextPatternCycles = fullTrackSpan + extensionCycles;
	const nextGrid: NoteGrid = {
		...grid,
		steps: nextTokens.length,
		patternCycles: nextPatternCycles,
		stepCycle: nextPatternCycles / nextTokens.length,
		sourceStepCycle: 1 / nextTokens.length,
		startOffsets: nextOffsets,
		values: nextValues,
		tokens: nextTokens,
		durations: nextDurations,
		// Wrapping a full-length expression in seqPLoop moves its duration
		// chain inside the loop's part, so format those values in that space.
		durationInsidePattern: block.timing.mode === 'full' ? true : grid.durationInsidePattern,
	};

	return replaceSourceTrackExpression(source, trackId, ({ label, expression }) => {
		const noteCall = parseNoteCall(expression);
		if (!noteCall) return { label, expression };
		const durationCall = parseDurationCall(expression);
		const slowCall = parseStaticSlowCall(expression);
		const replacements: Array<{ start: number; end: number; value: string }> = [{
			start: noteCall.literalStart,
			end: noteCall.literalEnd,
			value: escapeString(nextTokens.join(' '), noteCall.quote),
		}];
		if (slowCall && slowCall !== 'unsupported') {
			replacements.push({ start: slowCall.argumentStart, end: slowCall.argumentEnd, value: formatNumber(nextPatternCycles) });
		}
		if (durationCall && durationCall !== 'unsupported') {
			const durationValues = durationSourceValues(nextGrid, nextDurations);
			replacements.push({
				start: durationCall.argumentStart,
				end: durationCall.argumentEnd,
				value: durationCall.content !== undefined
					? escapeString(durationValues.join(' '), durationCall.quote ?? '"')
					: JSON.stringify(durationValues.join(' ')),
			});
		}
		return {
			label,
			expression: replacements
				.sort((left, right) => right.start - left.start)
				.reduce((current, replacement) => replaceRange(current, replacement.start, replacement.end, replacement.value), expression),
		};
	});
}

/**
 * Remove trailing note-grid cells when an extended lane is shortened again.
 * Without this, changing `[0, 8, note("a b c d ~ ~ ~ ~")]` back to `[0, 4, ...]`
 * leaves an eight-step pattern compressed into four cycles.
 */
export function trimNoteGridSourceRange(source: string, trackId: string, nextEndCycle: number): string {
	if (!Number.isFinite(nextEndCycle)) return source;
	const canonicalSource = canonicalizeLegacyNoteGridSource(source, trackId);
	if (canonicalSource && canonicalSource !== source) return trimNoteGridSourceRange(canonicalSource, trackId, nextEndCycle);
	const stretchedSource = normalizeStaticNoteGridSourceRange(source, trackId);
	if (stretchedSource && stretchedSource !== source) return trimNoteGridSourceRange(stretchedSource, trackId, nextEndCycle);
	const parsed = parseNoteGrid(source, trackId);
	if (!parsed.ok) return source;
	const block = getSourceBlockDetails(source).find((candidate) => candidate.id === trackId);
	if (!block) return source;
	const grid = parsed.grid;
	const targetPatternCycles = nextEndCycle - block.timing.startCycle;
	if (targetPatternCycles <= 0 || !Number.isFinite(grid.stepCycle) || grid.stepCycle <= 0) return source;
	const targetSteps = Math.round(targetPatternCycles / grid.stepCycle);
	if (targetSteps <= 0 || targetSteps >= grid.steps || Math.abs(targetSteps * grid.stepCycle - targetPatternCycles) > 0.000001) return source;
	const nextTokens = grid.tokens.slice(0, targetSteps);
	const nextDurations = grid.durations.slice(0, targetSteps);
	const nextGrid: NoteGrid = {
		...grid,
		steps: targetSteps,
		patternCycles: targetPatternCycles,
		stepCycle: targetPatternCycles / targetSteps,
		sourceStepCycle: 1 / targetSteps,
		startOffsets: grid.startOffsets.slice(0, targetSteps),
		values: grid.values.slice(0, targetSteps),
		tokens: nextTokens,
		durations: nextDurations,
	};

	return replaceSourceTrackExpression(source, trackId, ({ label, expression }) => {
		const noteCall = parseNoteCall(expression);
		if (!noteCall) return { label, expression };
		const durationCall = parseDurationCall(expression);
		const slowCall = parseStaticSlowCall(expression);
		const replacements: Array<{ start: number; end: number; value: string }> = [{
			start: noteCall.literalStart,
			end: noteCall.literalEnd,
			value: escapeString(nextTokens.join(' '), noteCall.quote),
		}];
		if (slowCall && slowCall !== 'unsupported') {
			replacements.push({ start: slowCall.argumentStart, end: slowCall.argumentEnd, value: formatNumber(targetPatternCycles) });
		}
		if (durationCall && durationCall !== 'unsupported') {
			const durationValues = durationSourceValues(nextGrid, nextDurations);
			replacements.push({
				start: durationCall.argumentStart,
				end: durationCall.argumentEnd,
				value: durationCall.content !== undefined
					? escapeString(durationValues.join(' '), durationCall.quote ?? '"')
					: JSON.stringify(durationValues.join(' ')),
			});
		}
		return {
			label,
			expression: replacements
				.sort((left, right) => right.start - left.start)
				.reduce((current, replacement) => replaceRange(current, replacement.start, replacement.end, replacement.value), expression),
		};
	});
}

export function updateNoteGridSource(source: string, trackId: string, edit: NoteGridEdit): string {
	const canonicalSource = canonicalizeLegacyNoteGridSource(source, trackId) ?? source;
	const stretchedSource = normalizeStaticNoteGridSourceRange(canonicalSource, trackId) ?? canonicalSource;
	const parsed = parseNoteGrid(stretchedSource, trackId);
	if (!parsed.ok) return source;
	if (!Number.isInteger(edit.slot) || edit.slot < 0 || edit.slot >= parsed.grid.steps) return source;
	const grid = parsed.grid;
	const nextTokens = [...grid.tokens];
	const nextDurations = [...grid.durations];
	let needsDurationControl = false;
	const stackIndex = edit.stackIndex ?? 0;
	if (!Number.isInteger(stackIndex) || stackIndex < 0) return source;

	if (edit.type === 'delete') {
		const values = [...(grid.values[edit.slot] ?? [])];
		if (stackIndex >= values.length) return source;
		values.splice(stackIndex, 1);
		nextTokens[edit.slot] = formatStackToken(values, grid.startOffsets[edit.slot] ?? 0);
	} else if (edit.type === 'set') {
		const values = [...(grid.values[edit.slot] ?? [])];
		if (stackIndex > values.length) return source;
		values[stackIndex] = sourceValueForMidi(grid, edit.midi).value;
		nextTokens[edit.slot] = formatStackToken(values, grid.startOffsets[edit.slot] ?? 0);
	} else if (edit.type === 'move') {
		if (!Number.isInteger(edit.targetSlot) || edit.targetSlot < 0 || edit.targetSlot >= grid.steps || edit.targetSlot === edit.slot) return source;
		const sourceValues = [...(grid.values[edit.slot] ?? [])];
		if (stackIndex >= sourceValues.length) return source;
		const movedValue = edit.midi === undefined ? sourceValues[stackIndex] : sourceValueForMidi(grid, edit.midi).value;
		const targetValues = [...(grid.values[edit.targetSlot] ?? [])];
		const sourceOffset = grid.startOffsets[edit.slot] ?? 0;
		const targetOffset = targetValues.length ? grid.startOffsets[edit.targetSlot] ?? 0 : sourceOffset;
		sourceValues.splice(stackIndex, 1);
		targetValues.push(movedValue);
		nextTokens[edit.slot] = formatStackToken(sourceValues, sourceOffset);
		nextTokens[edit.targetSlot] = formatStackToken(targetValues, targetOffset);
		nextDurations[edit.slot] = grid.durations[edit.slot] ?? grid.stepCycle;
		nextDurations[edit.targetSlot] = targetValues.length > 1
			? grid.durations[edit.targetSlot] ?? grid.stepCycle
			: grid.durations[edit.slot] ?? grid.stepCycle;
	} else if (edit.type === 'resize') {
		if (!Number.isFinite(edit.durationCycles) || edit.durationCycles <= 0 || (grid.values[edit.slot]?.length ?? 0) <= stackIndex) return source;
		nextDurations[edit.slot] = edit.durationCycles;
		needsDurationControl = true;
	} else if ('startCycle' in edit) {
		const note = grid.notes.find((candidate) => candidate.slot === edit.slot && candidate.stackIndex === stackIndex);
		if (!note || !Number.isFinite(edit.startCycle)) return source;
		const durationResolution = grid.stepCycle / 4;
		const cellStartCycle = edit.slot * grid.stepCycle;
		const targetStartCycle = Math.min(cellStartCycle + grid.stepCycle - durationResolution, Math.max(cellStartCycle, edit.startCycle));
		const endCycle = note.startCycle + note.durationCycles;
		const durationCycles = Number((Math.max(durationResolution, endCycle - targetStartCycle) / durationResolution).toFixed(6)) * durationResolution;
		const targetOffset = (targetStartCycle - cellStartCycle) / grid.stepCycle;
		const targetToken = formatStackToken(grid.values[edit.slot] ?? [], targetOffset);
		if (targetToken === grid.tokens[edit.slot] && Math.abs(durationCycles - grid.durations[edit.slot]) < 0.000001) return source;
		nextTokens[edit.slot] = targetToken;
		nextDurations[edit.slot] = Number(durationCycles.toFixed(6));
		needsDurationControl = true;
	} else {
		if (!Number.isInteger(edit.startSlot) || edit.startSlot < 0 || edit.startSlot >= grid.steps || edit.startSlot === edit.slot) return source;
		const note = grid.notes.find((candidate) => candidate.slot === edit.slot && candidate.stackIndex === stackIndex);
		const targetToken = grid.tokens[edit.startSlot];
		if (!note || (targetToken !== '~' && targetToken !== '-')) return source;
		const durationResolution = grid.stepCycle / 4;
		const endCycle = note.startCycle + note.durationCycles;
		const targetStartCycle = edit.startSlot * grid.stepCycle;
		const durationCycles = Math.max(durationResolution, endCycle - targetStartCycle);
		if (!Number.isFinite(durationCycles) || durationCycles <= 0) return source;
		const values = [...(grid.values[edit.slot] ?? [])];
		values.splice(stackIndex, 1);
		nextTokens[edit.slot] = formatStackToken(values, grid.startOffsets[edit.slot] ?? 0);
		nextTokens[edit.startSlot] = formatStackToken([note.sourceValue], grid.startOffsets[edit.slot] ?? 0);
		nextDurations[edit.slot] = grid.stepCycle;
		nextDurations[edit.startSlot] = Number((Math.round(durationCycles / durationResolution) * durationResolution).toFixed(6));
		needsDurationControl = true;
	}

	return replaceSourceTrackExpression(stretchedSource, trackId, ({ label, expression }) => {
		const noteCall = parseNoteCall(expression);
		if (!noteCall) return { label, expression };
		const durationCall = parseDurationCall(expression);
		const replacements: Array<{ start: number; end: number; value: string }> = [{
			start: noteCall.literalStart,
			end: noteCall.literalEnd,
			value: escapeString(nextTokens.join(' '), noteCall.quote),
		}];
		if (needsDurationControl || durationCall !== undefined) {
			const durationValues = durationSourceValues(grid, nextDurations);
			if (durationCall && durationCall !== 'unsupported') {
				replacements.push({
					start: durationCall.argumentStart,
					end: durationCall.argumentEnd,
					value: durationCall.content !== undefined
						? escapeString(durationValues.join(' '), durationCall.quote ?? '"')
						: JSON.stringify(durationValues.join(' ')),
				});
			} else if (needsDurationControl) {
				const durationCallText = `.dur(${JSON.stringify(durationValues.join(' '))})`;
				const insidePattern = /^\s*seqPLoop\s*\(/.test(expression) && isInsideSeqPLoopPart(expression, noteCall.callStart);
				if (insidePattern) {
					replacements.push({ start: noteCall.callEnd, end: noteCall.callEnd, value: durationCallText });
				} else {
					const replacedExpression = replacements
						.sort((left, right) => right.start - left.start)
						.reduce((current, replacement) => replaceRange(current, replacement.start, replacement.end, replacement.value), expression);
					return { label, expression: appendSourceExpressionCall(replacedExpression, durationCallText) };
				}
			}
		}
		return {
			label,
			expression: replacements
				.sort((left, right) => right.start - left.start)
				.reduce((current, replacement) => replaceRange(current, replacement.start, replacement.end, replacement.value), expression),
		};
	});
}
