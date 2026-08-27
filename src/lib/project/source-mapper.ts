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

function markerIndices(lines: string[]): number[] {
	return lines.flatMap((line, index) => markerLinePattern.test(withoutCarriageReturn(line).body) ? [index] : []);
}

function findExpressionLine(lines: string[], markerIndex: number, nextMarkerIndex: number | undefined): number | undefined {
	const end = nextMarkerIndex ?? lines.length;
	for (let index = markerIndex + 1; index < end; index += 1) {
		const { body } = withoutCarriageReturn(lines[index]);
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
	const lines = source.split('\n');
	const offsets = lineOffsets(source);
	const markers = markerIndices(lines);
	const details: SourceBlockDetails[] = [];

	for (let markerPosition = 0; markerPosition < markers.length; markerPosition += 1) {
		const markerIndex = markers[markerPosition];
		const { body: markerLine } = withoutCarriageReturn(lines[markerIndex]);
		const marker = parseMarker(markerLine);
		if (!marker) continue;

		const sourceStart = offsets[markerIndex];
		const nextMarkerIndex = markers[markerPosition + 1];
		const blockEnd = nextMarkerIndex === undefined ? source.length : offsets[nextMarkerIndex];
		const expressionIndex = findExpressionLine(lines, markerIndex, nextMarkerIndex);
		const summary: SourceBlockSummary = {
			id: marker.id ?? `unmanaged-${details.length + 1}`,
			name: marker.name ?? `Source block ${details.length + 1}`,
			type: marker.type ?? 'unknown',
			line: markerIndex + 1,
		};

		if (expressionIndex === undefined) {
			details.push({
				...summary,
				sourceRange: { start: sourceStart, end: blockEnd, line: markerIndex + 1 },
				gainEditable: false,
				panEditable: false,
				muted: false,
				soloed: false,
			});
			continue;
		}

		const expressionStart = offsets[expressionIndex];
		const firstLine = withoutCarriageReturn(lines[expressionIndex]);
		const label = firstLine.body.match(labelPattern);
		if (!label) {
			details.push({
				...summary,
				sourceRange: { start: sourceStart, end: blockEnd, line: markerIndex + 1 },
				expressionRange: { start: expressionStart, end: blockEnd, line: expressionIndex + 1 },
				gainEditable: false,
				panEditable: false,
				muted: false,
				soloed: false,
			});
			continue;
		}

		const [, , executableLabel, , , firstLineExpression] = label;
		const continuation = source.slice(expressionStart + lines[expressionIndex].length, blockEnd);
		const expression = `${firstLineExpression}${firstLine.ending}${continuation}`;
		const modes = modeFromLabel(executableLabel);
		const gain = numericMethodValue(expression, 'gain');
		const pan = numericMethodValue(expression, 'pan');
		const gainEditable = !hasMethod(expression, 'gain') || gain !== undefined;
		const panEditable = !hasMethod(expression, 'pan') || pan !== undefined;

		details.push({
			...summary,
			sourceRange: { start: sourceStart, end: blockEnd, line: markerIndex + 1 },
			expressionRange: { start: expressionStart, end: blockEnd, line: expressionIndex + 1 },
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
