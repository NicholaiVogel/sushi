import type { AssetManifestEntry, RuntimeState, SourceDiagnostic } from '../../lib/project/model';
import { getSourceBlockDetails } from '../../lib/project/source-mapper';
import type { StoredProjectSnapshot } from '../../lib/project/storage';

export type StudioPhase = 'booting' | 'ready' | 'validating' | 'error';
export type PersistenceState = 'loading' | 'ready' | 'unavailable';

export interface StudioState {
	projectName: string;
	assets: AssetManifestEntry[];
	draft: string;
	lastValid: string;
	revision: number;
	activeRevision: number | null;
	songEndCycle: number;
	diagnostics: SourceDiagnostic[];
	phase: StudioPhase;
	persistenceState: PersistenceState;
	runtime: RuntimeState;
}

export type StudioCommand =
	| { type: 'writeSource'; source: string; expectedRevision?: number }
	| { type: 'play' }
	| { type: 'pause' }
	| { type: 'seek'; cycle: number }
	| { type: 'stop' };

export type DispatchResult = { ok: true } | { ok: false; error?: unknown };

export interface SourceHistoryEntry {
	before: string;
	after: string;
	beforeRevision: number;
	afterRevision: number;
}

export interface SourceHistoryState {
	cursorSource: string;
	undo: SourceHistoryEntry[];
	redo: SourceHistoryEntry[];
}

export interface CommitSourceResult {
	ok: boolean;
	changed: boolean;
	previousSource: string;
	source: string;
	revision: number;
	error?: SourceDiagnostic;
	conflict?: {
		expectedRevision: number;
		actualRevision: number;
	};
}

export interface TimingDrag {
	trackId: string;
	edge: 'start' | 'end' | 'move';
	lane: HTMLElement;
	pointerStartCycle: number;
	startCycle: number;
	endCycle: number;
	pointerCycle: number;
	lastPointerClientX: number;
}

export type HeaderPopover = 'tempo' | 'key' | 'help' | 'length' | 'presets';

export type TrackDetails = ReturnType<typeof getSourceBlockDetails>[number];

export type PatchStudio = (patch: Partial<StudioState>) => void;
export type PersistStudioSnapshot = (snapshot?: StoredProjectSnapshot, generation?: number) => Promise<void>;
export type CommitSource = (source: string, options?: { recordHistory?: boolean; expectedRevision?: number }) => Promise<CommitSourceResult>;
