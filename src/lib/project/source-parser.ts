import type { SourceBlockSummary, SourceRange } from './model';

export interface ParsedSourceBlock extends SourceBlockSummary {
	sourceRange: SourceRange;
	expressionRange?: SourceRange;
	label?: string;
	expression?: string;
	marker: boolean;
}

interface MarkerMetadata {
	id?: string;
	name?: string;
	type?: SourceBlockSummary['type'];
}

interface SourceLine {
	index: number;
	offset: number;
	body: string;
	ending: string;
}

interface Candidate {
	line: SourceLine;
	marker?: MarkerMetadata;
	label?: { name: string; expression: string };
}

interface BlockCandidate {
	candidate: Candidate;
	expressionCandidate?: Candidate;
}

const markerLinePattern = /^\s*\/\/\s*@sushi-track\s+(\{.*\})\s*$/;
const labelPattern = /^(\s*)([A-Za-z_$][\w$]*)(\s*):(\s*)(.*)$/;

function splitLines(source: string): SourceLine[] {
	const lines = source.split('\n');
	let offset = 0;
	return lines.map((line, index) => {
		const ending = line.endsWith('\r') ? '\r' : '';
		const body = ending ? line.slice(0, -1) : line;
		const current = { index, offset, body, ending };
		offset += line.length + 1;
		return current;
	});
}

function parseMarker(line: string): MarkerMetadata | undefined {
	const match = line.match(markerLinePattern);
	if (!match) return undefined;

	try {
		return JSON.parse(match[1]) as MarkerMetadata;
	} catch {
		return undefined;
	}
}

function isTrackLabel(label: string): boolean {
	// Strudel's standard labeled patterns are $:, _$:, and S$:. Accept other
	// dollar-suffixed labels too, while avoiding object/type-like `name:` lines.
	return label.endsWith('$');
}

function firstSoundToken(expression: string): string | undefined {
	const soundCall = expression.match(/(?:^|\.)s\s*\(\s*["'`]([^"'`]+)["'`]/);
	const directSound = expression.match(/^\s*\(\s*["'`]([^"'`]+)["'`]/);
	const value = soundCall?.[1] ?? directSound?.[1];
	if (!value) return undefined;

	const token = value
		.replace(/[<>]/g, ' ')
		.split(/\s+/)
		.find((part) => part && part !== '~');
	return token?.replace(/^~/, '');
}

const DISPLAY_NAME_OVERRIDES: Record<string, string> = {
	gm_string_ensemble_2: 'GM String Ensemble 2',
	gm_synth_bass_1: 'GM Synth Bass 1',
	gm_synth_brass_2: 'GM Synth Brass 2',
	oberheimdmx_bd: 'Oberheim DMX BD',
	compurhythm8000_cp: 'Compurhythm 8000 CP',
	korgkr55_sd: 'Korg KR55 SD',
	rolandmc303_cp: 'Roland MC303 CP',
};

function normalizedSoundToken(token: string): string {
	return token
		.replace(/(?:[!*@]\d+(?:\.\d+)?)+$/, '')
		.toLowerCase();
}

function displayName(expression: string, index: number): string {
	const token = firstSoundToken(expression);
	if (!token) return `Track ${index}`;
	const normalizedToken = normalizedSoundToken(token);
	const override = DISPLAY_NAME_OVERRIDES[normalizedToken];
	if (override) return override;

	const words = normalizedToken
		.replace(/[_-]+/g, ' ')
		.replace(/([a-z])(\d)/g, '$1 $2')
		.split(/\s+/)
		.filter(Boolean)
		.map((word) => ['gm', 'bd', 'cp', 'sd'].includes(word) ? word.toUpperCase() : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`);
	return words.join(' ') || `Track ${index}`;
}

function sourceType(expression: string): SourceBlockSummary['type'] {
	const token = firstSoundToken(expression)?.toLowerCase() ?? '';
	if (/(?:bd|sd|cp|kick|snare|hat|drum|perc)/.test(token)) return 'drum';
	if (/(?:synth|string|brass|piano|saw|sine|triangle|lead|bass|gm_)/.test(token)) return 'synth';
	if (token) return 'sample';
	return 'unknown';
}

function expressionForLine(source: string, lines: SourceLine[], lineIndex: number, blockEnd: number): string {
	const line = lines[lineIndex];
	const firstLineExpression = line.body.match(labelPattern)?.[5] ?? '';
	const continuation = source.slice(line.offset + line.body.length + line.ending.length, blockEnd);
	return `${firstLineExpression}${line.ending}${continuation}`;
}

function candidateLines(lines: SourceLine[]): Candidate[] {
	const candidates: Candidate[] = [];
	for (const line of lines) {
		const marker = parseMarker(line.body);
		if (marker) {
			candidates.push({ line, marker });
			continue;
		}

		const label = line.body.match(labelPattern);
		if (label && isTrackLabel(label[2])) {
			candidates.push({ line, label: { name: label[2], expression: label[5] } });
		}
	}
	return candidates;
}

function blockCandidates(candidates: Candidate[], lines: SourceLine[]): BlockCandidate[] {
	const blocks: BlockCandidate[] = [];
	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = candidates[index];
		const next = candidates[index + 1];
		if (candidate.marker && next?.label) {
			const firstExecutableLine = lines
				.slice(candidate.line.index + 1, next.line.index + 1)
				.find((line) => line.body.trim() && !line.body.trim().startsWith('//'));
			if (firstExecutableLine?.index === next.line.index) {
				blocks.push({ candidate, expressionCandidate: next });
				index += 1;
				continue;
			}
		}
		blocks.push({ candidate });
	}
	return blocks;
}

export function getParsedSourceBlocks(source: string): ParsedSourceBlock[] {
	const lines = splitLines(source);
	const candidates = blockCandidates(candidateLines(lines), lines);
	let ordinaryIndex = 0;

	return candidates.map((blockCandidate, index) => {
		const candidate = blockCandidate.candidate;
		const next = candidates[index + 1]?.candidate;
		const blockEnd = next?.line.offset ?? source.length;
		const sourceStart = candidate.line.offset;
		const sourceRange = { start: sourceStart, end: blockEnd, line: candidate.line.index + 1 };

		if (candidate.marker) {
			const expressionLine = blockCandidate.expressionCandidate?.line
				?? lines.slice(candidate.line.index + 1, next?.line.index ?? lines.length)
					.find((line) => line.body.trim() && !line.body.trim().startsWith('//'));
			if (!expressionLine) {
				return {
					id: candidate.marker.id ?? `unmanaged-${index + 1}`,
					name: candidate.marker.name ?? `Source block ${index + 1}`,
					type: candidate.marker.type ?? 'unknown',
					line: candidate.line.index + 1,
					sourceRange,
					marker: true,
				};
			}

			const expressionRange = { start: expressionLine.offset, end: blockEnd, line: expressionLine.index + 1 };
			const expressionMatch = expressionLine.body.match(labelPattern);
			return {
				id: candidate.marker.id ?? `unmanaged-${index + 1}`,
				name: candidate.marker.name ?? `Source block ${index + 1}`,
				type: candidate.marker.type ?? 'unknown',
				line: candidate.line.index + 1,
				sourceRange,
				expressionRange,
				...(expressionMatch && isTrackLabel(expressionMatch[2]) ? {
					label: expressionMatch[2],
					expression: expressionForLine(source, lines, expressionLine.index, blockEnd),
				} : {}),
				marker: true,
			};
		}

		ordinaryIndex += 1;
		const expression = expressionForLine(source, lines, candidate.line.index, blockEnd);
		return {
			id: `trk_source_${ordinaryIndex.toString().padStart(2, '0')}`,
			name: displayName(expression, ordinaryIndex),
			type: sourceType(expression),
			line: candidate.line.index + 1,
			sourceRange,
			expressionRange: { start: sourceStart, end: blockEnd, line: candidate.line.index + 1 },
			label: candidate.label?.name,
			expression,
			marker: false,
		};
	});
}
