export type AudioState = 'locked' | 'initializing' | 'ready' | 'error';

export type TransportState = 'stopped' | 'playing' | 'paused';

export interface SourceRange {
	start: number;
	end: number;
	line: number;
}

export interface SourceDiagnostic {
	revision: number;
	phase: 'parse' | 'transpile' | 'evaluate' | 'asset' | 'audio' | 'commit';
	severity: 'error' | 'warning' | 'info';
	code: string;
	message: string;
	range?: SourceRange;
	cause?: string;
}

export interface RuntimeState {
	audioState: AudioState;
	transport: TransportState;
	activeRevision: number | null;
	currentCycle: number;
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
	};
	assets: [];
}

export interface SourceBlockSummary {
	id: string;
	name: string;
	type: 'drum' | 'synth' | 'sample' | 'unknown';
	line: number;
}

export const DEFAULT_SOURCE = `setcpm(84 / 4)
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
		},
		assets: [],
	};
}

const markerPattern = /^\s*\/\/\s*@sushi-track\s+(\{.*\})\s*$/gm;

export function getSourceBlocks(source: string): SourceBlockSummary[] {
	const blocks: SourceBlockSummary[] = [];
	for (const match of source.matchAll(markerPattern)) {
		try {
			const marker = JSON.parse(match[1]) as {
				id?: string;
				name?: string;
				type?: SourceBlockSummary['type'];
			};
			blocks.push({
				id: marker.id ?? `unmanaged-${blocks.length + 1}`,
				name: marker.name ?? `Source block ${blocks.length + 1}`,
				type: marker.type ?? 'unknown',
				line: source.slice(0, match.index ?? 0).split('\n').length,
			});
		} catch {
			// The Strudel evaluator owns validation. An incomplete marker should not
			// make the studio itself fail to render the draft.
		}
	}
	return blocks;
}

export function diagnosticFromError(revision: number, error: unknown): SourceDiagnostic {
	const message = error instanceof Error ? error.message : String(error);
	const lowerMessage = message.toLowerCase();
	const phase: SourceDiagnostic['phase'] = lowerMessage.includes('syntax') || lowerMessage.includes('parse')
		? 'parse'
		: 'evaluate';

	return {
		revision,
		phase,
		severity: 'error',
		code: phase === 'parse' ? 'STR_PARSE_FAILED' : 'STR_EVALUATION_FAILED',
		message: message || 'Strudel could not evaluate this source.',
	};
}
