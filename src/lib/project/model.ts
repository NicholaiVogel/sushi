export type AudioState = 'locked' | 'initializing' | 'ready' | 'error';

export type TransportState = 'stopped' | 'playing' | 'paused';

import { getDuplicateSourceTrackIds, getParsedSourceBlocks } from './source-parser';

export interface SourceRange {
	start: number;
	end: number;
	line: number;
	column?: number;
}

export interface SourceDiagnostic {
	revision: number;
	phase: 'parse' | 'transpile' | 'evaluate' | 'asset' | 'audio' | 'commit';
	severity: 'error' | 'warning' | 'info';
	code: string;
	message: string;
	range?: SourceRange;
	context?: string;
	cause?: string;
}

export interface RuntimeState {
	audioState: AudioState;
	transport: TransportState;
	activeRevision: number | null;
	currentCycle: number;
}

export interface AssetManifestEntry {
	id: string;
	alias: string;
	originalName: string;
	contentHash: string;
	mimeType: string;
	byteLength: number;
	storageKey: string;
	sourceUrl?: string;
	license?: string;
	attribution?: string;
}

export interface ProjectDocumentV1 {
	schemaVersion: 1;
	id: string;
	name: string;
	source: {
		draft: string;
		lastValid: string;
		revision: number;
		strudelVersion: string;
	};
	timeline: {
		quarterNotesPerCycle: { numerator: number; denominator: number };
		songEndCycle?: number;
		/** Set when the editable arrangement boundary was introduced. */
		songEndCycleVersion?: 1;
	};
	assets: AssetManifestEntry[];
}

export interface SourceBlockSummary {
	id: string;
	name: string;
	type: 'drum' | 'synth' | 'sample' | 'unknown';
	line: number;
}

export const DEFAULT_SONG_END_CYCLE = 30;
export const EXTENDED_SONG_END_CYCLE = 137;

export const DEFAULT_SOURCE = `setcpm(150 / 4)
const key = "E:minor"
`;

/** The pre-empty-session seed used only to migrate untouched local projects. */
export const LEGACY_DEFAULT_SOURCE = `setcpm(84 / 4)
const key = "E:minor"

// @sushi-track {"id":"trk_01J4PULSE","name":"Pulse","type":"synth","schema":1}
$: note("<e2 e2 g2 b2>").s("sawtooth").gain(0.24)

// @sushi-track {"id":"trk_01JGLASS","name":"Glass lead","type":"synth","schema":1}
$: note("<e4 b3 g4 a4>").s("triangle").gain(0.16)
`;

export function createInitialProject(): ProjectDocumentV1 {
	return {
		schemaVersion: 1,
		id: 'prj_01JSUSHI',
		name: 'First light',
		source: {
			draft: DEFAULT_SOURCE,
			lastValid: DEFAULT_SOURCE,
			revision: 0,
			strudelVersion: '1.3.0',
		},
		timeline: {
			quarterNotesPerCycle: { numerator: 4, denominator: 1 },
			songEndCycle: DEFAULT_SONG_END_CYCLE,
			songEndCycleVersion: 1,
		},
		assets: [],
	};
}

export function getSourceBlocks(source: string): SourceBlockSummary[] {
	return getParsedSourceBlocks(source).map(({ id, name, type, line }) => ({ id, name, type, line }));
}

/**
 * Marker identities are authored data, not projection IDs. Rejecting repeated
 * identities before Strudel evaluation keeps the source index deterministic
 * and prevents React/timeline state from silently targeting the wrong lane.
 */
export function getSourceIdentityDiagnostics(revision: number, source: string): SourceDiagnostic[] {
	return getDuplicateSourceTrackIds(source).map(({ id, first, duplicate }) => ({
		revision,
		phase: 'parse',
		severity: 'error',
		code: 'DUPLICATE_TRACK_ID',
		message: `Track ID "${id}" is used by more than one Sushi marker (first declared on line ${first.line}).`,
		range: duplicate,
		context: source.split('\n')[duplicate.line - 1],
	}));
}

type ErrorRecord = Record<string, unknown>;

function asRecord(value: unknown): ErrorRecord | undefined {
	return typeof value === 'object' && value !== null ? value as ErrorRecord : undefined;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function errorLocation(error: unknown, message: string): { line: number; column?: number } | undefined {
	const record = asRecord(error);
	const location = asRecord(record?.loc) ?? asRecord(record?.location);
	const locationLine = readNumber(location?.line) ?? readNumber(record?.lineNumber);
	const locationColumn = readNumber(location?.column);
	if (locationLine !== undefined) {
		return {
			line: locationLine,
			column: locationColumn === undefined
				? readNumber(record?.columnNumber)
				: locationColumn + 1,
		};
	}

	const lineAndColumn = message.match(/(?:line\s+)(\d+)[^\d]+column\s+(\d+)/i)
		?? message.match(/\((\d+):(\d+)\)/);
	if (lineAndColumn) return { line: Number(lineAndColumn[1]), column: Number(lineAndColumn[2]) + 1 };
	const lineOnly = message.match(/\bline\s+(\d+)\b/i);
	return lineOnly ? { line: Number(lineOnly[1]) } : undefined;
}

function rangeFromLocation(source: string, location: { line: number; column?: number }): SourceRange | undefined {
	const lines = source.split('\n');
	const line = Math.max(1, Math.min(location.line, lines.length));
	const lineStart = lines.slice(0, line - 1).reduce((offset, current) => offset + current.length + 1, 0);
	const lineText = lines[line - 1] ?? '';
	const column = location.column === undefined ? undefined : Math.max(1, location.column);
	const end = column === undefined
		? lineStart + lineText.length
		: Math.min(lineStart + lineText.length, lineStart + column);
	return { start: lineStart, end: Math.max(lineStart, end), line, column };
}

export function diagnosticFromError(revision: number, error: unknown, source = ''): SourceDiagnostic {
	const message = error instanceof Error ? error.message : String(error);
	const lowerMessage = message.toLowerCase();
	const record = asRecord(error);
	const phase: SourceDiagnostic['phase'] = error instanceof SyntaxError || record?.name === 'SyntaxError' || lowerMessage.includes('syntax') || lowerMessage.includes('parse')
		? 'parse'
		: 'evaluate';
	const code = record?.code === 'AUDIO_LOCKED'
		? 'AUDIO_LOCKED'
		: phase === 'parse' ? 'STR_PARSE_FAILED' : 'STR_EVALUATION_FAILED';
	const location = errorLocation(error, message);
	const range = source && location ? rangeFromLocation(source, location) : undefined;
	const context = range ? source.split('\n')[range.line - 1] : undefined;

	return {
		revision,
		phase,
		severity: 'error',
		code,
		message: message || 'Strudel could not evaluate this source.',
		range,
		context,
	};
}
