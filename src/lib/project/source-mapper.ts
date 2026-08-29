import { getParsedSourceBlocks } from './source-parser';
import type { SourceBlockSummary, SourceRange } from './model';
import {
	getTrackEffectDefinition,
	getTrackEffectParameterDefinition,
	getUnknownTrackEffectDefinition,
	isExcludedTrackControl,
	isLikelyTrackEffectMethod,
	normalizeTrackEffectMethod,
	parseTrackEffectParameter,
	type TrackEffectDefinition,
	type TrackEffectGroup,
	type TrackEffectInput,
	type TrackEffectMethod,
	type TrackEffectParameter,
	type TrackEffectValueKind,
} from '../strudel/track-effects';
import {
	parseStrudelSoundArgument,
	type ParsedStrudelSoundArgument,
	type StrudelSoundDefinition,
} from '../strudel/sounds';

/**
 * The source document remains canonical; this module projects a marked block
 * and applies edits inside that complete block. Strudel effect metadata lives
 * in the shared library so this mapper does not need its own effect list.
 */
export interface SourceBlockDetails extends SourceBlockSummary {
	sourceRange: SourceRange;
	expressionRange?: SourceRange;
	label?: string;
	expression?: string;
	marker: boolean;
	timing: TrackTiming;
	visualizer?: TrackVisualizer;
	sound?: SourceSound;
	/** Every sound call in the lane, including voices nested in callbacks such as `.layer()`. */
	sounds: SourceSound[];
	sliders: SourceSlider[];
	effects: SourceEffect[];
	gain?: number;
	pan?: number;
	color?: string;
	gainEditable: boolean;
	panEditable: boolean;
	colorEditable: boolean;
	muted: boolean;
	soloed: boolean;
}

export interface SourceGlobals {
	bpm: number;
	quarterNotesPerCycle: number;
	key: string;
}

export type TrackTimingMode = 'full' | 'seqPLoop' | 'arrange';

/** A Strudel editor visualizer requested by a source track. */
export type TrackVisualizer = 'pianoroll' | 'scope' | 'spectrum';

/** Sound call location within a source lane. */
export type SourceSoundMethod = 's' | 'sound' | 'direct';

export type SourceSoundScope = 'track' | 'nested';

export interface SourceSound extends ParsedStrudelSoundArgument {
	/** Stable within a source lane for the current source projection. */
	id: string;
	method: SourceSoundMethod;
	/** Top-level calls are track voices; callback calls are nested voices. */
	scope: SourceSoundScope;
	/** Callback nesting depth, where zero means the track expression itself. */
	depth: number;
	/** Compact role label for editors (for example, `Main voice` or `Nested voice 2`). */
	label: string;
	definition?: StrudelSoundDefinition;
}

/** A numeric Strudel `slider(...)` widget projected onto a source lane. */
export interface SourceSlider {
	/** Stable within a source lane; based on the slider call's ordinal. */
	id: string;
	/** Human-readable method/control name, for example `lpf`. */
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
}

/** A Strudel effect call projected onto a source lane. */
export type SourceEffectMethod = TrackEffectMethod;
export type SourceEffectKind = TrackEffectValueKind;
export type SourceEffectValue = TrackEffectInput;

export interface SourceEffect {
	/** Stable within a source lane; based on the effect method and ordinal. */
	id: string;
	/** Canonical Strudel method used by the shared effect library. */
	method: SourceEffectMethod;
	/** The method metadata used by parsing, serialization, and the UI. */
	definition: TrackEffectDefinition;
	group: TrackEffectGroup;
	label: string;
	kind: SourceEffectKind;
	/** The original first argument, retained for dynamic/source-backed values. */
	expression: string;
	/** False when Sushi has wrapped the call in a source-level bypass comment. */
	enabled?: boolean;
	value?: number;
	min: number;
	max: number;
	step: number;
	defaultValue: number;
	supportsRandom: boolean;
	parameters: TrackEffectParameter[];
}

export interface TrackTiming {
	mode: TrackTimingMode;
	startCycle: number;
	endCycle: number;
}

export interface TrackDisplayTiming extends TrackTiming {
	displayEndCycle: number;
	repeating: boolean;
}

const labelPattern = /^(\s*)([A-Za-z_$][\w$]*)(\s*):(\s*)(.*)$/;
const markerLinePattern = /^(\s*\/\/\s*@sushi-track\s+)(\{.*\})(\s*)$/;
const numericLiteral = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?';
const DEFAULT_BPM = 150;
const DEFAULT_QUARTER_NOTES_PER_CYCLE = 4;
const DEFAULT_TRACK_END_CYCLE = 4;

const setcpmWithDivisionPattern = new RegExp(`(\\bsetcpm\\s*\\(\\s*)(${numericLiteral})(\\s*\\/\\s*)(${numericLiteral})(\\s*\\))`);
const setcpmSingleValuePattern = new RegExp(`(\\bsetcpm\\s*\\(\\s*)(${numericLiteral})(\\s*\\))`);
const keyDeclarationPattern = /^(\s*(?:const|let|var)\s+key\s*=\s*)(["'])([^"'\r\n]*)(\2)(\s*;?)/m;
const colorMethodPattern = /(\.color\s*\(\s*)(["'`])([^"'`\r\n]*)(\2)(\s*\))/;
const safeColorPattern = /^(?:#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8}|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()\r\n]*\)|[a-z]+)$/i;

export function getSourceGlobals(source: string): SourceGlobals {
	const tempoMatch = source.match(new RegExp(`\\bsetcpm\\s*\\(\\s*(${numericLiteral})(?:\\s*\\/\\s*(${numericLiteral}))?\\s*\\)`));
	const parsedBpm = tempoMatch ? Number(tempoMatch[1]) : DEFAULT_BPM;
	const parsedQuarterNotes = tempoMatch?.[2] ? Number(tempoMatch[2]) : DEFAULT_QUARTER_NOTES_PER_CYCLE;
	const keyMatch = source.match(/^\s*(?:const|let|var)\s+key\s*=\s*["']([^"']+)["']/m);
	return {
		bpm: Number.isFinite(parsedBpm) && parsedBpm >= 0 ? parsedBpm : DEFAULT_BPM,
		quarterNotesPerCycle: Number.isFinite(parsedQuarterNotes) && parsedQuarterNotes > 0 ? parsedQuarterNotes : DEFAULT_QUARTER_NOTES_PER_CYCLE,
		key: keyMatch?.[1] ?? 'E:minor',
	};
}

export function cyclesToSeconds(cycles: number, globals: SourceGlobals): number {
	if (globals.bpm <= 0) return 0;
	return cycles * 60 * globals.quarterNotesPerCycle / globals.bpm;
}

export function secondsToCycles(seconds: number, globals: SourceGlobals): number {
	if (globals.bpm <= 0) return 0;
	return seconds * globals.bpm / (60 * globals.quarterNotesPerCycle);
}

function prependGlobalDeclaration(source: string, declaration: string): string {
	return source.length ? `${declaration}\n${source}` : `${declaration}\n`;
}

/**
 * Update the canonical setcpm declaration while preserving the author's
 * spacing and whether they used the short single-value form. If a source has
 * no tempo declaration yet, add the canonical ratio form at the top.
 */
export function updateSourceTempo(source: string, bpm: number): string {
	if (!Number.isFinite(bpm) || bpm <= 0) return source;
	const formatted = formatNumber(bpm);
	if (setcpmWithDivisionPattern.test(source)) {
		return source.replace(setcpmWithDivisionPattern, (_match, prefix: string, _oldBpm: string, separator: string, _oldQuarterNotes: string, suffix: string) => `${prefix}${formatted}${separator}${_oldQuarterNotes}${suffix}`);
	}
	if (setcpmSingleValuePattern.test(source)) {
		return source.replace(setcpmSingleValuePattern, (_match, prefix: string, _oldBpm: string, suffix: string) => `${prefix}${formatted}${suffix}`);
	}
	return prependGlobalDeclaration(source, `setcpm(${formatted} / ${DEFAULT_QUARTER_NOTES_PER_CYCLE})`);
}

/**
 * Update the quarter-note divisor in setcpm. A source using setcpm(bpm)
 * receives the explicit ratio form so the UI's cycle model remains
 * round-trippable through source parsing.
 */
export function updateSourceQuarterNotesPerCycle(source: string, quarterNotesPerCycle: number): string {
	if (!Number.isFinite(quarterNotesPerCycle) || quarterNotesPerCycle <= 0) return source;
	const formatted = formatNumber(quarterNotesPerCycle);
	if (setcpmWithDivisionPattern.test(source)) {
		return source.replace(setcpmWithDivisionPattern, (_match, prefix: string, oldBpm: string, separator: string, _oldQuarterNotes: string, suffix: string) => `${prefix}${oldBpm}${separator}${formatted}${suffix}`);
	}
	if (setcpmSingleValuePattern.test(source)) {
		return source.replace(setcpmSingleValuePattern, (_match, prefix: string, oldBpm: string, suffix: string) => `${prefix}${oldBpm} / ${formatted}${suffix}`);
	}
	return prependGlobalDeclaration(source, `setcpm(${DEFAULT_BPM} / ${formatted})`);
}

/** Update the canonical key declaration, preserving its quote style. */
export function updateSourceKey(source: string, key: string): string {
	if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) return source;
	if (keyDeclarationPattern.test(source)) {
		return source.replace(keyDeclarationPattern, (_match, prefix: string, quote: string, _oldKey: string, _closingQuote: string, suffix: string) => `${prefix}${quote}${key}${quote}${suffix}`);
	}
	const declaration = `const key = ${JSON.stringify(key)}`;
	const tempo = source.match(/\bsetcpm\s*\([^\n\r]*\)/);
	if (tempo?.index !== undefined) {
		const lineEnd = source.indexOf('\n', tempo.index + tempo[0].length);
		if (lineEnd === -1) return `${source}\n${declaration}\n`;
		const insertAt = lineEnd + 1;
		return `${source.slice(0, insertAt)}${declaration}\n${source.slice(insertAt)}`;
	}
	return prependGlobalDeclaration(source, declaration);
}

/** Update BPM using the explicit ratio form required by the studio controls. */
export function updateSourceBpm(source: string, bpm: number): string {
	const normalizedBpm = Number.isFinite(bpm) ? Math.max(0, Math.min(300, bpm)) : DEFAULT_BPM;
	const globals = getSourceGlobals(source);
	const replacement = `setcpm(${formatNumber(normalizedBpm)} / ${formatNumber(globals.quarterNotesPerCycle)})`;
	const tempoPattern = /\bsetcpm\s*\(\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?(?:\s*\/\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)?\s*\)/;
	if (tempoPattern.test(source)) return source.replace(tempoPattern, replacement);
	return `${replacement}\n${source}`;
}

export function getSourceTrackTiming(expression: string, defaultEndCycle = DEFAULT_TRACK_END_CYCLE): TrackTiming {
	const trimmed = expression.trim();
	if (/^seqPLoop\s*\(/.test(trimmed)) {
		const pairs = Array.from(trimmed.matchAll(new RegExp(`\\[\\s*(${numericLiteral})\\s*,\\s*(${numericLiteral})\\s*,`, 'g')))
			.map((match) => ({ start: Number(match[1]), end: Number(match[2]) }))
			.filter((pair) => Number.isFinite(pair.start) && Number.isFinite(pair.end) && pair.end > pair.start);
		if (pairs.length) {
			return {
				mode: 'seqPLoop',
				startCycle: Math.min(...pairs.map((pair) => pair.start)),
				endCycle: Math.max(...pairs.map((pair) => pair.end)),
			};
		}
	}

	if (/^arrange\s*\(/.test(trimmed)) {
		const durations = Array.from(trimmed.matchAll(new RegExp(`\\[\\s*(${numericLiteral})\\s*,`, 'g')))
			.map((match) => Number(match[1]))
			.filter((duration) => Number.isFinite(duration) && duration > 0);
		if (durations.length) {
			return { mode: 'arrange', startCycle: 0, endCycle: durations.reduce((total, duration) => total + duration, 0) };
		}
	}

	return { mode: 'full', startCycle: 0, endCycle: defaultEndCycle };
}

/**
 * Project the visual span of a source timing expression without changing the
 * source-defined in/out range. seqPLoop patterns repeat their range, so the
 * lane should remain visible through the finite project boundary while its
 * editable loop end stays at the source-defined stop cycle.
 */
export function getTrackDisplayTiming(timing: TrackTiming, projectEndCycle: number): TrackDisplayTiming {
	const safeProjectEnd = Number.isFinite(projectEndCycle) && projectEndCycle > 0
		? projectEndCycle
		: timing.endCycle;
	const repeating = timing.mode === 'seqPLoop';
	return {
		...timing,
		displayEndCycle: repeating ? Math.max(timing.endCycle, safeProjectEnd) : timing.endCycle,
		repeating,
	};
}

function withoutCarriageReturn(line: string): { body: string; ending: string } {
	return line.endsWith('\r') ? { body: line.slice(0, -1), ending: '\r' } : { body: line, ending: '' };
}

function modeFromLabel(label: string | undefined): { muted: boolean; soloed: boolean } {
	return {
		muted: Boolean(label?.startsWith('_')),
		// A leading `S` is a Strudel solo prefix only when it is followed by
		// the conventional `$` label. Named lanes such as `Supersaw:` and
		// `Strings:` are ordinary authored labels, not soloed tracks.
		soloed: Boolean(label?.startsWith('S$')),
	};
}

/**
 * Strip Strudel's source-mode prefix without discarding an authored label.
 * Standard labels are `$`, `_$`, and `S$`, but regular Strudel files commonly
 * use names such as `lead$`; toggling a mode must keep that base label intact.
 */
function baseTrackLabel(label: string | undefined): string {
	const current = label?.trim() || '$';
	const withoutMode = current.startsWith('_') || current.startsWith('S$') ? current.slice(1) : current;
	return withoutMode || '$';
}

function topLevelMethodMatch(expression: string, pattern: RegExp): RegExpMatchArray | undefined {
	const callbackRanges = sourceCallbackRanges(expression);
	const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
	for (const match of expression.matchAll(new RegExp(pattern.source, flags))) {
		if (match.index === undefined || !sourceCallbackRangeAt(callbackRanges, match.index)) return match;
	}
	return undefined;
}

function numericMethodValue(expression: string, method: 'gain' | 'pan'): number | undefined {
	const match = topLevelMethodMatch(expression, new RegExp(`\\.${method}\\s*\\(\\s*(${numericLiteral})\\s*\\)`));
	if (!match) return undefined;
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : undefined;
}

function hasMethod(expression: string, method: string): boolean {
	return topLevelMethodMatch(expression, new RegExp(`\\.${method}\\s*\\(`)) !== undefined;
}

function normalizeSourceColor(value: string): string | undefined {
	const normalized = value.trim();
	return normalized && safeColorPattern.test(normalized) ? normalized : undefined;
}

function sourceColorValue(expression: string): string | undefined {
	const match = topLevelMethodMatch(expression, colorMethodPattern);
	return match ? normalizeSourceColor(match[3]) : undefined;
}

interface SourceSliderCall {
	index: number;
	start: number;
	end: number;
	valueStart: number;
	valueEnd: number;
	arguments: string[];
	label: string;
}

interface SourceEffectCall {
	method: SourceEffectMethod;
	definition: TrackEffectDefinition;
	ordinal: number;
	start: number;
	end: number;
	callStart: number;
	callEnd: number;
	valueStart: number;
	valueEnd: number;
	arguments: string[];
	enabled: boolean;
}

interface SourceSoundCall {
	method: SourceSoundMethod;
	callStart: number;
	callEnd: number;
	valueStart: number;
	valueEnd: number;
	arguments: string[];
}

function skipSourceString(source: string, start: number, end: number): number {
	const quote = source[start];
	let escaped = false;
	for (let index = start + 1; index < end; index += 1) {
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
	return end;
}

function findMatchingCallEnd(source: string, open: number): number | undefined {
	let depth = 1;
	for (let index = open + 1; index < source.length; index += 1) {
		const character = source[index];
		const next = source[index + 1];
		if (character === '"' || character === "'" || character === '`') {
			index = skipSourceString(source, index, source.length) - 1;
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

function findMatchingDelimiter(source: string, open: number, opening: string, closing: string): number | undefined {
	let depth = 1;
	for (let index = open + 1; index < source.length; index += 1) {
		const character = source[index];
		const next = source[index + 1];
		if (character === '"' || character === "'" || character === '`') {
			index = skipSourceString(source, index, source.length) - 1;
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
		if (character === opening) depth += 1;
		if (character === closing && --depth === 0) return index;
	}
	return undefined;
}

interface SourceCallbackRange {
	start: number;
	end: number;
}

function findArrowExpressionEnd(source: string, start: number): number {
	let depth = 0;
	for (let index = start; index < source.length; index += 1) {
		const character = source[index];
		const next = source[index + 1];
		if (character === '"' || character === "'" || character === '`') {
			index = skipSourceString(source, index, source.length) - 1;
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
		if (character === '(' || character === '[' || character === '{') {
			depth += 1;
			continue;
		}
		if (character === ')' || character === ']' || character === '}') {
			if (depth === 0) return index;
			depth -= 1;
			continue;
		}
		if (depth === 0 && (character === ',' || character === ';')) return index;
	}
	return source.length;
}

/**
 * Locate callback bodies so source projections can keep nested pattern code
 * intact while still discovering controls inside wrappers such as seqPLoop.
 */
function sourceCallbackRanges(expression: string): SourceCallbackRange[] {
	const ranges: SourceCallbackRange[] = [];
	for (let index = 0; index < expression.length; index += 1) {
		const character = expression[index];
		const next = expression[index + 1];
		if (character === '"' || character === "'" || character === '`') {
			index = skipSourceString(expression, index, expression.length) - 1;
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
		if (expression.startsWith('=>', index)) {
			let bodyStart = index + 2;
			while (/\s/.test(expression[bodyStart] ?? '')) bodyStart += 1;
			if (expression[bodyStart] === '{') {
				const close = findMatchingDelimiter(expression, bodyStart, '{', '}');
				ranges.push({ start: bodyStart, end: close === undefined ? expression.length : close + 1 });
				if (close !== undefined) index = close;
				continue;
			}
			ranges.push({ start: bodyStart, end: findArrowExpressionEnd(expression, bodyStart) });
			continue;
		}
		if (!expression.startsWith('function', index) || /[-\w$]/.test(expression[index - 1] ?? '') || /[-\w$]/.test(expression[index + 8] ?? '')) continue;
		let bodyStart = index + 8;
		let parameterDepth = 0;
		for (; bodyStart < expression.length; bodyStart += 1) {
			const bodyCharacter = expression[bodyStart];
			if (bodyCharacter === '"' || bodyCharacter === "'" || bodyCharacter === '`') {
				bodyStart = skipSourceString(expression, bodyStart, expression.length) - 1;
				continue;
			}
			if (bodyCharacter === '(') parameterDepth += 1;
			if (bodyCharacter === ')' && parameterDepth > 0) parameterDepth -= 1;
			if (bodyCharacter === '{' && parameterDepth === 0) break;
		}
		if (expression[bodyStart] !== '{') continue;
		const close = findMatchingDelimiter(expression, bodyStart, '{', '}');
		ranges.push({ start: bodyStart, end: close === undefined ? expression.length : close + 1 });
		if (close !== undefined) index = close;
	}
	return ranges;
}

function sourceCallbackRangeAt(ranges: readonly SourceCallbackRange[], index: number): SourceCallbackRange | undefined {
	return ranges.find((range) => index >= range.start && index < range.end);
}

function splitCallArguments(source: string, start: number, end: number): Array<{ start: number; end: number; text: string }> {
	const result: Array<{ start: number; end: number; text: string }> = [];
	let argumentStart = start;
	let depth = 0;
	for (let index = start; index < end; index += 1) {
		const character = source[index];
		const next = source[index + 1];
		if (character === '"' || character === "'" || character === '`') {
			index = skipSourceString(source, index, end) - 1;
			continue;
		}
		if (character === '/' && next === '/') {
			const lineEnd = source.indexOf('\n', index + 2);
			index = (lineEnd === -1 ? end : Math.min(lineEnd, end)) - 1;
			continue;
		}
		if (character === '/' && next === '*') {
			const commentEnd = source.indexOf('*/', index + 2);
			index = (commentEnd === -1 ? end : Math.min(commentEnd + 2, end)) - 1;
			continue;
		}
		if (character === '(' || character === '[' || character === '{') depth += 1;
		if (character === ')' || character === ']' || character === '}') depth = Math.max(0, depth - 1);
		if (character === ',' && depth === 0) {
			result.push({ start: argumentStart, end: index, text: source.slice(argumentStart, index) });
			argumentStart = index + 1;
		}
	}
	result.push({ start: argumentStart, end, text: source.slice(argumentStart, end) });
	return result;
}

function parseSourceSoundMethod(expression: string, start: number, method: 's' | 'sound'): SourceSoundCall | undefined {
	const previous = expression[start - 1] ?? '';
	const afterMethod = expression[start + method.length] ?? '';
	if (/[-\w$]/.test(previous) || /[-\w$]/.test(afterMethod)) return undefined;
	let open = start + method.length;
	while (/\s/.test(expression[open] ?? '')) open += 1;
	if (expression[open] !== '(') return undefined;
	const close = findMatchingCallEnd(expression, open);
	if (close === undefined) return undefined;
	const args = splitCallArguments(expression, open + 1, close);
	const firstArgument = args[0];
	if (!firstArgument || !firstArgument.text.trim()) return undefined;
	return {
		method,
		callStart: start,
		callEnd: close + 1,
		valueStart: firstArgument.start,
		valueEnd: firstArgument.end,
		arguments: args.map((argument) => argument.text),
	};
}

function parseDirectSourceSound(expression: string, start: number): SourceSoundCall | undefined {
	let firstArgumentStart = start + 1;
	while (/\s/.test(expression[firstArgumentStart] ?? '')) firstArgumentStart += 1;
	if (!['"', "'", '`'].includes(expression[firstArgumentStart] ?? '')) return undefined;
	const close = findMatchingCallEnd(expression, start);
	if (close === undefined) return undefined;
	const after = expression.slice(close + 1);
	if (!/^\s*\.note\s*\(/.test(after)) return undefined;
	return {
		method: 'direct',
		callStart: start,
		callEnd: close + 1,
		valueStart: start + 1,
		valueEnd: close,
		arguments: [expression.slice(start + 1, close)],
	};
}

function sourceSoundCalls(expression: string, includeNested = false): SourceSoundCall[] {
	const calls: SourceSoundCall[] = [];
	const callbackRanges = sourceCallbackRanges(expression);
	for (let index = 0; index < expression.length; index += 1) {
		const character = expression[index];
		const next = expression[index + 1];
		if (character === '"' || character === "'" || character === '`') {
			index = skipSourceString(expression, index, expression.length) - 1;
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
		if (!includeNested) {
			const callbackRange = sourceCallbackRangeAt(callbackRanges, index);
			if (callbackRange) {
				index = callbackRange.end - 1;
				continue;
			}
		}
		if (expression.startsWith('sound', index)) {
			const parsed = parseSourceSoundMethod(expression, index, 'sound');
			if (parsed) {
				calls.push(parsed);
				index = parsed.callEnd - 1;
				continue;
			}
		}
		if (character === 's') {
			const parsed = parseSourceSoundMethod(expression, index, 's');
			if (parsed) {
				calls.push(parsed);
				index = parsed.callEnd - 1;
				continue;
			}
		}
		if (character === '(') {
			const parsed = parseDirectSourceSound(expression, index);
			if (parsed) {
				calls.push(parsed);
				index = parsed.callEnd - 1;
				continue;
			}
		}
	}
	return calls;
}

/**
 * Project every sound call, including calls inside callback bodies such as
 * `.layer(x => x.sound("supersaw"), x => x.sound("sine"))`.
 *
 * Top-level source edits continue to use `sourceSoundCalls(expression)` so
 * existing track-level behavior remains source-safe. Nested entries get an
 * ordinal id that the drawer can pass back when editing a specific voice.
 */
function sourceSoundValues(expression: string): SourceSound[] {
	const calls = sourceSoundCalls(expression, true);
	const callbackRanges = sourceCallbackRanges(expression);
	let trackOrdinal = 0;
	let nestedOrdinal = 0;

	return calls.flatMap((call, index) => {
		const parsed = parseStrudelSoundArgument(call.arguments[0]);
		if (!parsed) return [];
		const depth = callbackRanges.filter((range) => call.callStart >= range.start && call.callStart < range.end).length;
		const scope: SourceSoundScope = depth > 0 ? 'nested' : 'track';
		const ordinal = scope === 'nested' ? nestedOrdinal++ : trackOrdinal++;
		return [{
			id: `sound-${index}`,
			method: call.method,
			scope,
			depth,
			label: scope === 'nested'
				? `Nested voice ${ordinal + 1}`
				: ordinal === 0 ? 'Main voice' : `Track voice ${ordinal + 1}`,
			...parsed,
		}];
	});
}

function sliderMethodLabel(expression: string, start: number, index: number): string {
	const prefix = expression.slice(0, start);
	const method = prefix.match(/\.([A-Za-z_$][\w$]*)\s*\(\s*$/)?.[1];
	return method ? method.toUpperCase() : `SLIDER ${index + 1}`;
}

function parseSourceEffectCall(expression: string, start: number): Omit<SourceEffectCall, 'ordinal' | 'enabled' | 'start' | 'end'> & { callStart: number; callEnd: number } | undefined {
	if (expression[start] !== '.') return undefined;
	let methodEnd = start + 1;
	while (/[A-Za-z0-9_$]/.test(expression[methodEnd] ?? '')) methodEnd += 1;
	const sourceMethod = expression.slice(start + 1, methodEnd);
	if (isExcludedTrackControl(sourceMethod) || !isLikelyTrackEffectMethod(sourceMethod)) return undefined;
	const definition = getTrackEffectDefinition(sourceMethod) ?? getUnknownTrackEffectDefinition(sourceMethod);
	let open = methodEnd;
	while (/\s/.test(expression[open] ?? '')) open += 1;
	if (expression[open] !== '(') return undefined;
	const close = findMatchingCallEnd(expression, open);
	if (close === undefined) return undefined;
	const args = splitCallArguments(expression, open + 1, close);
	const firstArg = args[0];
	// Zero-argument controls (for example `.delay()`) still belong to the
	// chain. They cannot expose a value editor, but they must remain available
	// for bypass, reorder, and removal instead of disappearing from the model.
	if (!firstArg || (args.length > 1 && !firstArg.text.trim())) return undefined;
	return {
		method: normalizeTrackEffectMethod(sourceMethod),
		definition,
		callStart: start,
		callEnd: close + 1,
		valueStart: firstArg.start,
		valueEnd: firstArg.end,
		arguments: args.map((argument) => argument.text),
	};
}

function sourceSliderCalls(expression: string): SourceSliderCall[] {
	const calls: SourceSliderCall[] = [];
	const callbackRanges = sourceCallbackRanges(expression);
	let callIndex = 0;
	for (let index = 0; index < expression.length; index += 1) {
		const character = expression[index];
		const next = expression[index + 1];
		if (character === '"' || character === "'" || character === '`') {
			index = skipSourceString(expression, index, expression.length) - 1;
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
		const callbackRange = sourceCallbackRangeAt(callbackRanges, index);
		if (callbackRange) {
			index = callbackRange.end - 1;
			continue;
		}
		if (!expression.startsWith('slider', index) || /[\w$]/.test(expression[index - 1] ?? '') || /[\w$]/.test(expression[index + 6] ?? '')) continue;
		let open = index + 6;
		while (/\s/.test(expression[open] ?? '')) open += 1;
		if (expression[open] !== '(') continue;
		const close = findMatchingCallEnd(expression, open);
		if (close === undefined) continue;
		const args = splitCallArguments(expression, open + 1, close);
		const firstArg = args[0];
		if (firstArg && firstArg.text.trim()) {
			calls.push({
				index: callIndex,
				start: index,
				end: close + 1,
				valueStart: firstArg.start,
				valueEnd: firstArg.end,
				arguments: args.map((argument) => argument.text),
				label: sliderMethodLabel(expression, index, callIndex),
			});
		}
		callIndex += 1;
		index = close;
	}
	return calls;
}

function sourceEffectCalls(expression: string): SourceEffectCall[] {
	const calls: SourceEffectCall[] = [];
	const ordinals = new Map<SourceEffectMethod, number>();
	const callbackRanges = sourceCallbackRanges(expression);
	const nextOrdinal = (method: SourceEffectMethod): number => {
		const ordinal = ordinals.get(method) ?? 0;
		ordinals.set(method, ordinal + 1);
		return ordinal;
	};
	for (let index = 0; index < expression.length; index += 1) {
		const character = expression[index];
		const next = expression[index + 1];
		if (character === '"' || character === "'" || character === '`') {
			index = skipSourceString(expression, index, expression.length) - 1;
			continue;
		}
		if (character === '/' && next === '/') {
			const lineEnd = expression.indexOf('\n', index + 2);
			index = (lineEnd === -1 ? expression.length : lineEnd) - 1;
			continue;
		}
		if (character === '/' && next === '*') {
			const commentEnd = expression.indexOf('*/', index + 2);
			if (commentEnd === -1) {
				index = expression.length - 1;
				continue;
			}
			const callbackRange = sourceCallbackRangeAt(callbackRanges, index);
			if (!callbackRange) {
				const commentBodyStart = index + 2;
				const commentBody = expression.slice(commentBodyStart, commentEnd);
				const bypassMarker = commentBody.match(/^\s*@sushi-bypass\s+/);
				if (bypassMarker) {
					const callStart = commentBodyStart + bypassMarker[0].length;
					const parsed = parseSourceEffectCall(expression, callStart);
					if (parsed && parsed.callEnd <= commentEnd && !expression.slice(parsed.callEnd, commentEnd).trim()) {
						calls.push({
							...parsed,
							ordinal: nextOrdinal(parsed.method),
							start: index,
							end: commentEnd + 2,
							enabled: false,
						});
					}
				}
			}
			index = commentEnd + 1;
			continue;
		}
		const callbackRange = sourceCallbackRangeAt(callbackRanges, index);
		if (callbackRange) {
			index = callbackRange.end - 1;
			continue;
		}
		if (character !== '.') continue;
		const parsed = parseSourceEffectCall(expression, index);
		if (!parsed) continue;
		calls.push({
			...parsed,
			ordinal: nextOrdinal(parsed.method),
			start: parsed.callStart,
			end: parsed.callEnd,
			enabled: true,
		});
		index = parsed.callEnd - 1;
	}
	return calls;
}

function numericSliderArgument(value: string | undefined): number | undefined {
	if (value === undefined || !value.trim()) return undefined;
	const trimmed = value.trim();
	if (!new RegExp(`^${numericLiteral}$`).test(trimmed)) return undefined;
	const numeric = Number(trimmed);
	return Number.isFinite(numeric) ? numeric : undefined;
}

function sourceSliders(expression: string): SourceSlider[] {
	return sourceSliderCalls(expression).flatMap((call) => {
		const value = numericSliderArgument(call.arguments[0]);
		if (value === undefined) return [];
		const min = numericSliderArgument(call.arguments[1]) ?? 0;
		const max = numericSliderArgument(call.arguments[2]) ?? 1;
		if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [];
		const step = numericSliderArgument(call.arguments[3]);
		return [{
			id: `slider-${call.index}`,
			label: call.label,
			value: Math.max(Math.min(value, Math.max(min, max)), Math.min(min, max)),
			min: Math.min(min, max),
			max: Math.max(min, max),
			...(step !== undefined && step > 0 ? { step } : {}),
		}];
	});
}

function sourceEffects(expression: string): SourceEffect[] {
	return sourceEffectCalls(expression).flatMap((call) => {
		const parameters = call.arguments.map((argument, index) => parseTrackEffectParameter(call.definition, index, argument));
		const firstParameter = parameters[0] ?? parseTrackEffectParameter(call.definition, 0, '');
		const numericValue = firstParameter.value;
		const min = firstParameter.min ?? 0;
		const max = firstParameter.max ?? Math.max(1, numericValue ?? 0);
		const step = firstParameter.step ?? (max - min > 20 ? 1 : 0.01);
		const defaultValue = typeof firstParameter.defaultValue === 'number' ? firstParameter.defaultValue : 0;
		return [{
			id: `effect-${call.method}-${call.ordinal}`,
			method: call.method,
			definition: call.definition,
			group: call.definition.group,
			label: call.definition.label,
			kind: firstParameter.kind,
			expression: firstParameter.expression,
			...(call.enabled ? {} : { enabled: false }),
			...(numericValue === undefined ? {} : { value: Math.max(min, Math.min(max, numericValue)) }),
			min,
			max,
			step,
			defaultValue,
			supportsRandom: firstParameter.supportsRandom,
			parameters,
		}];
	});
}

function withoutSourceComments(source: string): string {
	let result = '';
	let quote: string | undefined;
	let escaped = false;
	for (let index = 0; index < source.length; index += 1) {
		const character = source[index];
		const next = source[index + 1];
		if (quote) {
			result += character;
			if (escaped) escaped = false;
			else if (character === '\\') escaped = true;
			else if (character === quote) quote = undefined;
			continue;
		}
		if (character === '"' || character === "'" || character === '`') {
			quote = character;
			result += character;
			continue;
		}
		if (character === '/' && next === '/') {
			while (index < source.length && source[index] !== '\n') index += 1;
			result += '\n';
			continue;
		}
		if (character === '/' && next === '*') {
			index += 2;
			while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
			if (index < source.length) index += 1;
			result += ' ';
			continue;
		}
		result += character;
	}
	return result;
}

function sourceVisualizerValue(expression: string): TrackVisualizer | undefined {
	const uncommentedExpression = withoutSourceComments(expression);
	const pianorollIndex = uncommentedExpression.search(/\._pianoroll\s*\(/);
	const scopeIndex = uncommentedExpression.search(/\._scope\s*\(/);
	const spectrumIndex = uncommentedExpression.search(/\._spectrum\s*\(/);
	if (pianorollIndex < 0 && scopeIndex < 0 && spectrumIndex < 0) return undefined;
	if (spectrumIndex > pianorollIndex && spectrumIndex > scopeIndex) return 'spectrum';
	return scopeIndex > pianorollIndex ? 'scope' : 'pianoroll';
}

export function getSourceBlockDetails(source: string, defaultEndCycle = DEFAULT_TRACK_END_CYCLE): SourceBlockDetails[] {
	return getParsedSourceBlocks(source).map((block): SourceBlockDetails => {
		if (!block.expressionRange || !block.label || block.expression === undefined) {
			return {
				...block,
				timing: { mode: 'full', startCycle: 0, endCycle: defaultEndCycle },
				sound: undefined,
				sounds: [],
				sliders: [],
				effects: [],
				gainEditable: false,
				panEditable: false,
				colorEditable: false,
				muted: false,
				soloed: false,
			};
		}

		const expression = block.expression;
		const modes = modeFromLabel(block.label);
		const gain = numericMethodValue(expression, 'gain');
		const pan = numericMethodValue(expression, 'pan');
		const color = sourceColorValue(expression);
		const visualizer = sourceVisualizerValue(expression);
		const sounds = sourceSoundValues(expression);
		// Prefer a track-level sound as the primary source summary. A layer-only
		// expression still gets its first nested voice so it remains editable in
		// the drawer instead of appearing to have no sound at all.
		const sound = sounds.find((candidate) => candidate.scope === 'track') ?? sounds[0];
		const sliders = sourceSliders(expression);
		const effects = sourceEffects(expression);
		return {
			...block,
			timing: getSourceTrackTiming(expression, defaultEndCycle),
			...(visualizer === undefined ? {} : { visualizer }),
			...(sound === undefined ? {} : { sound }),
			sounds,
			sliders,
			effects,
			gain,
			pan,
			...(color === undefined ? {} : { color }),
			gainEditable: !hasMethod(expression, 'gain') || gain !== undefined,
			panEditable: !hasMethod(expression, 'pan') || pan !== undefined,
			colorEditable: !hasMethod(expression, 'color') || color !== undefined,
			...modes,
		};
	});
}

function replaceExpressionBlock(
	source: string,
	trackId: string,
	transform: (parts: { label: string; expression: string }) => { label: string; expression: string },
): string {
	const details = getSourceBlockDetails(source).find((block) => block.id === trackId);
	if (!details?.expressionRange || !details.label || details.expression === undefined) return source;

	const block = source.slice(details.expressionRange.start, details.expressionRange.end);
	const newlineIndex = block.indexOf('\n');
	const firstLine = newlineIndex === -1 ? block : block.slice(0, newlineIndex);
	const continuation = newlineIndex === -1 ? '' : block.slice(newlineIndex);
	const { body, ending } = withoutCarriageReturn(firstLine);
	const match = body.match(labelPattern);
	if (!match) return source;

	const [, indent, label, labelSpacing, afterColon] = match;
	const next = transform({ label, expression: `${match[5]}${ending}${continuation}` });
	const replacement = `${indent}${next.label}${labelSpacing}:${afterColon}${next.expression}`;
	return `${source.slice(0, details.expressionRange.start)}${replacement}${source.slice(details.expressionRange.end)}`;
}

function formatNumber(value: number): string {
	// Keep enough precision for musical subdivisions (for example a 1/8-cycle
	// edit at 8 quarter-notes per cycle) while still avoiding floating-point
	// noise in generated source. Two decimal places silently changed 0.125 to
	// 0.13, which moved the edit off the source's actual grid.
	const rounded = Math.round(value * 1_000_000) / 1_000_000;
	return String(rounded);
}

/**
 * Keep trailing source comments outside generated method chains. A comment at
 * the end of a `$:` block is source content, not part of the executable
 * expression; appending `.gain(...)` after it would either be ignored or turn
 * the next line into invalid JavaScript.
 */
function splitTrailingComment(expression: string): { body: string; suffix: string } {
	const inlineComment = expression.match(/([\s\S]*?)([ \t]+\/\/[^\r\n]*)([ \t]*(?:\r?\n[ \t]*)*)$/);
	if (inlineComment) {
		return {
			body: inlineComment[1],
			suffix: `${inlineComment[2]}${inlineComment[3]}`,
		};
	}
	const lineComment = expression.match(/([\s\S]*?)(\r?\n[ \t]*\/\/[^\r\n]*(?:[ \t]*\r?\n[ \t]*\/\/[^\r\n]*)*)([ \t]*(?:\r?\n[ \t]*)*)$/);
	if (lineComment) {
		return {
			body: lineComment[1],
			suffix: `${lineComment[2]}${lineComment[3]}`,
		};
	}
	const blockComment = expression.match(/(\s*)(\/\*[\s\S]*?\*\/)(\s*)$/);
	if (blockComment) {
		return {
			body: expression.slice(0, expression.length - blockComment[0].length),
			suffix: blockComment[0],
		};
	}
	return { body: expression, suffix: '' };
}

function appendExpressionCall(expression: string, call: string): string {
	const { body: withoutComment, suffix } = splitTrailingComment(expression);
	const trailingWhitespace = withoutComment.match(/\s*$/)?.[0] ?? '';
	const expressionBody = trailingWhitespace ? withoutComment.slice(0, -trailingWhitespace.length) : withoutComment;
	const semicolon = expressionBody.endsWith(';') ? ';' : '';
	const body = semicolon ? expressionBody.slice(0, -1) : expressionBody;
	return `${body}${call}${semicolon}${trailingWhitespace}${suffix}`;
}

function wrapExpressionInSeqPLoop(expression: string, start: number, end: number): string {
	const { body: withoutComment, suffix } = splitTrailingComment(expression);
	const trailingWhitespace = withoutComment.match(/\s*$/)?.[0] ?? '';
	const expressionBody = trailingWhitespace ? withoutComment.slice(0, -trailingWhitespace.length) : withoutComment;
	const semicolon = expressionBody.endsWith(';') ? ';' : '';
	const body = semicolon ? expressionBody.slice(0, -1) : expressionBody;
	return `seqPLoop([${formatNumber(start)}, ${formatNumber(end)}, ${body}])${semicolon}${trailingWhitespace}${suffix}`;
}

function replaceNumericMethod(expression: string, method: 'gain' | 'pan', value: number): string | undefined {
	const methodPattern = new RegExp(`(\\.${method}\\s*\\(\\s*)(${numericLiteral})(\\s*\\))`);
	const match = topLevelMethodMatch(expression, methodPattern);
	if (match && match.index !== undefined) {
		const replacement = `${match[1]}${formatNumber(value)}${match[3]}`;
		return `${expression.slice(0, match.index)}${replacement}${expression.slice(match.index + match[0].length)}`;
	}
	if (hasMethod(expression, method)) return undefined;
	return appendExpressionCall(expression, `.${method}(${formatNumber(value)})`);
}

function updateNumericMethod(source: string, trackId: string, method: 'gain' | 'pan', value: number): string {
	if (!Number.isFinite(value)) return source;
	const normalized = Math.max(0, Math.min(1, value));
	return replaceExpressionBlock(source, trackId, ({ label, expression }) => {
		const updatedExpression = replaceNumericMethod(expression, method, normalized);
		return updatedExpression === undefined ? { label, expression } : { label, expression: updatedExpression };
	});
}

export function updateTrackGain(source: string, trackId: string, value: number): string {
	return updateNumericMethod(source, trackId, 'gain', value);
}

export function updateTrackPan(source: string, trackId: string, value: number): string {
	return updateNumericMethod(source, trackId, 'pan', value);
}

function formatSliderValue(value: number, step?: number): string {
	// Preserve compact source while respecting decimal slider steps. Most
	// Strudel controls use integral values, but values such as `.75` are common
	// for gain and modulation controls.
	const precision = step !== undefined && step < 1
		? Math.min(8, Math.max(2, (String(step).split('.')[1] ?? '').length + 1))
		: 6;
	const rounded = Math.round(value * 10 ** precision) / 10 ** precision;
	return formatNumber(rounded);
}

function replaceCallFirstArgument(
	expression: string,
	call: Pick<SourceSliderCall | SourceEffectCall, 'valueStart' | 'valueEnd' | 'arguments'>,
	replacement: string,
): string {
	const firstArgument = call.arguments[0] ?? '';
	const leadingWhitespace = firstArgument.match(/^\s*/)?.[0].length ?? 0;
	const trailingWhitespace = firstArgument.match(/\s*$/)?.[0].length ?? 0;
	const valueStart = call.valueStart + leadingWhitespace;
	const valueEnd = Math.max(valueStart, call.valueEnd - trailingWhitespace);
	return `${expression.slice(0, valueStart)}${replacement}${expression.slice(valueEnd)}`;
}

/** Update one numeric `slider(...)` widget without disturbing its bounds. */
export function updateTrackSlider(source: string, trackId: string, sliderId: string, value: number): string {
	if (!Number.isFinite(value)) return source;
	const match = sliderId.match(/^slider-(\d+)$/);
	if (!match) return source;
	const sliderIndex = Number(match[1]);
	if (!Number.isInteger(sliderIndex) || sliderIndex < 0) return source;

	return replaceExpressionBlock(source, trackId, ({ label, expression }) => {
		const call = sourceSliderCalls(expression).find((candidate) => candidate.index === sliderIndex);
		if (!call) return { label, expression };
		const current = numericSliderArgument(call.arguments[0]);
		const min = numericSliderArgument(call.arguments[1]) ?? 0;
		const max = numericSliderArgument(call.arguments[2]) ?? 1;
		if (current === undefined || !Number.isFinite(min) || !Number.isFinite(max) || min === max) return { label, expression };
		const step = numericSliderArgument(call.arguments[3]);
		const next = Math.max(Math.min(value, Math.max(min, max)), Math.min(min, max));
		return {
			label,
			expression: replaceCallFirstArgument(expression, call, formatSliderValue(next, step)),
		};
	});
}

function effectIdParts(effectId: string): { method: SourceEffectMethod; ordinal: number } | undefined {
	const match = effectId.match(/^effect-([A-Za-z_$][\w$]*)-(\d+)$/);
	if (!match) return undefined;
	const ordinal = Number(match[2]);
	return Number.isInteger(ordinal) && ordinal >= 0
		? { method: normalizeTrackEffectMethod(match[1]), ordinal }
		: undefined;
}

function effectNumericBounds(definition: TrackEffectDefinition, parameterIndex: number, current: number | undefined): { min: number; max: number } {
	const parameter = getTrackEffectParameterDefinition(definition, parameterIndex);
	const min = parameter.min ?? 0;
	const max = parameter.max ?? 1;
	return {
		min,
		max: current === undefined ? max : Math.max(max, current),
	};
}

function formatEffectArgument(value: SourceEffectValue, definition: TrackEffectDefinition, parameterIndex: number): string {
	if (typeof value === 'number') {
		const parameter = getTrackEffectParameterDefinition(definition, parameterIndex);
		return formatSliderValue(value, parameter.step);
	}
	if (value === 'rand') return value;
	const parameter = getTrackEffectParameterDefinition(definition, parameterIndex);
	if (parameter.type === 'option' && !/^['"`]/.test(value.trim())) return JSON.stringify(value);
	return value;
}

/** Update one Strudel FX call, preserving dynamic/random modes. */
export function updateTrackEffect(source: string, trackId: string, effectId: string, value: SourceEffectValue, parameterIndex = 0): string {
	const parts = effectIdParts(effectId);
	if (!parts) return source;

	return replaceExpressionBlock(source, trackId, ({ label, expression }) => {
		const call = sourceEffectCalls(expression).find((candidate) => candidate.method === parts.method && candidate.ordinal === parts.ordinal);
		if (!call) return { label, expression };
		const parameter = getTrackEffectParameterDefinition(call.definition, parameterIndex);
		if (value === 'rand' && !parameter.supportsRandom) return { label, expression };
		const current = numericSliderArgument(call.arguments[parameterIndex]);
		if (typeof value === 'number') {
			const bounds = effectNumericBounds(call.definition, parameterIndex, current);
			const normalized = Math.max(bounds.min, Math.min(bounds.max, value));
			const argumentRanges = splitCallArguments(expression, call.callStart + expression.slice(call.callStart, call.callEnd).indexOf('(') + 1, call.callEnd - 1);
			const range = argumentRanges[parameterIndex];
			if (!range) return { label, expression };
			return {
				label,
				expression: replaceCallFirstArgument(expression, { ...call, arguments: [call.arguments[parameterIndex] ?? ''], valueStart: range.start, valueEnd: range.end }, formatEffectArgument(normalized, call.definition, parameterIndex)),
			};
		}
		const argumentRanges = splitCallArguments(expression, call.callStart + expression.slice(call.callStart, call.callEnd).indexOf('(') + 1, call.callEnd - 1);
		const range = argumentRanges[parameterIndex];
		if (!range) return { label, expression };
		return {
			label,
			expression: replaceCallFirstArgument(expression, { ...call, arguments: [call.arguments[parameterIndex] ?? ''], valueStart: range.start, valueEnd: range.end }, formatEffectArgument(value, call.definition, parameterIndex)),
		};
	});
}

/** Add one library effect if the track does not already use it. */
export function addTrackEffect(source: string, trackId: string, method: SourceEffectMethod): string {
	const definition = getTrackEffectDefinition(method);
	if (!definition || !definition.addable) return source;
	return replaceExpressionBlock(source, trackId, ({ label, expression }) => {
		if (sourceEffectCalls(expression).some((call) => call.method === definition.method)) return { label, expression };
		const firstParameter = getTrackEffectParameterDefinition(definition, 0);
		if (firstParameter.type === 'expression') return { label, expression };
		const defaultValue = firstParameter.defaultValue;
		const argument = typeof defaultValue === 'number'
			? formatSliderValue(defaultValue, firstParameter.step)
			: formatEffectArgument(String(defaultValue), definition, 0);
		return {
			label,
			expression: appendExpressionCall(expression, `.${definition.method}(${argument})`),
		};
	});
}

/** Remove one supported Strudel effect call while keeping the chain valid. */
export function removeTrackEffect(source: string, trackId: string, effectId: string): string {
	const parts = effectIdParts(effectId);
	if (!parts) return source;
	return replaceExpressionBlock(source, trackId, ({ label, expression }) => {
		const call = sourceEffectCalls(expression).find((candidate) => candidate.method === parts.method && candidate.ordinal === parts.ordinal);
		if (!call) return { label, expression };
		return { label, expression: `${expression.slice(0, call.start)}${expression.slice(call.end)}` };
	});
}

/** Enable or bypass one supported Strudel FX call without losing its value. */
export function toggleTrackEffect(source: string, trackId: string, effectId: string, enabled: boolean): string {
	const parts = effectIdParts(effectId);
	if (!parts) return source;
	return replaceExpressionBlock(source, trackId, ({ label, expression }) => {
		const call = sourceEffectCalls(expression).find((candidate) => candidate.method === parts.method && candidate.ordinal === parts.ordinal);
		if (!call || call.enabled === enabled) return { label, expression };
		const callText = expression.slice(call.callStart, call.callEnd);
		const replacement = enabled ? callText : `/* @sushi-bypass ${callText} */`;
		return {
			label,
			expression: `${expression.slice(0, call.start)}${replacement}${expression.slice(call.end)}`,
		};
	});
}

/** Enable or bypass every Strudel FX call in a source lane in one edit. */
export function setTrackEffectsEnabled(source: string, trackId: string, enabled: boolean): string {
	return replaceExpressionBlock(source, trackId, ({ label, expression }) => {
		const calls = sourceEffectCalls(expression).filter((call) => call.enabled !== enabled);
		if (!calls.length) return { label, expression };

		// Work from right to left so the source ranges collected above remain
		// valid while each call is replaced with its enabled/bypassed form.
		let updatedExpression = expression;
		for (let index = calls.length - 1; index >= 0; index -= 1) {
			const call = calls[index];
			const callText = expression.slice(call.callStart, call.callEnd);
			const replacement = enabled ? callText : `/* @sushi-bypass ${callText} */`;
			updatedExpression = `${updatedExpression.slice(0, call.start)}${replacement}${updatedExpression.slice(call.end)}`;
		}
		return { label, expression: updatedExpression };
	});
}

/** Move one supported Strudel FX call within its source chain. */
export function reorderTrackEffect(source: string, trackId: string, effectId: string, direction: 'up' | 'down'): string {
	const parts = effectIdParts(effectId);
	if (!parts) return source;
	return replaceExpressionBlock(source, trackId, ({ label, expression }) => {
		const calls = sourceEffectCalls(expression);
		const targetIndex = calls.findIndex((candidate) => candidate.method === parts.method && candidate.ordinal === parts.ordinal);
		if (targetIndex < 0) return { label, expression };
		const neighborIndex = targetIndex + (direction === 'up' ? -1 : 1);
		if (neighborIndex < 0 || neighborIndex >= calls.length) return { label, expression };
		const firstIndex = Math.min(targetIndex, neighborIndex);
		const secondIndex = Math.max(targetIndex, neighborIndex);
		const first = calls[firstIndex];
		const second = calls[secondIndex];
		const firstText = expression.slice(first.start, first.end);
		const between = expression.slice(first.end, second.start);
		const secondText = expression.slice(second.start, second.end);
		return {
			label,
			expression: `${expression.slice(0, first.start)}${secondText}${between}${firstText}${expression.slice(second.end)}`,
		};
	});
}

function replaceColorMethod(expression: string, color: string): string | undefined {
	const match = topLevelMethodMatch(expression, colorMethodPattern);
	if (match && match.index !== undefined) {
		const replacement = `${match[1]}${match[2]}${color}${match[4]}${match[5]}`;
		return `${expression.slice(0, match.index)}${replacement}${expression.slice(match.index + match[0].length)}`;
	}
	if (hasMethod(expression, 'color')) return undefined;
	return appendExpressionCall(expression, `.color(${JSON.stringify(color)})`);
}

export function updateTrackColor(source: string, trackId: string, value: string): string {
	const color = normalizeSourceColor(value);
	if (!color) return source;
	return replaceExpressionBlock(source, trackId, ({ label, expression }) => {
		const updatedExpression = replaceColorMethod(expression, color);
		return updatedExpression === undefined ? { label, expression } : { label, expression: updatedExpression };
	});
}

/**
 * Update one source sound call while preserving custom expressions.
 *
 * Omitting `soundId` retains the legacy behavior of editing the first
 * top-level call. The drawer supplies an id when a nested voice is selected.
 */
export function updateTrackSound(source: string, trackId: string, value: string, soundId?: string): string {
	const normalizedValue = value.trim();
	if (!normalizedValue || /[\r\n]/.test(normalizedValue)) return source;
	return replaceExpressionBlock(source, trackId, ({ label, expression }) => {
		const allCalls = sourceSoundCalls(expression, true);
		const idMatch = soundId?.match(/^sound-(\d+)$/);
		const requestedIndex = idMatch ? Number(idMatch[1]) : undefined;
		const call = requestedIndex !== undefined && Number.isInteger(requestedIndex)
			? allCalls[requestedIndex] ?? sourceSoundCalls(expression)[0]
			: sourceSoundCalls(expression)[0] ?? allCalls[0];
		if (!call) return { label, expression: appendExpressionCall(expression, `.sound(${JSON.stringify(normalizedValue)})`) };
		return {
			label,
			expression: replaceCallFirstArgument(expression, call, JSON.stringify(normalizedValue)),
		};
	});
}

/**
 * Update the display name stored in a Sushi marker. Unmanaged Strudel blocks
 * are promoted to marked blocks so a rename gives them a stable identity for
 * subsequent source edits.
 */
export function updateTrackName(source: string, trackId: string, name: string): string {
	const normalizedName = name.trim();
	if (!normalizedName) return source;

	const details = getSourceBlockDetails(source).find((block) => block.id === trackId);
	if (!details) return source;

	if (details.marker) {
		const lineEnd = source.indexOf('\n', details.sourceRange.start);
		const markerEnd = lineEnd === -1 ? source.length : lineEnd;
		const markerLine = source.slice(details.sourceRange.start, markerEnd);
		const match = markerLine.match(markerLinePattern);
		if (!match) return source;

		try {
			const metadata = JSON.parse(match[2]) as Record<string, unknown>;
			const updatedMarker = JSON.stringify({ ...metadata, name: normalizedName });
			return `${source.slice(0, details.sourceRange.start)}${match[1]}${updatedMarker}${match[3]}${source.slice(markerEnd)}`;
		} catch {
			return source;
		}
	}

	const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
	const marker = JSON.stringify({ id: details.id, name: normalizedName, type: details.type, schema: 1 });
	return `${source.slice(0, details.sourceRange.start)}// @sushi-track ${marker}${lineEnding}${source.slice(details.sourceRange.start)}`;
}

/** Remove one complete source-defined track block while preserving all other source. */
export function deleteTrack(source: string, trackId: string): string {
	const details = getSourceBlockDetails(source).find((block) => block.id === trackId);
	if (!details) return source;
	return `${source.slice(0, details.sourceRange.start)}${source.slice(details.sourceRange.end)}`;
}

export function updateTrackRange(source: string, trackId: string, startCycle: number, endCycle: number, minimumCycleSpan = 0.25): string {
	const start = Number.isFinite(startCycle) ? Math.max(0, startCycle) : 0;
	const minimumSpan = Number.isFinite(minimumCycleSpan) && minimumCycleSpan > 0 ? minimumCycleSpan : 0.25;
	const end = Number.isFinite(endCycle) ? Math.max(start + minimumSpan, endCycle) : start + minimumSpan;
	return replaceExpressionBlock(source, trackId, ({ label, expression }) => {
		const rangePattern = new RegExp(`(seqPLoop\\s*\\(\\s*|\\]\\s*,\\s*)\\[\\s*(${numericLiteral})(\\s*,\\s*)(${numericLiteral})`, 'g');
		const ranges = Array.from(expression.matchAll(rangePattern));
		if (ranges.length) {
			let rangeIndex = 0;
			return {
				label,
				expression: expression.replace(rangePattern, (match, prefix: string, oldStart: string, separator: string, oldEnd: string) => {
					const nextStart = rangeIndex === 0 ? formatNumber(start) : oldStart;
					const nextEnd = rangeIndex === ranges.length - 1 ? formatNumber(end) : oldEnd;
					rangeIndex += 1;
					return `${prefix}[${nextStart}${separator}${nextEnd}`;
				}),
			};
		}

		return {
			label,
			expression: wrapExpressionInSeqPLoop(expression, start, end),
		};
	});
}

export function updateTrackMode(
	source: string,
	trackId: string,
	mode: 'mute' | 'solo',
	active: boolean,
): string {
	return replaceExpressionBlock(source, trackId, ({ label, expression }) => {
		const modes = modeFromLabel(label);
		const baseLabel = baseTrackLabel(label);
		const nextLabel = mode === 'mute'
			? active ? `_${baseLabel}` : modes.soloed ? `S${baseLabel}` : baseLabel
			: active ? `S${baseLabel}` : modes.muted ? `_${baseLabel}` : baseLabel;
		return { label: nextLabel, expression };
	});
}
