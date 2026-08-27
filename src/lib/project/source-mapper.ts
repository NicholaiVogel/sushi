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
	timing: TrackTiming;
	gain?: number;
	pan?: number;
	gainEditable: boolean;
	panEditable: boolean;
	muted: boolean;
	soloed: boolean;
}

export interface SourceGlobals {
	bpm: number;
	quarterNotesPerCycle: number;
	key: string;
}

export type TrackTimingMode = 'full' | 'seqPLoop' | 'arrange';

export interface TrackTiming {
	mode: TrackTimingMode;
	startCycle: number;
	endCycle: number;
}

const labelPattern = /^(\s*)([A-Za-z_$][\w$]*)(\s*):(\s*)(.*)$/;
const numericLiteral = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?';
const DEFAULT_BPM = 84;
const DEFAULT_QUARTER_NOTES_PER_CYCLE = 4;
const DEFAULT_TRACK_END_CYCLE = 4;

export function getSourceGlobals(source: string): SourceGlobals {
	const tempoMatch = source.match(new RegExp(`\\bsetcpm\\s*\\(\\s*(${numericLiteral})(?:\\s*\\/\\s*(${numericLiteral}))?\\s*\\)`));
	const parsedBpm = tempoMatch ? Number(tempoMatch[1]) : DEFAULT_BPM;
	const parsedQuarterNotes = tempoMatch?.[2] ? Number(tempoMatch[2]) : DEFAULT_QUARTER_NOTES_PER_CYCLE;
	const keyMatch = source.match(/^\s*(?:const|let|var)\s+key\s*=\s*["']([^"']+)["']/m);
	return {
		bpm: Number.isFinite(parsedBpm) && parsedBpm > 0 ? parsedBpm : DEFAULT_BPM,
		quarterNotesPerCycle: Number.isFinite(parsedQuarterNotes) && parsedQuarterNotes > 0 ? parsedQuarterNotes : DEFAULT_QUARTER_NOTES_PER_CYCLE,
		key: keyMatch?.[1] ?? 'E:minor',
	};
}

export function cyclesToSeconds(cycles: number, globals: SourceGlobals): number {
	return cycles * 60 * globals.quarterNotesPerCycle / globals.bpm;
}

export function secondsToCycles(seconds: number, globals: SourceGlobals): number {
	return seconds * globals.bpm / (60 * globals.quarterNotesPerCycle);
}

export function getSourceTrackTiming(expression: string): TrackTiming {
	const trimmed = expression.trim();
	if (trimmed.startsWith('seqPLoop(')) {
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

	if (trimmed.startsWith('arrange(')) {
		const durations = Array.from(trimmed.matchAll(new RegExp(`\\[\\s*(${numericLiteral})\\s*,`, 'g')))
			.map((match) => Number(match[1]))
			.filter((duration) => Number.isFinite(duration) && duration > 0);
		if (durations.length) {
			return { mode: 'arrange', startCycle: 0, endCycle: durations.reduce((total, duration) => total + duration, 0) };
		}
	}

	return { mode: 'full', startCycle: 0, endCycle: DEFAULT_TRACK_END_CYCLE };
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

function numericMethodValue(expression: string, method: 'gain' | 'pan'): number | undefined {
	const match = expression.match(new RegExp(`\\.${method}\\s*\\(\\s*(${numericLiteral})\\s*\\)`));
	if (!match) return undefined;
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : undefined;
}

function hasMethod(expression: string, method: 'gain' | 'pan'): boolean {
	return new RegExp(`\\.${method}\\s*\\(`).test(expression);
}

export function getSourceBlockDetails(source: string): SourceBlockDetails[] {
	return getParsedSourceBlocks(source).map((block): SourceBlockDetails => {
		if (!block.expressionRange || !block.label || block.expression === undefined) {
			return {
				...block,
				timing: { mode: 'full', startCycle: 0, endCycle: DEFAULT_TRACK_END_CYCLE },
				gainEditable: false,
				panEditable: false,
				muted: false,
				soloed: false,
			};
		}

		const expression = block.expression;
		const modes = modeFromLabel(block.label);
		const gain = numericMethodValue(expression, 'gain');
		const pan = numericMethodValue(expression, 'pan');
		return {
			...block,
			timing: getSourceTrackTiming(expression),
			gain,
			pan,
			gainEditable: !hasMethod(expression, 'gain') || gain !== undefined,
			panEditable: !hasMethod(expression, 'pan') || pan !== undefined,
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
	const rounded = Math.round(value * 100) / 100;
	return String(rounded);
}

function replaceNumericMethod(expression: string, method: 'gain' | 'pan', value: number): string | undefined {
	const methodPattern = new RegExp(`(\\.${method}\\s*\\(\\s*)(${numericLiteral})(\\s*\\))`);
	if (methodPattern.test(expression)) {
		return expression.replace(methodPattern, `$1${formatNumber(value)}$3`);
	}
	if (hasMethod(expression, method)) return undefined;

	const trailingWhitespace = expression.match(/\s*$/)?.[0] ?? '';
	const expressionBody = trailingWhitespace ? expression.slice(0, -trailingWhitespace.length) : expression;
	const semicolon = expressionBody.endsWith(';') ? ';' : '';
	const body = semicolon ? expressionBody.slice(0, -1) : expressionBody;
	return `${body}.${method}(${formatNumber(value)})${semicolon}${trailingWhitespace}`;
}

function updateNumericMethod(source: string, trackId: string, method: 'gain' | 'pan', value: number): string {
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

export function updateTrackRange(source: string, trackId: string, startCycle: number, endCycle: number): string {
	const start = Number.isFinite(startCycle) ? Math.max(0, startCycle) : 0;
	const end = Number.isFinite(endCycle) ? Math.max(start + 0.25, endCycle) : start + 0.25;
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

		const trailingWhitespace = expression.match(/\s*$/)?.[0] ?? '';
		const expressionBody = trailingWhitespace ? expression.slice(0, -trailingWhitespace.length) : expression;
		const semicolon = expressionBody.endsWith(';') ? ';' : '';
		const body = semicolon ? expressionBody.slice(0, -1) : expressionBody;
		return {
			label,
			expression: `seqPLoop([${formatNumber(start)}, ${formatNumber(end)}, ${body}])${semicolon}${trailingWhitespace}`,
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
		const nextLabel = mode === 'mute'
			? active ? '_$' : modes.soloed ? 'S$' : '$'
			: active ? 'S$' : modes.muted ? '_$' : '$';
		return { label: nextLabel, expression };
	});
}
