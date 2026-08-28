import { getParsedSourceBlocks } from './source-parser';
import type { SourceBlockSummary, SourceRange } from './model';

/**
 * The small, deliberately conservative source subset used by the first DAW
 * surface. The source document remains canonical; this module only projects a
 * marked block and applies edits inside that complete block.
 */
export interface SourceBlockDetails extends SourceBlockSummary {
	sourceRange: SourceRange;
	expressionRange?: SourceRange;
	label?: string;
	expression?: string;
	marker: boolean;
	timing: TrackTiming;
	visualizer?: TrackVisualizer;
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
export type TrackVisualizer = 'pianoroll' | 'scope';

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

export type SourceEffectMethod = 'detune' | 'lpenv' | 'octave' | 'room';
export type SourceEffectKind = 'numeric' | 'random' | 'dynamic';

/** A supported Strudel effect call projected onto a source lane. */
export interface SourceEffect {
	/** Stable within a source lane; based on the effect method and ordinal. */
	id: string;
	method: SourceEffectMethod;
	label: string;
	kind: SourceEffectKind;
	/** The original first argument, retained for dynamic/source-backed values. */
	expression: string;
	value?: number;
	min: number;
	max: number;
	step: number;
	defaultValue: number;
	supportsRandom: boolean;
}

export interface SourceEffectDefinition {
	method: SourceEffectMethod;
	label: string;
	min: number;
	max: number;
	step: number;
	defaultValue: number;
	supportsRandom: boolean;
}

/**
 * The first FX palette is intentionally small and source-friendly. Keeping
 * definitions in one place makes the lane control reusable and gives future
 * Strudel methods a single, typed extension point.
 */
export const SOURCE_EFFECT_DEFINITIONS: readonly SourceEffectDefinition[] = [
	{ method: 'detune', label: 'DETUNE', min: 0, max: 24, step: 0.1, defaultValue: 0, supportsRandom: true },
	{ method: 'lpenv', label: 'LP ENV', min: -8, max: 8, step: 0.1, defaultValue: 1, supportsRandom: false },
	{ method: 'octave', label: 'OCTAVE', min: -4, max: 4, step: 1, defaultValue: 0, supportsRandom: false },
	{ method: 'room', label: 'ROOM', min: 0, max: 1, step: 0.01, defaultValue: 0.5, supportsRandom: false },
];

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
		soloed: Boolean(label?.startsWith('S')),
	};
}

/**
 * Strip Strudel's source-mode prefix without discarding an authored label.
 * Standard labels are `$`, `_$`, and `S$`, but regular Strudel files commonly
 * use names such as `lead$`; toggling a mode must keep that base label intact.
 */
function baseTrackLabel(label: string | undefined): string {
	const current = label?.endsWith('$') ? label : '$';
	const withoutMode = current.startsWith('_') || current.startsWith('S') ? current.slice(1) : current;
	return withoutMode || '$';
}

function numericMethodValue(expression: string, method: 'gain' | 'pan'): number | undefined {
	const match = expression.match(new RegExp(`\\.${method}\\s*\\(\\s*(${numericLiteral})\\s*\\)`));
	if (!match) return undefined;
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : undefined;
}

function hasMethod(expression: string, method: string): boolean {
	return new RegExp(`\\.${method}\\s*\\(`).test(expression);
}

function normalizeSourceColor(value: string): string | undefined {
	const normalized = value.trim();
	return normalized && safeColorPattern.test(normalized) ? normalized : undefined;
}

function sourceColorValue(expression: string): string | undefined {
	const match = expression.match(colorMethodPattern);
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
	ordinal: number;
	start: number;
	end: number;
	valueStart: number;
	valueEnd: number;
	arguments: string[];
}

function sourceEffectDefinition(method: string): SourceEffectDefinition | undefined {
	return SOURCE_EFFECT_DEFINITIONS.find((definition) => definition.method === method);
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

function sliderMethodLabel(expression: string, start: number, index: number): string {
	const prefix = expression.slice(0, start);
	const method = prefix.match(/\.([A-Za-z_$][\w$]*)\s*\(\s*$/)?.[1];
	return method ? method.toUpperCase() : `SLIDER ${index + 1}`;
}

function sourceSliderCalls(expression: string): SourceSliderCall[] {
	const calls: SourceSliderCall[] = [];
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
		if (character !== '.') continue;

		let methodEnd = index + 1;
		while (/[A-Za-z0-9_$]/.test(expression[methodEnd] ?? '')) methodEnd += 1;
		const method = expression.slice(index + 1, methodEnd);
		const definition = sourceEffectDefinition(method);
		if (!definition) continue;
		let open = methodEnd;
		while (/\s/.test(expression[open] ?? '')) open += 1;
		if (expression[open] !== '(') continue;
		const close = findMatchingCallEnd(expression, open);
		if (close === undefined) continue;
		const args = splitCallArguments(expression, open + 1, close);
		const firstArg = args[0];
		if (firstArg && firstArg.text.trim()) {
			const ordinal = ordinals.get(definition.method) ?? 0;
			ordinals.set(definition.method, ordinal + 1);
			calls.push({
				method: definition.method,
				ordinal,
				start: index,
				end: close + 1,
				valueStart: firstArg.start,
				valueEnd: firstArg.end,
				arguments: args.map((argument) => argument.text),
			});
		}
		index = close;
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

function sourceEffectKind(value: string, supportsRandom: boolean): SourceEffectKind {
	return supportsRandom && value.trim() === 'rand' ? 'random' : numericSliderArgument(value) === undefined ? 'dynamic' : 'numeric';
}

function sourceEffects(expression: string): SourceEffect[] {
	return sourceEffectCalls(expression).flatMap((call) => {
		const definition = sourceEffectDefinition(call.method);
		if (!definition) return [];
		const argument = call.arguments[0] ?? '';
		const numericValue = numericSliderArgument(argument);
		const kind = sourceEffectKind(argument, definition.supportsRandom);
		const min = definition.min;
		const max = numericValue === undefined ? definition.max : Math.max(definition.max, numericValue);
		return [{
			id: `effect-${call.method}-${call.ordinal}`,
			method: call.method,
			label: definition.label,
			kind,
			expression: argument.trim(),
			...(numericValue === undefined ? {} : { value: Math.max(min, Math.min(max, numericValue)) }),
			min,
			max,
			step: definition.step,
			defaultValue: definition.defaultValue,
			supportsRandom: definition.supportsRandom,
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
	if (pianorollIndex < 0 && scopeIndex < 0) return undefined;
	return scopeIndex > pianorollIndex ? 'scope' : 'pianoroll';
}

export function getSourceBlockDetails(source: string, defaultEndCycle = DEFAULT_TRACK_END_CYCLE): SourceBlockDetails[] {
	return getParsedSourceBlocks(source).map((block): SourceBlockDetails => {
		if (!block.expressionRange || !block.label || block.expression === undefined) {
			return {
				...block,
				timing: { mode: 'full', startCycle: 0, endCycle: defaultEndCycle },
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
		const sliders = sourceSliders(expression);
		const effects = sourceEffects(expression);
		return {
			...block,
			timing: getSourceTrackTiming(expression, defaultEndCycle),
			...(visualizer === undefined ? {} : { visualizer }),
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
	if (methodPattern.test(expression)) {
		return expression.replace(methodPattern, `$1${formatNumber(value)}$3`);
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
	const match = effectId.match(/^effect-(detune|lpenv|octave|room)-(\d+)$/);
	if (!match) return undefined;
	const ordinal = Number(match[2]);
	return Number.isInteger(ordinal) && ordinal >= 0
		? { method: match[1] as SourceEffectMethod, ordinal }
		: undefined;
}

function effectNumericBounds(definition: SourceEffectDefinition, current: number | undefined): { min: number; max: number } {
	return {
		min: definition.min,
		max: current === undefined ? definition.max : Math.max(definition.max, current),
	};
}

/** Update one supported Strudel FX call, preserving dynamic/random modes. */
export function updateTrackEffect(source: string, trackId: string, effectId: string, value: number | 'rand'): string {
	const parts = effectIdParts(effectId);
	if (!parts) return source;
	const definition = sourceEffectDefinition(parts.method);
	if (!definition || (value === 'rand' && !definition.supportsRandom)) return source;

	return replaceExpressionBlock(source, trackId, ({ label, expression }) => {
		const call = sourceEffectCalls(expression).find((candidate) => candidate.method === parts.method && candidate.ordinal === parts.ordinal);
		if (!call) return { label, expression };
		if (value === 'rand') return { label, expression: replaceCallFirstArgument(expression, call, 'rand') };

		const current = numericSliderArgument(call.arguments[0]);
		const bounds = effectNumericBounds(definition, current);
		const normalized = Math.max(bounds.min, Math.min(bounds.max, value));
		return {
			label,
			expression: replaceCallFirstArgument(expression, call, formatSliderValue(normalized, definition.step)),
		};
	});
}

/** Add one supported Strudel effect if the track does not already use it. */
export function addTrackEffect(source: string, trackId: string, method: SourceEffectMethod): string {
	const definition = sourceEffectDefinition(method);
	if (!definition) return source;
	return replaceExpressionBlock(source, trackId, ({ label, expression }) => {
		if (sourceEffectCalls(expression).some((call) => call.method === method)) return { label, expression };
		return {
			label,
			expression: appendExpressionCall(expression, `.${method}(${formatSliderValue(definition.defaultValue, definition.step)})`),
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

function replaceColorMethod(expression: string, color: string): string | undefined {
	if (colorMethodPattern.test(expression)) {
		return expression.replace(colorMethodPattern, (_match, prefix: string, quote: string, _oldColor: string, closingQuote: string, suffix: string) => `${prefix}${quote}${color}${closingQuote}${suffix}`);
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
