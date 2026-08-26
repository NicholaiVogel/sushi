import type { SourceBlockSummary, SourceRange } from './model';

/**
 * The small, deliberately conservative source subset used by the first DAW
 * surface.  The source document remains canonical; this module only projects
 * a marked block and applies edits to the one expression line that owns it.
 */
export interface SourceBlockDetails extends SourceBlockSummary {
	sourceRange: SourceRange;
	expressionRange?: SourceRange;
	label?: string;
	expression?: string;
	gain?: number;
	pan?: number;
	gainEditable: boolean;
	panEditable: boolean;
	muted: boolean;
	soloed: boolean;
}

type Marker = {
	id?: string;
	name?: string;
	type?: SourceBlockSummary['type'];
};

const markerLinePattern = /^\s*\/\/\s*@sushi-track\s+(\{.*\})\s*$/;
const labelPattern = /^(\s*)([A-Za-z_$][\w$]*)(\s*):(\s*)(.*)$/;
const numericLiteral = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?';

function parseMarker(line: string): Marker | undefined {
	const match = line.match(markerLinePattern);
	if (!match) return undefined;

	try {
		return JSON.parse(match[1]) as Marker;
	} catch {
		return undefined;
	}
}

function lineOffsets(source: string): number[] {
	const lines = source.split('\n');
	const offsets: number[] = [];
	let offset = 0;
	for (const line of lines) {
		offsets.push(offset);
		offset += line.length + 1;
	}
	return offsets;
}

function withoutCarriageReturn(line: string): { body: string; ending: string } {
	return line.endsWith('\r') ? { body: line.slice(0, -1), ending: '\r' } : { body: line, ending: '' };
}

function numericMethodValue(expression: string, method: 'gain' | 'pan'): number | undefined {
	const match = expression.match(new RegExp(`\\.${method}\\(\\s*(${numericLiteral})\\s*\\)`));
	if (!match) return undefined;
	const value = Number(match[1]);
	return Number.isFinite(value) ? value : undefined;
}

function hasMethod(expression: string, method: 'gain' | 'pan'): boolean {
	return new RegExp(`\\.${method}\\s*\\(`).test(expression);
}

function findExpressionLine(lines: string[], markerIndex: number): number | undefined {
	for (let index = markerIndex + 1; index < lines.length; index += 1) {
		const { body } = withoutCarriageReturn(lines[index]);
		if (markerLinePattern.test(body)) return undefined;
		if (!body.trim() || body.trim().startsWith('//')) continue;
		return index;
	}
	return undefined;
}

function modeFromLabel(label: string | undefined): { muted: boolean; soloed: boolean } {
	return {
		muted: Boolean(label?.startsWith('_')),
		soloed: Boolean(label?.startsWith('S')),
	};
}

export function getSourceBlockDetails(source: string): SourceBlockDetails[] {
	const lines = source.split('\n');
	const offsets = lineOffsets(source);
	const details: SourceBlockDetails[] = [];

	for (let markerIndex = 0; markerIndex < lines.length; markerIndex += 1) {
		const { body: markerLine } = withoutCarriageReturn(lines[markerIndex]);
		const marker = parseMarker(markerLine);
		if (!marker) continue;

		const sourceStart = offsets[markerIndex];
		const expressionIndex = findExpressionLine(lines, markerIndex);
		const expressionLine = expressionIndex === undefined ? undefined : withoutCarriageReturn(lines[expressionIndex]);
		const summary: SourceBlockSummary = {
			id: marker.id ?? `unmanaged-${details.length + 1}`,
			name: marker.name ?? `Source block ${details.length + 1}`,
			type: marker.type ?? 'unknown',
			line: markerIndex + 1,
		};

		if (!expressionLine || expressionIndex === undefined) {
			details.push({
				...summary,
				sourceRange: { start: sourceStart, end: sourceStart + lines[markerIndex].length, line: markerIndex + 1 },
				gainEditable: false,
				panEditable: false,
				muted: false,
				soloed: false,
			});
			continue;
		}

		const expressionStart = offsets[expressionIndex];
		const label = expressionLine.body.match(labelPattern);
		if (!label) {
			details.push({
				...summary,
				sourceRange: { start: sourceStart, end: expressionStart + lines[expressionIndex].length, line: markerIndex + 1 },
				expressionRange: { start: expressionStart, end: expressionStart + lines[expressionIndex].length, line: expressionIndex + 1 },
				gainEditable: false,
				panEditable: false,
				muted: false,
				soloed: false,
			});
			continue;
		}

		const [, , executableLabel, , , expression] = label;
		const modes = modeFromLabel(executableLabel);
		const gain = numericMethodValue(expression, 'gain');
		const pan = numericMethodValue(expression, 'pan');
		const gainEditable = !hasMethod(expression, 'gain') || gain !== undefined;
		const panEditable = !hasMethod(expression, 'pan') || pan !== undefined;

		details.push({
			...summary,
			sourceRange: { start: sourceStart, end: expressionStart + lines[expressionIndex].length, line: markerIndex + 1 },
			expressionRange: { start: expressionStart, end: expressionStart + lines[expressionIndex].length, line: expressionIndex + 1 },
			label: executableLabel,
			expression,
			gain,
			pan,
			gainEditable,
			panEditable,
			...modes,
		});
	}

	return details;
}

function replaceExpressionLine(
	source: string,
	trackId: string,
	transform: (parts: { label: string; expression: string }) => { label: string; expression: string },
): string {
	const details = getSourceBlockDetails(source).find((block) => block.id === trackId);
	if (!details?.expressionRange || !details.label || details.expression === undefined) return source;

	const lines = source.split('\n');
	const line = source.slice(details.expressionRange.start, details.expressionRange.end);
	const { body, ending } = withoutCarriageReturn(line);
	const match = body.match(labelPattern);
	if (!match) return source;

	const [, indent, label, labelSpacing, afterColon, expression] = match;
	const next = transform({ label, expression });
	const replacement = `${indent}${next.label}${labelSpacing}:${afterColon}${next.expression}${ending}`;
	return `${source.slice(0, details.expressionRange.start)}${replacement}${source.slice(details.expressionRange.end)}`;
}

function formatNumber(value: number): string {
	const rounded = Math.round(value * 100) / 100;
	return String(rounded);
}

function replaceNumericMethod(expression: string, method: 'gain' | 'pan', value: number): string | undefined {
	const methodPattern = new RegExp(`(\\.${method}\\(\\s*)(${numericLiteral})(\\s*\\))`);
	if (methodPattern.test(expression)) {
		return expression.replace(methodPattern, `$1${formatNumber(value)}$3`);
	}
	if (hasMethod(expression, method)) return undefined;

	const trailingWhitespace = expression.match(/\s*$/)?.[0] ?? '';
	const expressionBody = trailingWhitespace ? expression.slice(0, -trailingWhitespace.length) : expression;
	return `${expressionBody}.${method}(${formatNumber(value)})${trailingWhitespace}`;
}

function updateNumericMethod(source: string, trackId: string, method: 'gain' | 'pan', value: number): string {
	const normalized = Math.max(0, Math.min(1, value));
	const next = replaceExpressionLine(source, trackId, ({ label, expression }) => {
		const updatedExpression = replaceNumericMethod(expression, method, normalized);
		return updatedExpression === undefined ? { label, expression } : { label, expression: updatedExpression };
	});
	return next;
}

export function updateTrackGain(source: string, trackId: string, value: number): string {
	return updateNumericMethod(source, trackId, 'gain', value);
}

export function updateTrackPan(source: string, trackId: string, value: number): string {
	return updateNumericMethod(source, trackId, 'pan', value);
}

export function updateTrackMode(
	source: string,
	trackId: string,
	mode: 'mute' | 'solo',
	active: boolean,
): string {
	return replaceExpressionLine(source, trackId, ({ label, expression }) => {
		const modes = modeFromLabel(label);
		const nextLabel = mode === 'mute'
			? active ? '_$' : modes.soloed ? 'S$' : '$'
			: active ? 'S$' : modes.muted ? '_$' : '$';
		return { label: nextLabel, expression };
	});
}
