import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent as ReactChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
	createInitialProject,
	DEFAULT_SONG_END_CYCLE,
	diagnosticFromError,
	getSourceBlocks,
	getSourceIdentityDiagnostics,
	type AssetManifestEntry,
	LEGACY_DEFAULT_SOURCE,
	type RuntimeState,
	type SourceDiagnostic,
} from '../lib/project/model';
import {
	getSourceBlockDetails,
	getSourceGlobals,
	cyclesToSeconds,
	updateSourceKey,
	updateSourceQuarterNotesPerCycle,
	updateSourceTempo,
	deleteTrack as deleteSourceTrack,
	updateSourceBpm,
	updateTrackGain,
	updateTrackMode,
	updateTrackName as updateSourceTrackName,
	updateTrackPan,
	updateTrackRange as updateSourceTrackRange,
} from '../lib/project/source-mapper';
import { getSourceLineNumbers } from '../lib/project/editor';
import {
	clampTimelineZoom,
	DEFAULT_TIMELINE_ZOOM,
	getTimelineCapacityForEndCycle,
	getTimelineCells,
	MAX_TIMELINE_ZOOM,
	MIN_TIMELINE_ZOOM,
	TIMELINE_ZOOM_STEP,
} from '../lib/project/timeline';
import { highlightStrudel } from '../lib/project/syntax-highlight';
import { loadProjectSnapshot, parseProjectExport, saveProjectSnapshot, serializeProjectSnapshot, type StoredProjectSnapshot } from '../lib/project/storage';
import { isAudioLockedError, StrudelAdapter, type AdapterResult, type AdapterRuntimeUpdate } from '../lib/strudel/adapter';
import {
	applyTextEdits,
	registerWebMcpTools,
	sourceDiff,
	waitForNativeModelContext,
	type SourceMutationInput,
	type SourcePatchInput,
	type WebMcpController,
	type WebMcpKeyInput,
	type WebMcpMutationResult,
	type WebMcpPlaybackAction,
	type WebMcpPlaybackResult,
	type WebMcpRegistration,
	type WebMcpStateSnapshot,
	type WebMcpTempoInput,
	type WebMcpTimelineExtensionInput,
	type WebMcpTrackMutationInput,
	type WebMcpTrackRangeInput,
	type WebMcpTrackRenameInput,
	type WebMcpTrackTarget,
	type WebMcpValidationResult,
} from '../lib/webmcp/tools';
import { stableSerialize, TransactionCache, TransactionReuseError } from '../lib/webmcp/transaction-cache';

type StudioPhase = 'booting' | 'ready' | 'validating' | 'error';
type PersistenceState = 'loading' | 'ready' | 'unavailable';

interface StudioState {
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

type StudioCommand =
	| { type: 'writeSource'; source: string; expectedRevision?: number }
	| { type: 'play' }
	| { type: 'pause' }
	| { type: 'seek'; cycle: number }
	| { type: 'stop' };

type DispatchResult = { ok: true } | { ok: false; error?: unknown };

interface SourceHistoryEntry {
	before: string;
	after: string;
	beforeRevision: number;
	afterRevision: number;
}

interface SourceHistoryState {
	cursorSource: string;
	undo: SourceHistoryEntry[];
	redo: SourceHistoryEntry[];
}

interface CommitSourceResult {
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

interface TimingDrag {
	trackId: string;
	edge: 'start' | 'end' | 'move';
	lane: HTMLElement;
	pointerStartCycle: number;
	startCycle: number;
	endCycle: number;
	pointerCycle: number;
	lastPointerClientX: number;
}

function createInitialStudioState(): StudioState {
	const project = createInitialProject();
	return {
		projectName: project.name,
		assets: project.assets,
		draft: project.source.draft,
		lastValid: project.source.lastValid,
		revision: project.source.revision,
		activeRevision: 0,
		songEndCycle: project.timeline.songEndCycle ?? DEFAULT_SONG_END_CYCLE,
		diagnostics: [],
		phase: 'booting',
		persistenceState: 'loading',
		runtime: {
			audioState: 'initializing',
			transport: 'stopped',
			activeRevision: 0,
			currentCycle: 0,
		},
	};
}

function snapshotFromStudio(studio: StudioState): StoredProjectSnapshot {
	const project = createInitialProject();
	return {
		project: {
			...project,
			name: studio.projectName,
			assets: studio.assets.map((asset) => ({ ...asset })),
			source: {
				...project.source,
				draft: studio.draft,
				lastValid: studio.lastValid,
				revision: studio.revision,
			},
			timeline: {
				...project.timeline,
				songEndCycle: studio.songEndCycle,
			},
		},
		activeRevision: studio.activeRevision,
	};
}

function getDiagnosticLabel(diagnostic: SourceDiagnostic): string {
	return `${diagnostic.phase.toUpperCase()} / ${diagnostic.code}`;
}

function formatRevision(revision: number | null): string {
	return revision === null ? '—' : `r${revision.toString().padStart(3, '0')}`;
}

function getErrorDiagnostic(revision: number, error: unknown, phase: SourceDiagnostic['phase'], source: string) {
	const diagnostic = diagnosticFromError(revision, error, source);
	return { ...diagnostic, phase };
}

function getDiagnosticLocation(diagnostic: SourceDiagnostic): string {
	if (!diagnostic.range) return '';
	const column = diagnostic.range.column === undefined ? '' : `:${diagnostic.range.column}`;
	return `LINE ${diagnostic.range.line}${column} · REV ${formatRevision(diagnostic.revision)}`;
}

const TRACK_COLORS = ['#d9ff68', '#8fe1ff', '#f0a3c7', '#c7a6ff'];
const KEY_OPTIONS = [
	'C:major', 'C:minor',
	'C#:major', 'C#:minor',
	'D:major', 'D:minor',
	'D#:major', 'D#:minor',
	'E:major', 'E:minor',
	'F:major', 'F:minor',
	'F#:major', 'F#:minor',
	'G:major', 'G:minor',
	'G#:major', 'G#:minor',
	'A:major', 'A:minor',
	'A#:major', 'A#:minor',
	'B:major', 'B:minor',
];
const SOURCE_HISTORY_LIMIT = 100;
const EDITOR_WIDTH_MIN = 280;
const EDITOR_WIDTH_MAX = 560;
const TIMELINE_SNAP_CYCLE = 0.25;
const DEFAULT_TRACK_END_CYCLE = 4;
const TRACK_NAME_MAX_LENGTH = 80;
const TIMELINE_LABEL_MIN_WIDTH = 270;
const LEGACY_DEFAULT_SONG_END_CYCLES = [187, 187.5];

function getTrackColor(index: number): string {
	return TRACK_COLORS[index % TRACK_COLORS.length];
}

function getTrackLabel(type: string): string {
	return type === 'unknown' ? 'SOURCE' : type.toUpperCase();
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function snapCycle(value: number): number {
	return Math.round(value / TIMELINE_SNAP_CYCLE) * TIMELINE_SNAP_CYCLE;
}

function normalizeTrackRange(startCycle: number, endCycle: number, songEndCycle: number): { startCycle: number; endCycle: number } {
	const safeSongEnd = Number.isFinite(songEndCycle) && songEndCycle > 0 ? songEndCycle : TIMELINE_SNAP_CYCLE;
	const maxEnd = Math.max(TIMELINE_SNAP_CYCLE, Math.floor(safeSongEnd / TIMELINE_SNAP_CYCLE) * TIMELINE_SNAP_CYCLE);
	const start = clamp(snapCycle(Number.isFinite(startCycle) ? startCycle : 0), 0, Math.max(0, maxEnd - TIMELINE_SNAP_CYCLE));
	const end = clamp(snapCycle(Number.isFinite(endCycle) ? endCycle : start + TIMELINE_SNAP_CYCLE), start + TIMELINE_SNAP_CYCLE, maxEnd);
	return { startCycle: Number(start.toFixed(2)), endCycle: Number(end.toFixed(2)) };
}

function shiftTrackRange(startCycle: number, endCycle: number, delta: number): { startCycle: number; endCycle: number } {
	const length = Math.max(TIMELINE_SNAP_CYCLE, endCycle - startCycle);
	const nextStart = Math.max(0, snapCycle(startCycle + delta));
	return { startCycle: nextStart, endCycle: nextStart + length };
}

function formatClock(seconds: number): string {
	const totalSeconds = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const remainder = totalSeconds % 60;
	return [hours, minutes, remainder].map((value) => value.toString().padStart(2, '0')).join(':');
}

function formatCycle(cycle: number): string {
	return Number(cycle.toFixed(2)).toString();
}

function formatKey(key: string): string {
	return key.replace(':', ' ').toUpperCase();
}

function getExplicitSourceEndCycle(source: string): number {
	return getSourceBlockDetails(source)
		.filter((block) => block.timing.mode !== 'full')
		.reduce((endCycle, block) => Math.max(endCycle, block.timing.endCycle), 0);
}

function normalizeImportedSnapshot(snapshot: StoredProjectSnapshot): StoredProjectSnapshot {
	const project = createInitialProject();
	const imported = snapshot.project;
	const importedEndCycle = imported.timeline.songEndCycle;
	const configuredEndCycle = typeof importedEndCycle === 'number' && Number.isFinite(importedEndCycle) && importedEndCycle > 0
		? importedEndCycle
		: DEFAULT_SONG_END_CYCLE;
	const songEndCycle = getTimelineCapacityForEndCycle(Math.max(configuredEndCycle, getExplicitSourceEndCycle(imported.source.lastValid)));
	return {
		project: {
			...project,
			...imported,
			// Sushi currently opens one local project. Keep an imported document in
			// that project slot while preserving all portable authoring data.
			id: project.id,
			source: { ...imported.source },
			timeline: { ...imported.timeline, songEndCycle, songEndCycleVersion: 1 },
			assets: imported.assets.map((asset) => ({ ...asset })),
		},
		activeRevision: snapshot.activeRevision ?? imported.source.revision,
	};
}

function projectFileName(name: string): string {
	const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
	return `${slug || 'sushi-project'}.sushi.json`;
}

function getSourceCycleStep(source: string): number {
	const quarterNotesPerCycle = getSourceGlobals(source).quarterNotesPerCycle;
	return 1 / Math.max(1, Math.round(quarterNotesPerCycle));
}

function timelineLabelStride(pixelsPerCycle: number): number {
	if (pixelsPerCycle >= 48) return 1;
	if (pixelsPerCycle >= 24) return 2;
	if (pixelsPerCycle >= 12) return 4;
	if (pixelsPerCycle >= 6) return 8;
	return 16;
}

function sourceEntityIds(state: WebMcpStateSnapshot): string[] {
	return ['source', ...state.tracks.map((track) => track.id)];
}

type TrackDetails = ReturnType<typeof getSourceBlockDetails>[number];

function getTrackTimingForTimeline(track: TrackDetails | undefined, songEndCycle: number): TrackDetails['timing'] {
	if (track?.timing.mode !== 'full') return track?.timing ?? { mode: 'full', startCycle: 0, endCycle: Math.min(DEFAULT_TRACK_END_CYCLE, songEndCycle) };
	return { ...track.timing, endCycle: Math.min(DEFAULT_TRACK_END_CYCLE, songEndCycle) };
}

type TrackTargetResolution =
	| { ok: true; track: TrackDetails }
	| { ok: false; code: string; message: string };

function resolveTrackTarget(source: string, target: WebMcpTrackTarget): TrackTargetResolution {
	const tracks = getSourceBlockDetails(source);
	const byNumber = target.trackNumber === undefined ? undefined : tracks[target.trackNumber - 1];
	const byId = target.trackId === undefined ? undefined : tracks.find((track) => track.id === target.trackId);
	const normalizedName = target.trackName?.trim().toLocaleLowerCase();
	const byName = normalizedName
		? tracks.filter((track) => track.name.trim().toLocaleLowerCase() === normalizedName)
		: [];

	if (target.trackNumber !== undefined && !byNumber) {
		return { ok: false, code: 'TRACK_NOT_FOUND', message: `No track exists at track number ${target.trackNumber}.` };
	}
	if (target.trackId !== undefined && !byId) {
		return { ok: false, code: 'TRACK_NOT_FOUND', message: `No track exists with ID ${JSON.stringify(target.trackId)}.` };
	}
	if (normalizedName && byName.length > 1) {
		return { ok: false, code: 'AMBIGUOUS_TRACK_NAME', message: `More than one track is named ${JSON.stringify(target.trackName)}; use trackNumber.` };
	}
	if (byNumber && byName.length === 1 && byNumber.id !== byName[0].id) {
		return { ok: false, code: 'TRACK_TARGET_MISMATCH', message: 'trackNumber and trackName identify different tracks.' };
	}
	if (byNumber && byId && byNumber.id !== byId.id) {
		return { ok: false, code: 'TRACK_TARGET_MISMATCH', message: 'trackNumber and trackId identify different tracks.' };
	}
	if (byId && byName.length === 1 && byId.id !== byName[0].id) {
		return { ok: false, code: 'TRACK_TARGET_MISMATCH', message: 'trackId and trackName identify different tracks.' };
	}
	if (byNumber) return { ok: true, track: byNumber };
	if (byId) return { ok: true, track: byId };
	if (byName.length === 1) return { ok: true, track: byName[0] };
	return { ok: false, code: 'TRACK_NOT_FOUND', message: `No track is named ${JSON.stringify(target.trackName)}.` };
}

function sourceForTrackMutation(studio: StudioState): string {
	return getSourceBlockDetails(studio.draft).length ? studio.draft : studio.lastValid;
}

function makeMutationResult(
	state: WebMcpStateSnapshot,
	action: string,
	transactionId: string,
	beforeSource: string,
	beforeRevision: number,
	ok: boolean,
	message: string,
	error?: { code: string; message: string; details?: Record<string, unknown> },
	affectedEntityIds: string[] = sourceEntityIds(state),
): WebMcpMutationResult {
	const diff = sourceDiff(beforeSource, state.source.draft, beforeRevision, state.source.revision);
	return {
		ok,
		action,
		affectedEntityIds,
		message,
		state,
		revision: state.source.revision,
		activeRevision: state.source.activeRevision,
		transactionId,
		...(diff ? { diff } : {}),
		...(error ? { error } : {}),
	};
}

export default function Studio() {
	const [studio, setStudio] = useState<StudioState>(createInitialStudioState);
	const [editorWidth, setEditorWidth] = useState(350);
	const [arrangementZoom, setArrangementZoom] = useState(DEFAULT_TIMELINE_ZOOM);
	const [, setSourceHistoryVersion] = useState(0);
	const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
	const [contextMenu, setContextMenu] = useState<{ trackId: string; x: number; y: number } | null>(null);
	const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
	const [renamingTrackValue, setRenamingTrackValue] = useState('');
	const [timelineZoom, setTimelineZoom] = useState(50);
	const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
	const studioRef = useRef(studio);
	const studioGenerationRef = useRef(0);
	const adapterRef = useRef<StrudelAdapter | null>(null);
	const mountedRef = useRef(true);
	const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null);
	const sourceHighlightRef = useRef<HTMLPreElement | null>(null);
	const editorGutterRef = useRef<HTMLDivElement | null>(null);
	const projectImportInputRef = useRef<HTMLInputElement | null>(null);
	const timelineViewportRef = useRef<HTMLElement | null>(null);
	const timelineShellRef = useRef<HTMLElement | null>(null);
	const timelineZoomAnchorRef = useRef<number | null>(null);
	const editorResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const pendingTrackSourceRef = useRef<{ source: string; baseRevision: number } | null>(null);
	const trackCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const sourceCommitQueueRef = useRef<Promise<void>>(Promise.resolve());
	const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
	const timingDragRef = useRef<TimingDrag | null>(null);
	const timelineSeekDragRef = useRef<HTMLElement | null>(null);
	const timelineSeekCycleRef = useRef<number | null>(null);
	const contextMenuRef = useRef<HTMLDivElement | null>(null);
	const sourceHistoryRef = useRef<SourceHistoryState>({
		cursorSource: createInitialProject().source.draft,
		undo: [],
		redo: [],
	});
	const sourceTransactionsRef = useRef(new TransactionCache<WebMcpMutationResult>(SOURCE_HISTORY_LIMIT));
	const webmcpRegistrationRef = useRef<WebMcpRegistration | null>(null);
	const webmcpAvailableRef = useRef(false);

	const syncEditorScroll = useCallback(() => {
		const editor = sourceEditorRef.current;
		if (!editor) return;
		if (sourceHighlightRef.current) {
			sourceHighlightRef.current.scrollTop = editor.scrollTop;
			sourceHighlightRef.current.scrollLeft = editor.scrollLeft;
		}
		if (editorGutterRef.current) editorGutterRef.current.scrollTop = editor.scrollTop;
	}, []);

	const handleEditorResizePointerMove = useCallback((event: PointerEvent) => {
		const drag = editorResizeRef.current;
		if (!drag) return;
		setEditorWidth(clamp(drag.startWidth + event.clientX - drag.startX, EDITOR_WIDTH_MIN, EDITOR_WIDTH_MAX));
	}, []);

	const stopEditorResize = useCallback(() => {
		editorResizeRef.current = null;
		window.removeEventListener('pointermove', handleEditorResizePointerMove);
		window.removeEventListener('pointerup', stopEditorResize);
		window.removeEventListener('pointercancel', stopEditorResize);
	}, [handleEditorResizePointerMove]);

	const startEditorResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		editorResizeRef.current = { startX: event.clientX, startWidth: editorWidth };
		window.addEventListener('pointermove', handleEditorResizePointerMove);
		window.addEventListener('pointerup', stopEditorResize);
		window.addEventListener('pointercancel', stopEditorResize);
	}, [editorWidth, handleEditorResizePointerMove, stopEditorResize]);

	const handleEditorResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
		event.preventDefault();
		if (event.key === 'Home') {
			setEditorWidth(EDITOR_WIDTH_MIN);
			return;
		}
		if (event.key === 'End') {
			setEditorWidth(EDITOR_WIDTH_MAX);
			return;
		}
		setEditorWidth((current) => clamp(current + (event.key === 'ArrowRight' ? 16 : -16), EDITOR_WIDTH_MIN, EDITOR_WIDTH_MAX));
	}, []);

	const patchStudio = useCallback((patch: Partial<StudioState>) => {
		const next = { ...studioRef.current, ...patch };
		studioRef.current = next;
		setStudio(next);
	}, []);

	const patchRuntime = useCallback(
		(update: AdapterRuntimeUpdate) => {
			const runtime = { ...studioRef.current.runtime, ...update };
			patchStudio({ runtime });
		},
		[patchStudio],
	);

	const bumpSourceHistory = useCallback(() => {
		setSourceHistoryVersion((version) => version + 1);
	}, []);

	useEffect(() => {
		const generation = studioGenerationRef.current + 1;
		studioGenerationRef.current = generation;
		mountedRef.current = true;
		const adapter = new StrudelAdapter(patchRuntime);
		adapterRef.current = adapter;
		const isCurrentSession = () => mountedRef.current && studioGenerationRef.current === generation;

		const boot = async () => {
			const fallbackProject = createInitialProject();
			let stored: StoredProjectSnapshot | null = null;
			let persistenceState: PersistenceState = 'ready';

			try {
				stored = await loadProjectSnapshot(fallbackProject.id);
			} catch {
				persistenceState = 'unavailable';
			}

			if (!isCurrentSession()) return;
			const storedProject = stored?.project;
			const isUntouchedLegacySeed = storedProject?.source.revision === 0
				&& storedProject.source.draft === LEGACY_DEFAULT_SOURCE
				&& storedProject.source.lastValid === LEGACY_DEFAULT_SOURCE;
			const project = !storedProject
				? fallbackProject
				: isUntouchedLegacySeed ? { ...storedProject, source: fallbackProject.source } : storedProject;
			const activeRevision = !storedProject || isUntouchedLegacySeed
				? fallbackProject.source.revision
				: stored?.activeRevision ?? project.source.revision;
			const storedEndCycle = project.timeline.songEndCycle;
			const configuredEndCycle = typeof storedEndCycle === 'number' && Number.isFinite(storedEndCycle) && storedEndCycle > 0
				? storedEndCycle
				: DEFAULT_SONG_END_CYCLE;
			// Projects created before the editable timeline boundary used four
			// cycles implicitly. Upgrade that legacy default once while preserving
			// an intentional four-cycle boundary saved by the current schema.
			const legacyTimeline = project.timeline.songEndCycleVersion !== 1;
			const normalizedEndCycle = Math.max(
				legacyTimeline && storedEndCycle === 4 ? DEFAULT_SONG_END_CYCLE : configuredEndCycle,
				getExplicitSourceEndCycle(project.source.lastValid),
			);
			const songEndCycle = getTimelineCapacityForEndCycle(normalizedEndCycle);
			sourceHistoryRef.current = {
				cursorSource: project.source.draft,
				undo: [],
				redo: [],
			};
			sourceTransactionsRef.current.clear();
			patchStudio({
				projectName: project.name,
				assets: project.assets.map((asset) => ({ ...asset })),
				draft: project.source.draft,
				lastValid: project.source.lastValid,
				revision: project.source.revision,
				activeRevision,
				songEndCycle,
				persistenceState,
				runtime: { ...studioRef.current.runtime, activeRevision },
			});

			try {
				await adapter.init();
				if (!isCurrentSession()) return;
				const identityDiagnostics = getSourceIdentityDiagnostics(activeRevision, studioRef.current.lastValid);
				if (identityDiagnostics.length) {
					patchStudio({
						phase: 'error',
						diagnostics: identityDiagnostics,
						runtime: { ...studioRef.current.runtime, audioState: 'error', activeRevision: null },
					});
					return;
				}
				const initial = await adapter.evaluateSource(studioRef.current.lastValid, {
					autoplay: false,
				});
				if (!isCurrentSession()) return;

				if (initial.ok) {
					let draftDiagnostics: SourceDiagnostic[] = [];
					if (studioRef.current.draft !== studioRef.current.lastValid) {
						const identityDiagnostics = getSourceIdentityDiagnostics(studioRef.current.revision, studioRef.current.draft);
						if (identityDiagnostics.length) {
							draftDiagnostics = identityDiagnostics;
						} else {
							try {
								const draftValidation = await adapter.validateSource(studioRef.current.draft, studioRef.current.lastValid);
								if (!draftValidation.ok) draftDiagnostics = [diagnosticFromError(studioRef.current.revision, draftValidation.error, studioRef.current.draft)];
							} catch (error) {
								draftDiagnostics = [diagnosticFromError(studioRef.current.revision, error, studioRef.current.draft)];
							}
						}
					}
					if (!isCurrentSession()) return;
					patchStudio({
						phase: draftDiagnostics.length ? 'error' : 'ready',
						diagnostics: draftDiagnostics,
						runtime: {
							...studioRef.current.runtime,
							audioState: 'locked',
							transport: 'stopped',
							activeRevision,
						},
					});
				} else {
					patchStudio({
						phase: 'error',
						diagnostics: [diagnosticFromError(activeRevision, initial.error, studioRef.current.lastValid)],
						runtime: {
							...studioRef.current.runtime,
							audioState: 'error',
							activeRevision: null,
						},
					});
				}
			} catch (error) {
				if (!isCurrentSession()) return;
				patchStudio({
					phase: 'error',
					diagnostics: [getErrorDiagnostic(activeRevision, error, 'audio', studioRef.current.lastValid)],
					runtime: { ...studioRef.current.runtime, audioState: 'error', activeRevision: null },
				});
			}
		};

		void boot();
		return () => {
			mountedRef.current = false;
			studioGenerationRef.current += 1;
			if (trackCommitTimerRef.current !== null) {
				clearTimeout(trackCommitTimerRef.current);
				trackCommitTimerRef.current = null;
			}
			pendingTrackSourceRef.current = null;
			adapter.destroy();
			adapterRef.current = null;
		};
	}, [patchRuntime, patchStudio]);

	const persistStudioSnapshot = useCallback(async (
		snapshot: StoredProjectSnapshot = snapshotFromStudio(studioRef.current),
		generation = studioGenerationRef.current,
	): Promise<void> => {
		const operation = persistenceQueueRef.current.then(async () => {
			// A queued autosave can outlive a React island. Do not let a stale
			// session write after teardown (especially same-revision metadata such
			// as a project rename) or a remounted session overwrite newer state.
			if (!mountedRef.current || studioGenerationRef.current !== generation) return;
			await saveProjectSnapshot(snapshot.project.id, snapshot);
		});
		persistenceQueueRef.current = operation.then(() => undefined, () => undefined);
		try {
			await operation;
		} catch {
			if (mountedRef.current && studioGenerationRef.current === generation && studioRef.current.persistenceState === 'ready') {
				patchStudio({ persistenceState: 'unavailable' });
			}
		}
	}, [patchStudio]);

	useEffect(() => {
		if (studio.persistenceState !== 'ready') return undefined;

		const snapshot = snapshotFromStudio(studioRef.current);
		const generation = studioGenerationRef.current;
		const timeout = setTimeout(() => {
			void persistStudioSnapshot(snapshot, generation);
		}, 220);

		return () => clearTimeout(timeout);
	}, [persistStudioSnapshot, studio.activeRevision, studio.draft, studio.lastValid, studio.persistenceState, studio.projectName, studio.revision, studio.songEndCycle]);

	const commitSource = useCallback(
		(source: string, options: { recordHistory?: boolean; expectedRevision?: number } = {}): Promise<CommitSourceResult> => {
			const operationGeneration = studioGenerationRef.current;
			const operation = sourceCommitQueueRef.current.then(async (): Promise<CommitSourceResult> => {
				const current = studioRef.current;
				const previousSource = sourceHistoryRef.current.cursorSource;
				if (!mountedRef.current || studioGenerationRef.current !== operationGeneration) {
					return {
						ok: false,
						changed: false,
						previousSource,
						source,
						revision: current.revision,
						error: diagnosticFromError(current.revision, new Error('The studio session is no longer active.'), source),
					};
				}
				const adapter = adapterRef.current;
				if (!adapter) return { ok: false, changed: false, previousSource, source, revision: current.revision, error: diagnosticFromError(current.revision, new Error('The Strudel runtime is not ready.'), source) };
				if (options.expectedRevision !== undefined && current.revision !== options.expectedRevision) {
					return { ok: false, changed: false, previousSource, source, revision: current.revision, conflict: { expectedRevision: options.expectedRevision, actualRevision: current.revision } };
				}
				const hasSourceDiagnostics = current.diagnostics.some((diagnostic) => diagnostic.phase !== 'audio');
				if (source === current.lastValid && source === current.draft && !hasSourceDiagnostics) {
					sourceHistoryRef.current.cursorSource = source;
					return { ok: true, changed: false, previousSource, source, revision: current.revision };
				}
				// Re-submitting the same rejected draft is a no-op. Preserve its
				// diagnostic and revision instead of manufacturing another history
				// entry for identical source bytes.
				if (source === current.draft && current.phase === 'error' && current.diagnostics.length > 0) {
					sourceHistoryRef.current.cursorSource = source;
					return { ok: false, changed: false, previousSource, source, revision: current.revision, error: current.diagnostics[0] };
				}

				const baseRevision = current.revision;
				const revision = baseRevision + 1;
				patchStudio({ draft: source, revision, phase: 'validating', diagnostics: [] });
				const identityDiagnostics = getSourceIdentityDiagnostics(revision, source);
				if (identityDiagnostics.length) {
					const diagnostic = identityDiagnostics[0];
					patchStudio({
						phase: 'error',
						diagnostics: identityDiagnostics,
						runtime: { ...studioRef.current.runtime, activeRevision: studioRef.current.activeRevision },
					});
					sourceHistoryRef.current.cursorSource = source;
					if (options.recordHistory !== false && source !== previousSource) {
						sourceHistoryRef.current.undo.push({ before: previousSource, after: source, beforeRevision: baseRevision, afterRevision: revision });
						if (sourceHistoryRef.current.undo.length > SOURCE_HISTORY_LIMIT) sourceHistoryRef.current.undo.shift();
						sourceHistoryRef.current.redo = [];
						bumpSourceHistory();
					}
					if (mountedRef.current && studioGenerationRef.current === operationGeneration) await persistStudioSnapshot(undefined, operationGeneration);
					return { ok: false, changed: source !== previousSource, previousSource, source, revision, error: diagnostic };
				}
				let result: AdapterResult;
				try {
					result = await adapter.evaluateSource(source, {
						autoplay: false,
						restoreSource: current.lastValid,
					});
				} catch (error) {
					result = { ok: false, error };
				}

				if (!mountedRef.current || studioGenerationRef.current !== operationGeneration) return { ok: false, changed: false, previousSource, source, revision };
				if (result.ok) {
					const explicitEndCycle = getExplicitSourceEndCycle(source);
					const nextSongEndCycle = getTimelineCapacityForEndCycle(Math.max(studioRef.current.songEndCycle, explicitEndCycle));
					adapter.setSongEndCycle(nextSongEndCycle);
					patchStudio({
						lastValid: source,
						activeRevision: revision,
						songEndCycle: nextSongEndCycle,
						diagnostics: [],
						phase: 'ready',
						runtime: { ...studioRef.current.runtime, activeRevision: revision },
					});
					sourceHistoryRef.current.cursorSource = source;
					if (options.recordHistory !== false && source !== previousSource) {
						sourceHistoryRef.current.undo.push({ before: previousSource, after: source, beforeRevision: baseRevision, afterRevision: revision });
						if (sourceHistoryRef.current.undo.length > SOURCE_HISTORY_LIMIT) sourceHistoryRef.current.undo.shift();
						sourceHistoryRef.current.redo = [];
						bumpSourceHistory();
					}
					if (mountedRef.current && studioGenerationRef.current === operationGeneration) await persistStudioSnapshot(undefined, operationGeneration);
					return { ok: true, changed: source !== previousSource, previousSource, source, revision };
				}

				const diagnostic = diagnosticFromError(revision, result.error, source);
				patchStudio({
					phase: 'error',
					diagnostics: [diagnostic],
					runtime: { ...studioRef.current.runtime, activeRevision: studioRef.current.activeRevision },
				});
				sourceHistoryRef.current.cursorSource = source;
				if (options.recordHistory !== false && source !== previousSource) {
					sourceHistoryRef.current.undo.push({ before: previousSource, after: source, beforeRevision: baseRevision, afterRevision: revision });
					if (sourceHistoryRef.current.undo.length > SOURCE_HISTORY_LIMIT) sourceHistoryRef.current.undo.shift();
					sourceHistoryRef.current.redo = [];
					bumpSourceHistory();
				}
				if (mountedRef.current && studioGenerationRef.current === operationGeneration) await persistStudioSnapshot(undefined, operationGeneration);
				return { ok: false, changed: source !== previousSource, previousSource, source, revision, error: diagnostic };
			});
			sourceCommitQueueRef.current = operation.then(() => undefined, () => undefined);
			return operation;
		},
		[bumpSourceHistory, patchStudio, persistStudioSnapshot],
	);

	const cancelPendingTrackCommit = useCallback(() => {
		if (trackCommitTimerRef.current !== null) {
			clearTimeout(trackCommitTimerRef.current);
			trackCommitTimerRef.current = null;
		}
		pendingTrackSourceRef.current = null;
	}, []);

	const queueTrackCommit = useCallback(
		(source: string, baseRevision: number) => {
			pendingTrackSourceRef.current = { source, baseRevision };
			if (trackCommitTimerRef.current !== null) clearTimeout(trackCommitTimerRef.current);
			trackCommitTimerRef.current = setTimeout(() => {
				const queuedEdit = pendingTrackSourceRef.current;
				pendingTrackSourceRef.current = null;
				trackCommitTimerRef.current = null;
				if (queuedEdit !== null) void commitSource(queuedEdit.source, { expectedRevision: queuedEdit.baseRevision });
			}, 120);
		},
		[commitSource],
	);

	useEffect(() => cancelPendingTrackCommit, [cancelPendingTrackCommit]);

	const addTrack = useCallback(async () => {
		cancelPendingTrackCommit();
		const baseRevision = studioRef.current.revision;
		const draft = studioRef.current.draft.trimEnd();
		const currentSource = getSourceBlocks(draft).length || !/\bsilence\s*$/.test(draft) ? draft : draft.replace(/\s*silence\s*$/, '');
		const nextTrackNumber = getSourceBlocks(currentSource).length + 1;
		const existingIds = new Set(getSourceBlocks(currentSource).map((track) => track.id));
		let trackId = '';
		while (!trackId || existingIds.has(trackId)) {
			const randomUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
				? crypto.randomUUID().toUpperCase()
				: `${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
			trackId = `trk_${randomUuid}`;
		}
		const nextSource = `${currentSource}\n\n// @sushi-track {"id":"${trackId}","name":"Track ${nextTrackNumber}","type":"synth","schema":1}\n$: seqPLoop([0, 4, note("<c3 e3 g3 a3>").s("sine").gain(0.18)])\n`;
		await commitSource(nextSource, { expectedRevision: baseRevision });
	}, [cancelPendingTrackCommit, commitSource]);

	const updateSourceDraft = useCallback(
		(update: (source: string) => string) => {
			const currentSource = studioRef.current.draft;
			const nextSource = update(currentSource);
			if (nextSource === currentSource) return;
			const baseRevision = studioRef.current.revision;
			patchStudio({
				draft: nextSource,
				...(studioRef.current.diagnostics.length ? { diagnostics: [], phase: 'ready' as const } : {}),
			});
			queueTrackCommit(nextSource, baseRevision);
		},
		[patchStudio, queueTrackCommit],
	);

	const updateTrackSource = useCallback(
		(_trackId: string, update: (source: string) => string) => updateSourceDraft(update),
		[updateSourceDraft],
	);

	const extendTimeline = useCallback(() => {
		const currentSongEndCycle = studioRef.current.songEndCycle;
		const nextSongEndCycle = getTimelineCapacityForEndCycle(currentSongEndCycle + TIMELINE_SNAP_CYCLE);
		if (nextSongEndCycle <= currentSongEndCycle) return;
		adapterRef.current?.setSongEndCycle(nextSongEndCycle);
		patchStudio({ songEndCycle: nextSongEndCycle });
		void persistStudioSnapshot();
	}, [patchStudio, persistStudioSnapshot]);

	const setTrackRange = useCallback(
		(trackId: string, startCycle: number, endCycle: number) => {
			const current = studioRef.current;
			const requestedEndCycle = Math.max(
				Number.isFinite(startCycle) ? startCycle : 0,
				Number.isFinite(endCycle) ? endCycle : 0,
			);
			const nextSongEndCycle = requestedEndCycle > current.songEndCycle
				? getTimelineCapacityForEndCycle(requestedEndCycle)
				: current.songEndCycle;
			if (nextSongEndCycle > current.songEndCycle) {
				adapterRef.current?.setSongEndCycle(nextSongEndCycle);
				patchStudio({ songEndCycle: nextSongEndCycle });
				void persistStudioSnapshot();
			}
			const range = normalizeTrackRange(startCycle, endCycle, nextSongEndCycle);
			updateTrackSource(trackId, (source) => updateSourceTrackRange(source, trackId, range.startCycle, range.endCycle, getSourceCycleStep(source)));
		},
		[patchStudio, persistStudioSnapshot, updateTrackSource],
	);

	const setSongEndCycle = useCallback((value: number) => {
		if (!Number.isFinite(value) || value <= 0) return;
		const cycleStep = getSourceCycleStep(studioRef.current.lastValid);
		const requestedEndCycle = Math.max(cycleStep, Math.round(value / cycleStep) * cycleStep);
		const currentSongEndCycle = studioRef.current.songEndCycle;
		const nextSongEndCycle = requestedEndCycle > currentSongEndCycle
			? getTimelineCapacityForEndCycle(requestedEndCycle)
			: Math.max(requestedEndCycle, getExplicitSourceEndCycle(studioRef.current.lastValid));
		adapterRef.current?.setSongEndCycle(nextSongEndCycle);
		patchStudio({
			songEndCycle: nextSongEndCycle,
			...(studioRef.current.runtime.currentCycle > nextSongEndCycle ? { runtime: { ...studioRef.current.runtime, currentCycle: nextSongEndCycle } } : {}),
		});
		// Timeline edits are project data too. Persist immediately so a reload
		// cannot lose a boundary change made between autosave ticks.
		void persistStudioSnapshot();
	}, [patchStudio, persistStudioSnapshot]);

	const adjustArrangementZoom = useCallback((delta: number) => {
		const shell = timelineShellRef.current;
		if (shell && shell.scrollWidth > 0) {
			timelineZoomAnchorRef.current = (shell.scrollLeft + shell.clientWidth / 2) / shell.scrollWidth;
		}
		setArrangementZoom((current) => clampTimelineZoom(current + delta));
	}, []);

	useEffect(() => {
		const anchor = timelineZoomAnchorRef.current;
		if (anchor === null) return;
		timelineZoomAnchorRef.current = null;
		const frame = requestAnimationFrame(() => {
			const shell = timelineShellRef.current;
			if (!shell) return;
			shell.scrollLeft = Math.max(0, anchor * shell.scrollWidth - shell.clientWidth / 2);
		});
		return () => cancelAnimationFrame(frame);
	}, [arrangementZoom]);

	const updateGlobalSource = useCallback(
		(update: (source: string) => string) => updateSourceDraft(update),
		[updateSourceDraft],
	);

	const setTempo = useCallback(
		(bpm: number): void => updateGlobalSource((source) => updateSourceBpm(source, bpm)),
		[updateGlobalSource],
	);

	const setKey = useCallback(
		(key: string): void => updateGlobalSource((source) => updateSourceKey(source, key)),
		[updateGlobalSource],
	);

	const commitTempo = useCallback(
		async (bpm: number): Promise<CommitSourceResult> => {
			cancelPendingTrackCommit();
			const current = studioRef.current;
			const nextSource = updateSourceBpm(current.draft, bpm);
			if (nextSource === current.draft) return { ok: true, changed: false, previousSource: current.draft, source: current.draft, revision: current.revision };
			return commitSource(nextSource);
		},
		[cancelPendingTrackCommit, commitSource],
	);

	const commitKey = useCallback(
		async (key: string): Promise<CommitSourceResult> => {
			cancelPendingTrackCommit();
			const current = studioRef.current;
			const nextSource = updateSourceKey(current.draft, key);
			if (nextSource === current.draft) return { ok: true, changed: false, previousSource: current.draft, source: current.draft, revision: current.revision };
			return commitSource(nextSource);
		},
		[cancelPendingTrackCommit, commitSource],
	);

	const commitTrackRange = useCallback(
		async (trackId: string, startCycle: number, endCycle: number): Promise<CommitSourceResult> => {
			cancelPendingTrackCommit();
			const current = studioRef.current;
			const requestedEndCycle = Math.max(
				Number.isFinite(startCycle) ? startCycle : 0,
				Number.isFinite(endCycle) ? endCycle : 0,
			);
			const timelineEndCycle = requestedEndCycle > current.songEndCycle
				? getTimelineCapacityForEndCycle(requestedEndCycle)
				: current.songEndCycle;
			const range = normalizeTrackRange(startCycle, endCycle, timelineEndCycle);
			const source = sourceForTrackMutation(current);
			const nextSource = updateSourceTrackRange(source, trackId, range.startCycle, range.endCycle);
			if (nextSource === source) {
				return { ok: true, changed: false, previousSource: source, source, revision: current.revision };
			}
			return commitSource(nextSource);
		},
		[cancelPendingTrackCommit, commitSource],
	);

	const renameTrack = useCallback(
		async (trackId: string, name: string): Promise<CommitSourceResult> => {
			cancelPendingTrackCommit();
			const current = studioRef.current;
			const normalizedName = name.trim();
			if (!normalizedName) {
				return {
					ok: false,
					changed: false,
					previousSource: current.draft,
					source: current.draft,
					revision: current.revision,
					error: diagnosticFromError(current.revision, new Error('Track name cannot be empty.'), current.draft),
				};
			}
			const source = sourceForTrackMutation(current);
			const nextSource = updateSourceTrackName(source, trackId, normalizedName);
			if (nextSource === source) {
				return { ok: true, changed: false, previousSource: source, source, revision: current.revision };
			}
			return commitSource(nextSource);
		},
		[cancelPendingTrackCommit, commitSource],
	);

	const deleteTrack = useCallback(
		async (trackId: string): Promise<CommitSourceResult> => {
			cancelPendingTrackCommit();
			const current = studioRef.current;
			const source = sourceForTrackMutation(current);
			const nextSource = deleteSourceTrack(source, trackId);
			if (nextSource === source) {
				return {
					ok: false,
					changed: false,
					previousSource: source,
					source,
					revision: current.revision,
					error: diagnosticFromError(current.revision, new Error('The selected track no longer exists in the source.'), current.draft),
				};
			}
			const result = await commitSource(nextSource);
			if (result.ok) setSelectedTrackId((selected) => selected === trackId ? null : selected);
			return result;
		},
		[cancelPendingTrackCommit, commitSource],
	);

	const handleTimingPointerMove = useCallback(
		(event: PointerEvent) => {
			const drag = timingDragRef.current;
			if (!drag) return;

			const rect = drag.lane.getBoundingClientRect();
			if (!rect.width) return;
			const songEndCycle = studioRef.current.songEndCycle;
			// Accumulate pointer movement instead of remapping the absolute
			// pointer position on every event. The timeline can grow while the
			// pointer is outside its old boundary, which changes the grid scale;
			// accumulating keeps the drag target stable across that reflow.
			drag.pointerCycle = Math.max(0, drag.pointerCycle + ((event.clientX - drag.lastPointerClientX) / rect.width) * songEndCycle);
			drag.lastPointerClientX = event.clientX;
			const nextCycle = Math.max(0, snapCycle(drag.pointerCycle));

			if (drag.edge === 'move') {
				const delta = nextCycle - drag.pointerStartCycle;
				const range = shiftTrackRange(drag.startCycle, drag.endCycle, delta);
				setTrackRange(drag.trackId, range.startCycle, range.endCycle);
				return;
			}

			const details = getSourceBlockDetails(studioRef.current.draft).find((block) => block.id === drag.trackId);
			if (!details) return;
			const startCycle = drag.edge === 'start' ? Math.min(nextCycle, drag.endCycle - TIMELINE_SNAP_CYCLE) : drag.startCycle;
			const endCycle = drag.edge === 'end' ? Math.max(nextCycle, drag.startCycle + TIMELINE_SNAP_CYCLE) : drag.endCycle;
			setTrackRange(drag.trackId, Math.max(0, startCycle), Math.max(0, endCycle));
		},
		[setTrackRange],
	);

	const stopTimingDrag = useCallback(() => {
		timingDragRef.current = null;
		window.removeEventListener('pointermove', handleTimingPointerMove);
		window.removeEventListener('pointerup', stopTimingDrag);
		window.removeEventListener('pointercancel', stopTimingDrag);
	}, [handleTimingPointerMove]);

	const startTimingDrag = useCallback(
		(event: ReactPointerEvent<HTMLElement>, trackId: string, edge: 'start' | 'end' | 'move') => {
			const lane = event.currentTarget.closest('.lane-grid');
			if (!(lane instanceof HTMLElement)) return;
			const details = getSourceBlockDetails(studioRef.current.draft).find((block) => block.id === trackId);
			if (!details) return;
			const timing = getTrackTimingForTimeline(details, studioRef.current.songEndCycle);
			event.preventDefault();
			event.stopPropagation();
			const rect = lane.getBoundingClientRect();
			const pointerCycle = rect.width
				? Math.max(0, ((event.clientX - rect.left) / rect.width) * studioRef.current.songEndCycle)
				: timing.startCycle;
			timingDragRef.current = {
				trackId,
				edge,
				lane,
				pointerStartCycle: snapCycle(pointerCycle),
				startCycle: timing.startCycle,
				endCycle: timing.endCycle,
				pointerCycle,
				lastPointerClientX: event.clientX,
			};
			window.addEventListener('pointermove', handleTimingPointerMove);
			window.addEventListener('pointerup', stopTimingDrag);
			window.addEventListener('pointercancel', stopTimingDrag);
		},
		[handleTimingPointerMove, stopTimingDrag],
	);

	useEffect(() => stopTimingDrag, [stopTimingDrag]);
	useEffect(() => stopEditorResize, [stopEditorResize]);

	useEffect(() => {
		const viewport = timelineViewportRef.current;
		if (!viewport) return undefined;
		const updateViewportWidth = () => setTimelineViewportWidth(viewport.clientWidth);
		updateViewportWidth();
		if (typeof ResizeObserver === 'undefined') {
			window.addEventListener('resize', updateViewportWidth);
			return () => window.removeEventListener('resize', updateViewportWidth);
		}
		const observer = new ResizeObserver(updateViewportWidth);
		observer.observe(viewport);
		return () => observer.disconnect();
	}, []);

	const setTrackGain = useCallback(
		(trackId: string, value: number) => updateTrackSource(trackId, (source) => updateTrackGain(source, trackId, value)),
		[updateTrackSource],
	);

	const setTrackPan = useCallback(
		(trackId: string, value: number) => updateTrackSource(trackId, (source) => updateTrackPan(source, trackId, value)),
		[updateTrackSource],
	);

	const setQuarterNotesPerCycle = useCallback(
		(value: number) => updateSourceDraft((source) => updateSourceQuarterNotesPerCycle(source, value)),
		[updateSourceDraft],
	);

	const undoSourceEdit = useCallback(async () => {
		cancelPendingTrackCommit();
		const current = studioRef.current;
		const entry = sourceHistoryRef.current.undo[sourceHistoryRef.current.undo.length - 1];
		// A draft that has not been committed is deliberately left alone. Revert
		// remains the explicit action for discarding that draft; undo only walks the
		// shared, validated source history.
		if (!entry || current.draft !== entry.after) return;
		const result = await commitSource(entry.before, { recordHistory: false, expectedRevision: current.revision });
		if (!result.ok) return;
		sourceHistoryRef.current.undo.pop();
		sourceHistoryRef.current.redo.push(entry);
		if (sourceHistoryRef.current.redo.length > SOURCE_HISTORY_LIMIT) sourceHistoryRef.current.redo.shift();
		bumpSourceHistory();
	}, [bumpSourceHistory, cancelPendingTrackCommit, commitSource]);

	const redoSourceEdit = useCallback(async () => {
		cancelPendingTrackCommit();
		const current = studioRef.current;
		const entry = sourceHistoryRef.current.redo[sourceHistoryRef.current.redo.length - 1];
		if (!entry || current.draft !== entry.before) return;
		const result = await commitSource(entry.after, { recordHistory: false, expectedRevision: current.revision });
		if (!result.ok) return;
		sourceHistoryRef.current.redo.pop();
		sourceHistoryRef.current.undo.push(entry);
		if (sourceHistoryRef.current.undo.length > SOURCE_HISTORY_LIMIT) sourceHistoryRef.current.undo.shift();
		bumpSourceHistory();
	}, [bumpSourceHistory, cancelPendingTrackCommit, commitSource]);

	const exportProject = useCallback(() => {
		if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
		const blob = new Blob([serializeProjectSnapshot(snapshotFromStudio(studioRef.current))], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = projectFileName(studioRef.current.projectName);
		document.body?.append(link);
		link.click();
		link.remove();
		window.setTimeout(() => URL.revokeObjectURL(url), 0);
	}, []);

	const importProject = useCallback(async (event: ReactChangeEvent<HTMLInputElement>) => {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = '';
		if (!file) return;
		const generation = studioGenerationRef.current;
		let parsed: ReturnType<typeof parseProjectExport>;
		try {
			parsed = parseProjectExport(await file.text());
		} catch (error) {
			parsed = { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
		}
		if (!mountedRef.current || studioGenerationRef.current !== generation) return;
		if (!parsed.ok) {
			patchStudio({ phase: 'error', diagnostics: [getErrorDiagnostic(studioRef.current.revision, parsed.error, 'parse', studioRef.current.draft)] });
			return;
		}

		const imported = normalizeImportedSnapshot(parsed.snapshot);
		const identityDiagnostics = getSourceIdentityDiagnostics(imported.project.source.revision, imported.project.source.lastValid);
		if (identityDiagnostics.length) {
			patchStudio({ phase: 'error', diagnostics: identityDiagnostics });
			return;
		}
		const adapter = adapterRef.current;
		if (!adapter) {
			patchStudio({ phase: 'error', diagnostics: [getErrorDiagnostic(studioRef.current.revision, new Error('The Strudel runtime is not ready.'), 'audio', studioRef.current.draft)] });
			return;
		}

		cancelPendingTrackCommit();
		patchStudio({ phase: 'validating', diagnostics: [] });
		const stopped = await adapter.stop();
		if (!mountedRef.current || studioGenerationRef.current !== generation) return;
		if (!stopped.ok) {
			patchStudio({ phase: 'error', diagnostics: [getErrorDiagnostic(studioRef.current.revision, stopped.error, 'audio', studioRef.current.draft)] });
			return;
		}
		const evaluated = await adapter.evaluateSource(imported.project.source.lastValid, { autoplay: false, restoreSource: studioRef.current.lastValid });
		if (!mountedRef.current || studioGenerationRef.current !== generation) return;
		if (!evaluated.ok) {
			patchStudio({ phase: 'error', diagnostics: [getErrorDiagnostic(imported.project.source.revision, evaluated.error, 'evaluate', imported.project.source.lastValid)] });
			return;
		}

		let draftDiagnostics: SourceDiagnostic[] = [];
		if (imported.project.source.draft !== imported.project.source.lastValid) {
			const draftIdentityDiagnostics = getSourceIdentityDiagnostics(imported.project.source.revision, imported.project.source.draft);
			if (draftIdentityDiagnostics.length) {
				draftDiagnostics = draftIdentityDiagnostics;
			} else {
				try {
					const draftValidation = await adapter.validateSource(imported.project.source.draft, imported.project.source.lastValid);
					if (!draftValidation.ok) draftDiagnostics = [diagnosticFromError(imported.project.source.revision, draftValidation.error, imported.project.source.draft)];
				} catch (error) {
					draftDiagnostics = [diagnosticFromError(imported.project.source.revision, error, imported.project.source.draft)];
				}
			}
		}
		if (!mountedRef.current || studioGenerationRef.current !== generation) return;
		adapter.setSongEndCycle(imported.project.timeline.songEndCycle);
		sourceHistoryRef.current = { cursorSource: imported.project.source.draft, undo: [], redo: [] };
		sourceTransactionsRef.current.clear();
		bumpSourceHistory();
		patchStudio({
			projectName: imported.project.name,
			assets: imported.project.assets.map((asset) => ({ ...asset })),
			draft: imported.project.source.draft,
			lastValid: imported.project.source.lastValid,
			revision: imported.project.source.revision,
			activeRevision: imported.activeRevision,
			songEndCycle: imported.project.timeline.songEndCycle ?? DEFAULT_SONG_END_CYCLE,
			phase: draftDiagnostics.length ? 'error' : 'ready',
			diagnostics: draftDiagnostics,
			runtime: { ...studioRef.current.runtime, audioState: 'locked', transport: 'stopped', currentCycle: 0, activeRevision: imported.activeRevision },
		});
		await persistStudioSnapshot(imported, generation);
	}, [bumpSourceHistory, cancelPendingTrackCommit, patchStudio, persistStudioSnapshot]);

	const toggleTrackMode = useCallback(
		(trackId: string, mode: 'mute' | 'solo', active: boolean) => updateTrackSource(trackId, (source) => updateTrackMode(source, trackId, mode, active)),
		[updateTrackSource],
	);

	const selectTrack = useCallback((trackId: string) => {
		setSelectedTrackId(trackId);
		setContextMenu(null);
	}, []);

	const beginTrackRename = useCallback((trackId: string) => {
		const track = getSourceBlocks(studioRef.current.lastValid).find((block) => block.id === trackId);
		if (!track) return;
		setSelectedTrackId(trackId);
		setContextMenu(null);
		setRenamingTrackId(trackId);
		setRenamingTrackValue(track.name);
	}, []);

	const cancelTrackRename = useCallback(() => {
		setRenamingTrackId(null);
		setRenamingTrackValue('');
	}, []);

	const finishTrackRename = useCallback(
		async (trackId: string) => {
			const result = await renameTrack(trackId, renamingTrackValue);
			if (result.ok) cancelTrackRename();
		},
		[cancelTrackRename, renameTrack, renamingTrackValue],
	);

	const deleteSelectedTrack = useCallback(
		async (trackId: string) => {
			setContextMenu(null);
			cancelTrackRename();
			await deleteTrack(trackId);
		},
		[cancelTrackRename, deleteTrack],
	);

	const openTrackContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>, trackId: string) => {
		event.preventDefault();
		selectTrack(trackId);
		const menuWidth = 190;
		const menuHeight = 116;
		const maxX = Math.max(8, window.innerWidth - menuWidth - 8);
		const maxY = Math.max(8, window.innerHeight - menuHeight - 8);
		setContextMenu({ trackId, x: Math.min(Math.max(8, event.clientX), maxX), y: Math.min(Math.max(8, event.clientY), maxY) });
	}, [selectTrack]);

	const handleTrackLaneKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>, trackId: string) => {
			if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
			event.preventDefault();
			const rect = event.currentTarget.getBoundingClientRect();
			const menuWidth = 190;
			const menuHeight = 116;
			const maxX = Math.max(8, window.innerWidth - menuWidth - 8);
			const maxY = Math.max(8, window.innerHeight - menuHeight - 8);
			selectTrack(trackId);
			setContextMenu({ trackId, x: Math.min(Math.max(8, rect.left + 24), maxX), y: Math.min(Math.max(8, rect.top + 24), maxY) });
		},
		[selectTrack],
	);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!selectedTrackId || (event.key !== 'Backspace' && event.key !== 'Delete')) return;
			const target = event.target;
			if (target instanceof HTMLButtonElement || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
			if (target instanceof HTMLElement && target.isContentEditable) return;
			event.preventDefault();
			void deleteSelectedTrack(selectedTrackId);
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [deleteSelectedTrack, selectedTrackId]);

	useEffect(() => {
		if (!contextMenu) return undefined;
		const handlePointerDown = (event: PointerEvent) => {
			if (event.target instanceof Node && contextMenuRef.current?.contains(event.target)) return;
			setContextMenu(null);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setContextMenu(null);
		};
		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [contextMenu]);

	const dispatch = useCallback(
		async (command: StudioCommand): Promise<DispatchResult> => {
			if (command.type === 'writeSource') {
				cancelPendingTrackCommit();
				const result = await commitSource(command.source, { expectedRevision: command.expectedRevision });
				if (result.ok) return { ok: true };
				if (result.conflict) return { ok: false, error: new Error(`Source changed before this edit could be committed (expected revision ${result.conflict.expectedRevision}, current revision ${result.conflict.actualRevision}).`) };
				return { ok: false, error: result.error };
			}

			const adapter = adapterRef.current;
			if (!adapter || studioRef.current.phase === 'booting' || studioRef.current.phase === 'validating') return { ok: false, error: new Error('The Strudel runtime is not ready.') };

			if (command.type === 'play') {
				cancelPendingTrackCommit();
				const current = studioRef.current;
				const expectedRevision = current.revision;
				const draftHasNotBeenEvaluated = current.diagnostics.length === 0;
				if ((current.draft !== current.lastValid && draftHasNotBeenEvaluated) || current.activeRevision === null) {
					const committed = await commitSource(current.draft, { expectedRevision });
					if (!committed.ok) {
						// If another actor won the race and left a valid active source,
						// play that newer source. Never overwrite it with the stale draft.
						const latest = studioRef.current;
						if (!committed.conflict || latest.draft !== latest.lastValid || latest.activeRevision === null) return { ok: false, error: committed.error ?? new Error('The source changed before playback could start.') };
					}
				}

				// A commit can expand the project boundary when the new source adds an
				// explicit arrange/seqPLoop span. Read the ref after that async commit
				// instead of passing the stale pre-commit snapshot to the scheduler.
				const result = await adapter.play(studioRef.current.songEndCycle);
				if (result.ok) {
					const remainingDiagnostics = studioRef.current.diagnostics.filter((diagnostic) => diagnostic.phase !== 'audio');
					patchStudio({
						phase: remainingDiagnostics.length ? 'error' : 'ready',
						diagnostics: remainingDiagnostics,
						runtime: {
							...studioRef.current.runtime,
							transport: 'playing',
							audioState: 'ready',
							activeRevision: studioRef.current.activeRevision,
						},
					});
				} else {
					patchStudio({
						phase: 'error',
						diagnostics: [getErrorDiagnostic(studioRef.current.revision, result.error, 'audio', studioRef.current.draft)],
						runtime: { ...studioRef.current.runtime, audioState: isAudioLockedError(result.error) ? 'locked' : 'error', transport: 'stopped' },
					});
					return { ok: false, error: result.error };
				}
				return { ok: true };
			}

			if (command.type === 'pause') {
				const result = await adapter.pause();
				if (result.ok) {
					const remainingDiagnostics = studioRef.current.diagnostics.filter((diagnostic) => diagnostic.phase !== 'audio');
					patchStudio({
						phase: remainingDiagnostics.length ? 'error' : 'ready',
						diagnostics: remainingDiagnostics,
						runtime: { ...studioRef.current.runtime, transport: 'paused' },
					});
				} else {
					patchStudio({
						phase: 'error',
						diagnostics: [getErrorDiagnostic(studioRef.current.revision, result.error, 'audio', studioRef.current.draft)],
						runtime: { ...studioRef.current.runtime, audioState: isAudioLockedError(result.error) ? 'locked' : 'error' },
					});
					return { ok: false, error: result.error };
				}
				return { ok: true };
			}

			if (command.type === 'seek') {
				const targetCycle = clamp(command.cycle, 0, studioRef.current.songEndCycle);
				const result = await adapter.seek(targetCycle);
				if (result.ok) {
					patchStudio({ runtime: { ...studioRef.current.runtime, currentCycle: targetCycle } });
				} else {
					patchStudio({
						phase: 'error',
						diagnostics: [getErrorDiagnostic(studioRef.current.revision, result.error, 'audio', studioRef.current.draft)],
					});
					return { ok: false, error: result.error };
				}
				return { ok: true };
			}

				const result = await adapter.stop();
				if (result.ok) {
					const remainingDiagnostics = studioRef.current.diagnostics.filter((diagnostic) => diagnostic.phase !== 'audio');
					patchStudio({
						phase: remainingDiagnostics.length ? 'error' : 'ready',
						diagnostics: remainingDiagnostics,
						runtime: { ...studioRef.current.runtime, transport: 'stopped', currentCycle: 0 },
				});
			} else {
				patchStudio({
					phase: 'error',
						diagnostics: [getErrorDiagnostic(studioRef.current.revision, result.error, 'audio', studioRef.current.draft)],
						runtime: { ...studioRef.current.runtime, audioState: isAudioLockedError(result.error) ? 'locked' : 'error', transport: 'stopped' },
				});
				return { ok: false, error: result.error };
			}
			return { ok: true };
		},
		[cancelPendingTrackCommit, commitSource, patchStudio],
	);

	const getWebMcpState = useCallback((): WebMcpStateSnapshot => {
		const current = studioRef.current;
		const project = createInitialProject();
		const globals = getSourceGlobals(current.lastValid);
		const tracks = getSourceBlockDetails(current.lastValid).map((track, index) => ({
			id: track.id,
			number: index + 1,
			name: track.name,
			type: track.type,
			line: track.line,
			...(track.label === undefined ? {} : { label: track.label }),
			...(track.expression === undefined ? {} : { expression: track.expression }),
			timing: getTrackTimingForTimeline(track, current.songEndCycle),
			gain: { ...(track.gain === undefined ? {} : { value: track.gain }), editable: track.gainEditable },
			pan: { ...(track.pan === undefined ? {} : { value: track.pan }), editable: track.panEditable },
			muted: track.muted,
			soloed: track.soloed,
		}));
		return {
			project: { id: project.id, name: current.projectName },
			source: {
				draft: current.draft,
				lastValid: current.lastValid,
				revision: current.revision,
				activeRevision: current.activeRevision,
			},
			timeline: {
				bpm: globals.bpm,
				quarterNotesPerCycle: globals.quarterNotesPerCycle,
				key: globals.key,
				songEndCycle: current.songEndCycle,
			},
			tracks,
			diagnostics: current.diagnostics,
			runtime: current.runtime,
			phase: current.phase,
			persistenceState: current.persistenceState,
			webmcp: { available: webmcpAvailableRef.current },
		};
	}, []);

	const rememberMutation = useCallback((result: WebMcpMutationResult): WebMcpMutationResult => {
		if (result.transactionId) sourceTransactionsRef.current.set(result.action, result.transactionId, result);
		return result;
	}, []);

	const applySourceMutation = useCallback(
		async (action: string, input: SourceMutationInput): Promise<WebMcpMutationResult> => {
			const current = studioRef.current;
			if (input.baseRevision !== current.revision) {
				const state = getWebMcpState();
				return {
					ok: false,
					action,
					affectedEntityIds: sourceEntityIds(state),
					message: `Revision conflict: expected ${formatRevision(input.baseRevision)}, current is ${formatRevision(state.source.revision)}.`,
					state,
					revision: state.source.revision,
					activeRevision: state.source.activeRevision,
					transactionId: input.transactionId,
					error: { code: 'REVISION_CONFLICT', message: 'The source changed after this transaction was prepared.' },
					conflict: { expectedRevision: input.baseRevision, actualRevision: state.source.revision },
				};
			}

			const beforeSource = current.draft;
			let result: CommitSourceResult;
			try {
				result = await commitSource(input.source, { expectedRevision: input.baseRevision });
			} catch (error) {
				const state = getWebMcpState();
				return makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, false, 'The source transaction could not be completed.', { code: 'SOURCE_COMMIT_FAILED', message: error instanceof Error ? error.message : String(error) });
			}

			const state = getWebMcpState();
			if (result.conflict) {
				return {
					ok: false,
					action,
					affectedEntityIds: sourceEntityIds(state),
					message: `Revision conflict: expected ${formatRevision(result.conflict.expectedRevision)}, current is ${formatRevision(result.conflict.actualRevision)}.`,
					state,
					revision: state.source.revision,
					activeRevision: state.source.activeRevision,
					transactionId: input.transactionId,
					error: { code: 'REVISION_CONFLICT', message: 'The source changed while this transaction was waiting to commit.' },
					conflict: result.conflict,
				};
			}
			if (result.ok) {
				return makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, true, `Source accepted at ${formatRevision(state.source.revision)}.`);
			}

			const diagnostic = result.error;
			return makeMutationResult(
				state,
				action,
				input.transactionId,
				beforeSource,
				input.baseRevision,
				false,
				`Source draft updated, but Strudel rejected it; ${formatRevision(state.source.activeRevision)} remains active.`,
				{ code: 'VALIDATION_FAILED', message: diagnostic?.message ?? 'Strudel could not evaluate the source.', details: diagnostic ? { diagnostic } : undefined },
			);
		},
		[commitSource, getWebMcpState],
	);

	const sourceMutationForWebMcp = useCallback(
		(action: string, input: SourceMutationInput): Promise<WebMcpMutationResult> => sourceTransactionsRef.current.run(
			action,
			input.transactionId,
			() => applySourceMutation(action, input),
			stableSerialize(input),
		).catch((error) => {
			if (!(error instanceof TransactionReuseError)) throw error;
			const state = getWebMcpState();
			return makeMutationResult(state, action, input.transactionId, state.source.draft, state.source.revision, false, error.message, { code: 'TRANSACTION_REUSE', message: error.message });
		}),
		[applySourceMutation, getWebMcpState],
	);

	const timelineMutationForWebMcp = useCallback(
		async (
			action: string,
			input: WebMcpTempoInput | WebMcpKeyInput,
			mutate: () => Promise<CommitSourceResult>,
			successMessage: (state: WebMcpStateSnapshot) => string,
		): Promise<WebMcpMutationResult> => {
			const cached = sourceTransactionsRef.current.get(action, input.transactionId);
			if (cached) return cached;

			const current = studioRef.current;
			if (input.baseRevision !== current.revision) {
				const state = getWebMcpState();
				return {
					ok: false,
					action,
					affectedEntityIds: ['source'],
					message: `Revision conflict: expected ${formatRevision(input.baseRevision)}, current is ${formatRevision(state.source.revision)}.`,
					state,
					revision: state.source.revision,
					activeRevision: state.source.activeRevision,
					transactionId: input.transactionId,
					error: { code: 'REVISION_CONFLICT', message: 'The source changed after this transaction was prepared.' },
					conflict: { expectedRevision: input.baseRevision, actualRevision: state.source.revision },
				};
			}

			const beforeSource = current.draft;
			let result: CommitSourceResult;
			try {
				result = await mutate();
			} catch (error) {
				const state = getWebMcpState();
				return rememberMutation(makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, false, 'The timeline setting could not be changed.', { code: 'SOURCE_COMMIT_FAILED', message: error instanceof Error ? error.message : String(error) }));
			}

			const state = getWebMcpState();
			if (result.ok) return rememberMutation(makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, true, successMessage(state), undefined, ['source']));

			const diagnostic = result.error;
			return rememberMutation(makeMutationResult(
				state,
				action,
				input.transactionId,
				beforeSource,
				input.baseRevision,
				false,
				`Timeline setting was rejected; ${formatRevision(state.source.activeRevision)} remains active.`,
				{ code: 'VALIDATION_FAILED', message: diagnostic?.message ?? 'Strudel could not evaluate the timeline setting.', details: diagnostic ? { diagnostic } : undefined },
				['source'],
			));
		},
		[getWebMcpState, rememberMutation],
	);

	const setTempoForWebMcp = useCallback(
		(input: WebMcpTempoInput) => timelineMutationForWebMcp(
			'set_tempo',
			input,
			() => commitTempo(input.bpm),
			(state) => `Set tempo to ${formatCycle(state.timeline.bpm)} BPM at ${formatRevision(state.source.revision)}.`,
		),
		[commitTempo, timelineMutationForWebMcp],
	);

	const setKeyForWebMcp = useCallback(
		(input: WebMcpKeyInput) => timelineMutationForWebMcp(
			'set_key',
			input,
			() => commitKey(input.key),
			(state) => `Set key to ${JSON.stringify(state.timeline.key)} at ${formatRevision(state.source.revision)}.`,
		),
		[commitKey, timelineMutationForWebMcp],
	);

	const extendTimelineForWebMcp = useCallback(
		async (input: WebMcpTimelineExtensionInput): Promise<WebMcpMutationResult> => {
			const cached = sourceTransactionsRef.current.get('extend_timeline', input.transactionId);
			if (cached) return cached;
			const current = studioRef.current;
			if (input.baseRevision !== current.revision) {
				const state = getWebMcpState();
				return {
					ok: false,
					action: 'extend_timeline',
					affectedEntityIds: ['timeline'],
					message: `Revision conflict: expected ${formatRevision(input.baseRevision)}, current is ${formatRevision(state.source.revision)}.`,
					state,
					revision: state.source.revision,
					activeRevision: state.source.activeRevision,
					transactionId: input.transactionId,
					error: { code: 'REVISION_CONFLICT', message: 'The source changed after this transaction was prepared.' },
					conflict: { expectedRevision: input.baseRevision, actualRevision: state.source.revision },
				};
			}

			const nextSongEndCycle = getTimelineCapacityForEndCycle(current.songEndCycle + TIMELINE_SNAP_CYCLE);
			if (nextSongEndCycle > current.songEndCycle) {
				adapterRef.current?.setSongEndCycle(nextSongEndCycle);
				patchStudio({ songEndCycle: nextSongEndCycle });
				void persistStudioSnapshot();
			}
			const state = getWebMcpState();
			return rememberMutation(makeMutationResult(
				state,
				'extend_timeline',
				input.transactionId,
				current.draft,
				input.baseRevision,
				true,
				`Timeline is available through bar ${state.timeline.songEndCycle}.`,
				undefined,
				['timeline'],
			));
		},
		[getWebMcpState, patchStudio, persistStudioSnapshot, rememberMutation],
	);

	const trackMutationForWebMcp = useCallback(
		async (
			action: string,
			input: WebMcpTrackMutationInput,
			mutate: (trackId: string) => Promise<CommitSourceResult>,
			successMessage: (track: TrackDetails, state: WebMcpStateSnapshot) => string,
		): Promise<WebMcpMutationResult> => {
			const cached = sourceTransactionsRef.current.get(action, input.transactionId);
			if (cached) return cached;

			const current = studioRef.current;
			if (input.baseRevision !== current.revision) {
				const state = getWebMcpState();
				return {
					ok: false,
					action,
					affectedEntityIds: sourceEntityIds(state),
					message: `Revision conflict: expected ${formatRevision(input.baseRevision)}, current is ${formatRevision(state.source.revision)}.`,
					state,
					revision: state.source.revision,
					activeRevision: state.source.activeRevision,
					transactionId: input.transactionId,
					error: { code: 'REVISION_CONFLICT', message: 'The source changed after this transaction was prepared.' },
					conflict: { expectedRevision: input.baseRevision, actualRevision: state.source.revision },
				};
			}

			const mutationSource = sourceForTrackMutation(current);
			const resolved = resolveTrackTarget(mutationSource, input);
			if (!resolved.ok) {
				const state = getWebMcpState();
				return rememberMutation(makeMutationResult(state, action, input.transactionId, current.draft, current.revision, false, resolved.message, { code: resolved.code, message: resolved.message }));
			}

			const beforeSource = current.draft;
			let result: CommitSourceResult;
			try {
				result = await mutate(resolved.track.id);
			} catch (error) {
				const state = getWebMcpState();
				return rememberMutation(makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, false, 'The track transaction could not be completed.', { code: 'TRACK_COMMIT_FAILED', message: error instanceof Error ? error.message : String(error) }, ['source', resolved.track.id]));
			}

			const state = getWebMcpState();
			const affectedEntityIds = ['source', resolved.track.id];
			if (result.ok) {
				return rememberMutation(makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, true, successMessage(resolved.track, state), undefined, affectedEntityIds));
			}

			const diagnostic = result.error;
			return rememberMutation(makeMutationResult(
				state,
				action,
				input.transactionId,
				beforeSource,
				input.baseRevision,
				false,
				`Track change was rejected; ${formatRevision(state.source.activeRevision)} remains active.`,
				{ code: 'VALIDATION_FAILED', message: diagnostic?.message ?? 'Strudel could not evaluate the track change.', details: diagnostic ? { diagnostic } : undefined },
				affectedEntityIds,
			));
		},
		[getWebMcpState, rememberMutation],
	);

	const deleteTrackForWebMcp = useCallback(
		(input: WebMcpTrackMutationInput) => trackMutationForWebMcp(
			'delete_track',
			input,
			deleteTrack,
			(track, state) => `Deleted track ${JSON.stringify(track.name)} at ${formatRevision(state.source.revision)}.`,
		),
		[deleteTrack, trackMutationForWebMcp],
	);

	const renameTrackForWebMcp = useCallback(
		(input: WebMcpTrackRenameInput) => trackMutationForWebMcp(
			'rename_track',
			input,
			(trackId) => renameTrack(trackId, input.newName),
			(_track, state) => `Renamed track to ${JSON.stringify(input.newName.trim())} at ${formatRevision(state.source.revision)}.`,
		),
		[renameTrack, trackMutationForWebMcp],
	);

	const setTrackRangeForWebMcp = useCallback(
		(input: WebMcpTrackRangeInput) => trackMutationForWebMcp(
			'set_track_range',
			input,
			(trackId) => commitTrackRange(trackId, input.startCycle, input.endCycle),
			(track, state) => {
				const range = normalizeTrackRange(input.startCycle, input.endCycle, state.timeline.songEndCycle);
				return `Set ${JSON.stringify(track.name)} to cycles ${formatCycle(range.startCycle)}–${formatCycle(range.endCycle)} at ${formatRevision(state.source.revision)}.`;
			},
		),
		[commitTrackRange, trackMutationForWebMcp],
	);

	const patchSourceForWebMcp = useCallback(
		(input: SourcePatchInput): Promise<WebMcpMutationResult> => sourceTransactionsRef.current.run(
			'patch_strudel_source',
			input.transactionId,
			async () => {
				const current = studioRef.current;
				if (input.baseRevision !== current.revision) {
					return applySourceMutation('patch_strudel_source', { source: current.draft, baseRevision: input.baseRevision, transactionId: input.transactionId });
				}
				const applied = applyTextEdits(current.draft, input.edits);
				if (!applied.ok) {
					const state = getWebMcpState();
					return makeMutationResult(state, 'patch_strudel_source', input.transactionId, current.draft, current.revision, false, 'Patch rejected before validation; the source was not changed.', applied.error);
				}
				if (applied.source === current.draft) {
					const state = getWebMcpState();
					return makeMutationResult(state, 'patch_strudel_source', input.transactionId, current.draft, current.revision, true, 'No source changes were requested.');
				}
				return applySourceMutation('patch_strudel_source', { source: applied.source, baseRevision: input.baseRevision, transactionId: input.transactionId });
				},
				stableSerialize(input),
			).catch((error) => {
				if (!(error instanceof TransactionReuseError)) throw error;
				const state = getWebMcpState();
				return makeMutationResult(state, 'patch_strudel_source', input.transactionId, state.source.draft, state.source.revision, false, error.message, { code: 'TRANSACTION_REUSE', message: error.message });
			}),
		[applySourceMutation, getWebMcpState],
	);

	const validateSourceForWebMcp = useCallback(
		async (source?: string): Promise<WebMcpValidationResult> => {
			const candidate = source ?? studioRef.current.draft;
			const revision = studioRef.current.revision;
			const identityDiagnostics = getSourceIdentityDiagnostics(revision, candidate);
			if (identityDiagnostics.length) {
				const diagnostic = identityDiagnostics[0];
				return { ok: false, action: 'validate_strudel_source', source: candidate, diagnostics: identityDiagnostics, message: diagnostic.message, revision, state: getWebMcpState(), error: { code: 'VALIDATION_FAILED', message: diagnostic.message, details: { diagnostic } } };
			}
			const adapter = adapterRef.current;
			if (!adapter) {
				const diagnostic = diagnosticFromError(revision, new Error('The Strudel runtime is not ready.'), candidate);
				return { ok: false, action: 'validate_strudel_source', source: candidate, diagnostics: [diagnostic], message: diagnostic.message, revision, state: getWebMcpState(), error: { code: 'VALIDATION_UNAVAILABLE', message: diagnostic.message } };
			}

			try {
				const result = await adapter.validateSource(candidate, studioRef.current.lastValid);
				const state = getWebMcpState();
				const resultRevision = state.source.revision;
				const staleSuffix = resultRevision === revision
					? ''
					: ` (the studio advanced to ${formatRevision(resultRevision)} while validation was running)`;
				if (result.ok) return { ok: true, action: 'validate_strudel_source', source: candidate, diagnostics: [], message: `Strudel accepted the candidate source.${staleSuffix}`, revision: resultRevision, state };
				const diagnostic = diagnosticFromError(resultRevision, result.error, candidate);
				return { ok: false, action: 'validate_strudel_source', source: candidate, diagnostics: [diagnostic], message: diagnostic.message, revision: resultRevision, state, error: { code: 'VALIDATION_FAILED', message: diagnostic.message, details: { diagnostic } } };
			} catch (error) {
				const state = getWebMcpState();
				const diagnostic = diagnosticFromError(state.source.revision, error, candidate);
				return { ok: false, action: 'validate_strudel_source', source: candidate, diagnostics: [diagnostic], message: diagnostic.message, revision: state.source.revision, state, error: { code: 'VALIDATION_FAILED', message: diagnostic.message, details: { diagnostic } } };
			}
		},
		[getWebMcpState],
	);

	const controlPlaybackForWebMcp = useCallback(
		async (input: { action: WebMcpPlaybackAction; cycle?: number }): Promise<WebMcpPlaybackResult> => {
			const command: StudioCommand = input.action === 'seek'
				? { type: 'seek', cycle: input.cycle ?? 0 }
				: input.action === 'pause' ? { type: 'pause' } : input.action === 'stop' ? { type: 'stop' } : { type: 'play' };
			const result = await dispatch(command);
			const state = getWebMcpState();
			if (result.ok) {
				const message = input.action === 'seek' ? `Playhead moved to cycle ${formatCycle(state.runtime.currentCycle)}.` : `Playback ${input.action === 'resume' ? 'resumed' : input.action === 'stop' ? 'stopped' : 'played'}.`;
				return { ok: true, action: `control_playback:${input.action}`, affectedEntityIds: ['transport'], message, state, revision: state.source.revision, activeRevision: state.source.activeRevision };
			}
			const message = result.error instanceof Error ? result.error.message : String(result.error ?? 'Playback command failed.');
			return { ok: false, action: `control_playback:${input.action}`, affectedEntityIds: ['transport'], message, state, revision: state.source.revision, activeRevision: state.source.activeRevision, error: { code: isAudioLockedError(result.error) ? 'AUDIO_LOCKED' : 'PLAYBACK_FAILED', message } };
		},
		[dispatch, getWebMcpState],
	);

	const undoSourceForWebMcp = useCallback(
		(input: Omit<SourceMutationInput, 'source'>): Promise<WebMcpMutationResult> => sourceTransactionsRef.current.run(
			'undo_source_edit',
			input.transactionId,
			async () => {
				const current = studioRef.current;
				if (input.baseRevision !== current.revision) {
					const state = getWebMcpState();
					return { ok: false, action: 'undo_source_edit', affectedEntityIds: sourceEntityIds(state), message: `Revision conflict: expected ${formatRevision(input.baseRevision)}, current is ${formatRevision(state.source.revision)}.`, state, revision: state.source.revision, activeRevision: state.source.activeRevision, transactionId: input.transactionId, error: { code: 'REVISION_CONFLICT', message: 'The source changed after this transaction was prepared.' }, conflict: { expectedRevision: input.baseRevision, actualRevision: state.source.revision } };
				}
				const entry = sourceHistoryRef.current.undo[sourceHistoryRef.current.undo.length - 1];
				if (!entry) {
					const state = getWebMcpState();
					return makeMutationResult(state, 'undo_source_edit', input.transactionId, current.draft, current.revision, false, 'There is no source edit to undo.', { code: 'NO_UNDO', message: 'The shared source history is already at its oldest revision.' });
				}
				const result = await commitSource(entry.before, { recordHistory: false, expectedRevision: input.baseRevision });
				if (!result.ok) {
					const state = getWebMcpState();
					if (result.conflict) {
						return { ok: false, action: 'undo_source_edit', affectedEntityIds: sourceEntityIds(state), message: `Revision conflict: expected ${formatRevision(result.conflict.expectedRevision)}, current is ${formatRevision(result.conflict.actualRevision)}.`, state, revision: state.source.revision, activeRevision: state.source.activeRevision, transactionId: input.transactionId, error: { code: 'REVISION_CONFLICT', message: 'The source changed while this transaction was waiting to commit.' }, conflict: result.conflict };
					}
					return makeMutationResult(state, 'undo_source_edit', input.transactionId, current.draft, input.baseRevision, false, 'Undo could not be validated by Strudel.', { code: 'VALIDATION_FAILED', message: result.error?.message ?? 'Undo source was rejected.' });
				}
				sourceHistoryRef.current.undo.pop();
				sourceHistoryRef.current.redo.push(entry);
				if (sourceHistoryRef.current.redo.length > SOURCE_HISTORY_LIMIT) sourceHistoryRef.current.redo.shift();
				bumpSourceHistory();
				const state = getWebMcpState();
				return makeMutationResult(state, 'undo_source_edit', input.transactionId, current.draft, input.baseRevision, true, `Undid source edit; now at ${formatRevision(state.source.revision)}.`);
			},
			stableSerialize(input),
			).catch((error) => {
				if (!(error instanceof TransactionReuseError)) throw error;
				const state = getWebMcpState();
				return makeMutationResult(state, 'undo_source_edit', input.transactionId, state.source.draft, state.source.revision, false, error.message, { code: 'TRANSACTION_REUSE', message: error.message });
			}),
		[bumpSourceHistory, commitSource, getWebMcpState],
	);

	const redoSourceForWebMcp = useCallback(
		(input: Omit<SourceMutationInput, 'source'>): Promise<WebMcpMutationResult> => sourceTransactionsRef.current.run(
			'redo_source_edit',
			input.transactionId,
			async () => {
				const current = studioRef.current;
				if (input.baseRevision !== current.revision) {
					const state = getWebMcpState();
					return { ok: false, action: 'redo_source_edit', affectedEntityIds: sourceEntityIds(state), message: `Revision conflict: expected ${formatRevision(input.baseRevision)}, current is ${formatRevision(state.source.revision)}.`, state, revision: state.source.revision, activeRevision: state.source.activeRevision, transactionId: input.transactionId, error: { code: 'REVISION_CONFLICT', message: 'The source changed after this transaction was prepared.' }, conflict: { expectedRevision: input.baseRevision, actualRevision: state.source.revision } };
				}
				const entry = sourceHistoryRef.current.redo[sourceHistoryRef.current.redo.length - 1];
				if (!entry) {
					const state = getWebMcpState();
					return makeMutationResult(state, 'redo_source_edit', input.transactionId, current.draft, current.revision, false, 'There is no source edit to redo.', { code: 'NO_REDO', message: 'The shared source history is already at its newest revision.' });
				}
				const result = await commitSource(entry.after, { recordHistory: false, expectedRevision: input.baseRevision });
				if (!result.ok) {
					const state = getWebMcpState();
					if (result.conflict) {
						return { ok: false, action: 'redo_source_edit', affectedEntityIds: sourceEntityIds(state), message: `Revision conflict: expected ${formatRevision(result.conflict.expectedRevision)}, current is ${formatRevision(result.conflict.actualRevision)}.`, state, revision: state.source.revision, activeRevision: state.source.activeRevision, transactionId: input.transactionId, error: { code: 'REVISION_CONFLICT', message: 'The source changed while this transaction was waiting to commit.' }, conflict: result.conflict };
					}
					return makeMutationResult(state, 'redo_source_edit', input.transactionId, current.draft, input.baseRevision, false, 'Redo could not be validated by Strudel.', { code: 'VALIDATION_FAILED', message: result.error?.message ?? 'Redo source was rejected.' });
				}
				sourceHistoryRef.current.redo.pop();
				sourceHistoryRef.current.undo.push(entry);
				if (sourceHistoryRef.current.undo.length > SOURCE_HISTORY_LIMIT) sourceHistoryRef.current.undo.shift();
				bumpSourceHistory();
				const state = getWebMcpState();
				return makeMutationResult(state, 'redo_source_edit', input.transactionId, current.draft, input.baseRevision, true, `Redid source edit; now at ${formatRevision(state.source.revision)}.`);
			},
			stableSerialize(input),
			).catch((error) => {
				if (!(error instanceof TransactionReuseError)) throw error;
				const state = getWebMcpState();
				return makeMutationResult(state, 'redo_source_edit', input.transactionId, state.source.draft, state.source.revision, false, error.message, { code: 'TRANSACTION_REUSE', message: error.message });
			}),
		[bumpSourceHistory, commitSource, getWebMcpState],
	);

	const webmcpController = useMemo<WebMcpController>(() => ({
		getState: getWebMcpState,
		writeSource: (input) => sourceMutationForWebMcp('write_strudel_source', input),
		patchSource: patchSourceForWebMcp,
		setTempo: setTempoForWebMcp,
		setKey: setKeyForWebMcp,
		deleteTrack: deleteTrackForWebMcp,
		renameTrack: renameTrackForWebMcp,
		setTrackRange: setTrackRangeForWebMcp,
		extendTimeline: extendTimelineForWebMcp,
		validateSource: validateSourceForWebMcp,
		controlPlayback: controlPlaybackForWebMcp,
		undoSourceEdit: undoSourceForWebMcp,
		redoSourceEdit: redoSourceForWebMcp,
	}), [controlPlaybackForWebMcp, deleteTrackForWebMcp, extendTimelineForWebMcp, getWebMcpState, patchSourceForWebMcp, redoSourceForWebMcp, renameTrackForWebMcp, setKeyForWebMcp, setTempoForWebMcp, setTrackRangeForWebMcp, sourceMutationForWebMcp, undoSourceForWebMcp, validateSourceForWebMcp]);

	useEffect(() => {
		let disposed = false;
		let registration: WebMcpRegistration | null = null;
		const waitController = new AbortController();
		void waitForNativeModelContext({ signal: waitController.signal }).then((context) => {
			if (!context || disposed) return null;
			return registerWebMcpTools(webmcpController, context, { signal: waitController.signal });
		}).then((nextRegistration) => {
			if (!nextRegistration) return;
			if (disposed) {
				nextRegistration.dispose();
				return;
			}
			registration = nextRegistration;
			webmcpRegistrationRef.current = nextRegistration;
			webmcpAvailableRef.current = nextRegistration.available;
		}).catch(() => {
			// Host integration is optional. A late or malformed host must not create
			// an unhandled rejection that takes down the studio page.
			if (!disposed) webmcpAvailableRef.current = false;
		});
		return () => {
			disposed = true;
			waitController.abort();
			// The local registration and the ref point at the same object once
			// discovery completes. Dispose through one path so a host bridge with a
			// non-idempotent teardown callback is never invoked twice.
			(registration ?? webmcpRegistrationRef.current)?.dispose();
			webmcpRegistrationRef.current = null;
			webmcpAvailableRef.current = false;
		};
	}, [webmcpController]);

	const seekTimelineAtClientX = useCallback(
		(clientX: number, ruler: HTMLElement) => {
			const rect = ruler.getBoundingClientRect();
			if (!rect.width) return;
			const songEndCycle = studioRef.current.songEndCycle;
			const cycle = clamp(snapCycle(((clientX - rect.left) / rect.width) * songEndCycle), 0, songEndCycle);
			if (timelineSeekCycleRef.current === cycle) return;
			timelineSeekCycleRef.current = cycle;
			void dispatch({ type: 'seek', cycle });
		},
		[dispatch],
	);

	const handleTimelineSeekPointerMove = useCallback(
		(event: PointerEvent) => {
			const ruler = timelineSeekDragRef.current;
			if (ruler) seekTimelineAtClientX(event.clientX, ruler);
		},
		[seekTimelineAtClientX],
	);

	const stopTimelineSeekDrag = useCallback(() => {
		timelineSeekDragRef.current = null;
		timelineSeekCycleRef.current = null;
		window.removeEventListener('pointermove', handleTimelineSeekPointerMove);
		window.removeEventListener('pointerup', stopTimelineSeekDrag);
		window.removeEventListener('pointercancel', stopTimelineSeekDrag);
	}, [handleTimelineSeekPointerMove]);

	const startTimelineSeekDrag = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			if (event.button !== 0) return;
			const ruler = event.currentTarget.closest('.timeline-ruler');
			if (!(ruler instanceof HTMLElement)) return;
			event.preventDefault();
			timelineSeekDragRef.current = ruler;
			timelineSeekCycleRef.current = null;
			seekTimelineAtClientX(event.clientX, ruler);
			window.addEventListener('pointermove', handleTimelineSeekPointerMove);
			window.addEventListener('pointerup', stopTimelineSeekDrag);
			window.addEventListener('pointercancel', stopTimelineSeekDrag);
		},
		[handleTimelineSeekPointerMove, seekTimelineAtClientX, stopTimelineSeekDrag],
	);

	const handleTimelineSeekKeyDown = useCallback(
			(event: ReactKeyboardEvent<HTMLButtonElement>) => {
				const currentCycle = clamp(studioRef.current.runtime.currentCycle, 0, studioRef.current.songEndCycle);
				const cycleStep = getSourceCycleStep(studioRef.current.lastValid);
				let nextCycle: number | null = null;
				switch (event.key) {
					case 'ArrowLeft':
						nextCycle = currentCycle - cycleStep;
						break;
					case 'ArrowRight':
						nextCycle = currentCycle + cycleStep;
					break;
				case 'PageUp':
					nextCycle = currentCycle - 1;
					break;
				case 'PageDown':
					nextCycle = currentCycle + 1;
					break;
				case 'Home':
					nextCycle = 0;
					break;
				case 'End':
					nextCycle = studioRef.current.songEndCycle;
					break;
				default:
					return;
			}
			event.preventDefault();
			void dispatch({ type: 'seek', cycle: clamp(nextCycle, 0, studioRef.current.songEndCycle) });
		},
		[dispatch],
	);

	useEffect(() => stopTimelineSeekDrag, [stopTimelineSeekDrag]);

	const blocks = useMemo(() => getSourceBlocks(studio.lastValid), [studio.lastValid]);
	const draftBlocks = useMemo(() => getSourceBlocks(studio.draft), [studio.draft]);
	const draftTrackDetails = useMemo(() => new Map(getSourceBlockDetails(studio.draft).map((block) => [block.id, block])), [studio.draft]);
	const validTrackDetails = useMemo(() => new Map(getSourceBlockDetails(studio.lastValid).map((block) => [block.id, block])), [studio.lastValid]);
	const contextMenuTrack = useMemo(() => blocks.find((block) => block.id === contextMenu?.trackId), [blocks, contextMenu?.trackId]);
	const sourceGlobals = useMemo(() => getSourceGlobals(studio.lastValid), [studio.lastValid]);
	const draftGlobals = useMemo(() => getSourceGlobals(studio.draft), [studio.draft]);
	const isDirty = studio.draft !== studio.lastValid;
	const isBusy = studio.phase === 'booting' || studio.phase === 'validating';
	const canPlay = !isBusy && studio.runtime.audioState !== 'initializing';
	const draftLines = useMemo(() => getSourceLineNumbers(studio.draft), [studio.draft]);
	const activeLaneCount = blocks.length.toString().padStart(2, '0');
	const currentSeconds = cyclesToSeconds(studio.runtime.currentCycle, sourceGlobals);
	const songEndSeconds = cyclesToSeconds(studio.songEndCycle, sourceGlobals);
	const cycleStep = getSourceCycleStep(studio.lastValid);
	const saveStateLabel = studio.persistenceState === 'loading' ? 'LOADING' : studio.persistenceState === 'unavailable' ? 'LOCAL ONLY' : isDirty ? 'DRAFT' : 'SAVED';
	const highlightedSource = useMemo(() => highlightStrudel(studio.draft), [studio.draft]);
	const timelineCellCount = Math.max(1, Math.ceil(studio.songEndCycle / TIMELINE_SNAP_CYCLE));
	const timelineSongCycles = Math.max(TIMELINE_SNAP_CYCLE, studio.songEndCycle);
	const zoomOutCycles = timelineSongCycles;
	const nextTimelineEndCycle = getTimelineCapacityForEndCycle(studio.songEndCycle + TIMELINE_SNAP_CYCLE);
	const timelineExtensionCycles = Math.max(0, nextTimelineEndCycle - studio.songEndCycle);
	const timelineVisibleCycles = zoomOutCycles - (zoomOutCycles - 1) * (timelineZoom / 100);
	const timelineAvailableWidth = Math.max(560, (timelineViewportWidth || 960) - TIMELINE_LABEL_MIN_WIDTH);
	const timelineGridWidth = Math.max(560, timelineAvailableWidth * timelineSongCycles / timelineVisibleCycles * arrangementZoom);
	const timelineBarLabelStride = timelineLabelStride(timelineGridWidth / timelineSongCycles);
	const timelineCells = useMemo(() => Array.from({ length: timelineCellCount }, (_, index) => {
		const isBarStart = index % 4 === 0;
		const barNumber = Math.floor(index / 4) + 1;
		const showLabel = isBarStart && (barNumber === 1 || barNumber % timelineBarLabelStride === 0);
		return {
			isBarStart,
			label: showLabel ? barNumber.toString() : '',
		};
	}), [timelineBarLabelStride, timelineCellCount]);
	const timelineGridStyle = {
		'--timeline-grid-width': `${timelineGridWidth}px`,
		'--timeline-cell-count': timelineCellCount,
	} as CSSProperties;

	useEffect(() => {
		if (selectedTrackId && !blocks.some((block) => block.id === selectedTrackId)) setSelectedTrackId(null);
		if (contextMenu && !blocks.some((block) => block.id === contextMenu.trackId)) setContextMenu(null);
		if (renamingTrackId && !blocks.some((block) => block.id === renamingTrackId)) cancelTrackRename();
	}, [blocks, cancelTrackRename, contextMenu, renamingTrackId, selectedTrackId]);

	useEffect(() => {
		syncEditorScroll();
	}, [studio.draft, syncEditorScroll]);

	return (
		<div className="studio-shell">
			<header className="studio-topbar">
				<div className="topbar-brand-group">
					<a className="wordmark" href="/" aria-label="Sushi home">
						<span className="wordmark-mark" aria-hidden="true">◒</span> sushi
					</a>
				</div>
				<div className="topbar-session">
					<div className="session-name-row">
						<label className="sr-only" htmlFor="project-name">Project name</label>
						<input id="project-name" className="project-name-input" value={studio.projectName ?? 'First light'} onChange={(event) => patchStudio({ projectName: event.target.value })} onBlur={() => { void persistStudioSnapshot(); }} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-label="Project name" title="Rename project" />
						<span className={`save-state ${isDirty || studio.persistenceState === 'loading' ? 'save-state-dirty' : ''}`} title={studio.persistenceState === 'unavailable' ? 'IndexedDB is unavailable; this session will not persist after reload.' : 'Project state is saved locally'}><span className="save-dot" aria-hidden="true" />{saveStateLabel}</span>
					</div>
					<div className="topbar-transport" aria-label="Transport controls">
						<div className="topbar-global-controls" aria-label="Tempo and key controls">
							<label className="topbar-key-control">
								<span className="topbar-control-label">KEY</span>
								<select value={draftGlobals.key} onChange={(event) => setKey(event.target.value)} disabled={isBusy} aria-label="Musical key" title="Set musical key">
									{!KEY_OPTIONS.includes(draftGlobals.key) ? <option value={draftGlobals.key}>{formatKey(draftGlobals.key)}</option> : null}
									{KEY_OPTIONS.map((key) => <option value={key} key={key}>{formatKey(key)}</option>)}
								</select>
							</label>
								<label className="topbar-bpm-control">
									<span className="topbar-control-label">BPM</span>
									<input type="range" min="0" max="300" step="1" value={clamp(Math.round(draftGlobals.bpm), 0, 300)} onChange={(event) => setTempo(Number(event.target.value))} disabled={isBusy} aria-label="Tempo in beats per minute" title="Set tempo from 0 to 300 BPM" />
									<output>{Math.round(clamp(draftGlobals.bpm, 0, 300))}</output>
								</label>
								<label className="topbar-quarter-control">
									<span className="topbar-control-label">Q/C</span>
									<input type="number" min="1" max="32" step="1" value={formatCycle(draftGlobals.quarterNotesPerCycle)} onChange={(event) => setQuarterNotesPerCycle(Number(event.target.value))} disabled={isBusy} aria-label="Quarter notes per Strudel cycle" title="Set quarter notes per cycle" />
								</label>
							</div>
						<div className="topbar-source-actions" aria-label="Source actions">
						<button className="transport-button source-action-button source-action-revert" type="button" onClick={() => { cancelPendingTrackCommit(); sourceHistoryRef.current.cursorSource = studioRef.current.lastValid; patchStudio({ draft: studioRef.current.lastValid, diagnostics: [], phase: 'ready' }); void persistStudioSnapshot(); }} disabled={!isDirty || isBusy} aria-label="Revert source draft" title="Revert source draft">
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7H5v4" /><path d="M5.2 11A7.5 7.5 0 1 0 7.4 5.6L5 7" /></svg>
							</button>
							<button className="transport-button source-action-button source-action-commit" type="button" onClick={() => void dispatch({ type: 'writeSource', source: studioRef.current.draft, expectedRevision: studio.revision })} disabled={!isDirty || isBusy} aria-label="Commit source" title="Commit source">
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
							</button>
							<button className="transport-button source-action-button" type="button" onClick={() => void undoSourceEdit()} disabled={isBusy || isDirty || sourceHistoryRef.current.undo.length === 0} aria-label="Undo source edit" title="Undo source edit">
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 8 4 12l5 4" /><path d="M4 12h8a6 6 0 0 1 6 6" /></svg>
							</button>
							<button className="transport-button source-action-button" type="button" onClick={() => void redoSourceEdit()} disabled={isBusy || isDirty || sourceHistoryRef.current.redo.length === 0} aria-label="Redo source edit" title="Redo source edit">
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 8 5 4-5 4" /><path d="M20 12h-8a6 6 0 0 0-6 6" /></svg>
							</button>
							<button className="transport-button source-action-button" type="button" onClick={exportProject} disabled={isBusy} aria-label="Export Sushi project" title="Export project">
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11" /><path d="m8 8 4-4 4 4" /><path d="M5 14v5h14v-5" /></svg>
							</button>
							<button className="transport-button source-action-button" type="button" onClick={() => projectImportInputRef.current?.click()} disabled={isBusy} aria-label="Import Sushi project" title="Import project">
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V9" /><path d="m8 16 4 4 4-4" /><path d="M5 10V5h14v5" /></svg>
							</button>
							<input ref={projectImportInputRef} className="project-import-input" type="file" accept="application/json,.json" onChange={importProject} aria-label="Import Sushi project file" />
						</div>
						<span className="topbar-action-divider" aria-hidden="true" />
						<button className="transport-button transport-stop" type="button" onClick={() => void dispatch({ type: 'stop' })} disabled={!canPlay || (studio.runtime.transport === 'stopped' && studio.runtime.currentCycle === 0)} aria-label="Stop playback" title="Stop and return to cycle zero">■</button>
						<button className="transport-button transport-play" type="button" onClick={() => void dispatch({ type: 'play' })} disabled={!canPlay} aria-label={studio.runtime.transport === 'paused' ? 'Resume playback' : 'Play accepted source'} title={studio.runtime.transport === 'paused' ? 'Resume playback' : 'Play accepted source'}>▶</button>
						<button className="transport-button transport-pause" type="button" onClick={() => void dispatch({ type: 'pause' })} disabled={!canPlay || studio.runtime.transport !== 'playing'} aria-label="Pause playback" title="Pause at the current cycle">Ⅱ</button>
						<span className="transport-clock" aria-live="polite">{formatClock(currentSeconds)}</span>
						<span className="transport-cycle" aria-live="polite">CYCLE {formatCycle(studio.runtime.currentCycle)}</span>
						<span className="transport-divider" aria-hidden="true" />
						<span className="transport-readout">{studio.runtime.audioState === 'initializing' ? 'PREPARING' : studio.runtime.transport.toUpperCase()}</span>
					</div>
				</div>
				<div className="topbar-right">
					<div className="topbar-metrics" aria-label="Project settings"><span>{formatCycle(sourceGlobals.quarterNotesPerCycle)} Q/C</span><span>{formatCycle(songEndSeconds)}s</span></div>
				</div>
			</header>

			<div className="studio-body" style={{ '--editor-width': `${editorWidth}px` } as CSSProperties}>
				<aside className="source-sidebar" aria-label="Strudel source editor">
					<div className="source-editor-shell">
						<div className="editor-gutter" ref={editorGutterRef} aria-hidden="true">{draftLines.map((line) => <span key={line}>{line.toString().padStart(2, '0')}</span>)}</div>
						<div className="editor-code-layer">
							<pre ref={sourceHighlightRef} className="source-highlight" aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlightedSource }} />
							<label className="sr-only" htmlFor="source-editor">Strudel source draft</label>
							<textarea
								id="source-editor"
								ref={sourceEditorRef}
								className="source-editor"
								value={studio.draft}
							onChange={(event) => {
									const nextDraft = event.target.value;
									patchStudio({
										draft: nextDraft,
										...(studioRef.current.diagnostics.length ? { diagnostics: [], phase: 'ready' as const } : {}),
									});
								}}
								onScroll={syncEditorScroll}
								onKeyDown={(event) => {
									if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
										event.preventDefault();
										void dispatch({ type: 'writeSource', source: studioRef.current.draft, expectedRevision: studioRef.current.revision });
									}
								}}
								spellCheck={false}
								autoCapitalize="off"
								wrap="off"
								aria-describedby="source-help"
							/>
						</div>
					</div>
					<p className="editor-help" id="source-help">Cmd/Ctrl + Enter to validate <span aria-hidden="true">·</span> {draftBlocks.length} marked {draftBlocks.length === 1 ? 'block' : 'blocks'}</p>
					{studio.diagnostics.length ? <div className="sidebar-diagnostic" role="status" aria-live="polite"><span className="error-mark" aria-hidden="true">!</span><span>{getDiagnosticLabel(studio.diagnostics[0])}</span><span className="sidebar-diagnostic-revision">{getDiagnosticLocation(studio.diagnostics[0]) || `REV ${formatRevision(studio.diagnostics[0].revision)}`}</span></div> : null}
			</aside>
			<div className="editor-resize-divider">
				<button
					className="editor-resize-handle"
					type="button"
					onPointerDown={startEditorResize}
					onKeyDown={handleEditorResizeKeyDown}
					aria-label="Resize source editor"
					aria-orientation="vertical"
					aria-valuemin={EDITOR_WIDTH_MIN}
					aria-valuemax={EDITOR_WIDTH_MAX}
					aria-valuenow={editorWidth}
					title="Drag to resize source editor"
				/>
			</div>

				<main className="daw-canvas" aria-label="Sushi workstation">
					<section className="timeline-shell" ref={(element) => { timelineViewportRef.current = element; timelineShellRef.current = element; }} aria-labelledby="timeline-heading">
						<div className="timeline-head" style={timelineGridStyle}>
							<div className="timeline-heading-cell">
								<div className="arrangement-toolbar">
									<button className="add-track-button" type="button" onClick={() => void addTrack()} disabled={isBusy} aria-label="Add track"><span aria-hidden="true">＋</span> Add track</button>
									{timelineExtensionCycles > 0 ? <button className="extend-timeline-button" type="button" onClick={extendTimeline} disabled={isBusy} aria-label={`Extend timeline by ${formatCycle(timelineExtensionCycles)} bars`} title={`Extend the timeline by ${formatCycle(timelineExtensionCycles)} bars`}>EXTEND +{formatCycle(timelineExtensionCycles)}</button> : null}
									<div className="timeline-zoom-controls" role="group" aria-label="Arrangement zoom">
										<button className="timeline-zoom-button" type="button" onClick={() => adjustArrangementZoom(-TIMELINE_ZOOM_STEP)} disabled={arrangementZoom <= MIN_TIMELINE_ZOOM} aria-label="Zoom out arrangement" title="Zoom out arrangement">−</button>
										<output className="timeline-zoom-value" aria-live="polite">{Math.round(arrangementZoom * 100)}%</output>
										<button className="timeline-zoom-button" type="button" onClick={() => adjustArrangementZoom(TIMELINE_ZOOM_STEP)} disabled={arrangementZoom >= MAX_TIMELINE_ZOOM} aria-label="Zoom in arrangement" title="Zoom in arrangement">＋</button>
									</div>
								</div>
								<div className="timeline-duration">
									<label className="timeline-length-control">
										<span className="sr-only">Arrangement length in cycles</span>
										<input type="number" min={cycleStep} step={cycleStep} value={formatCycle(studio.songEndCycle)} onChange={(event) => setSongEndCycle(Number(event.target.value))} aria-label="Arrangement length in cycles" title="Set arrangement length in cycles" />
										<span>cycles</span>
									</label>
									<span aria-hidden="true">·</span>
									<span>{formatCycle(songEndSeconds)}s</span>
								</div>
								<span className="sr-only" id="timeline-heading">{activeLaneCount} source lanes</span>
							</div>
							<div className="timeline-ruler" style={{ '--timeline-cell-count': timelineCellCount } as CSSProperties} aria-label="Arrangement beats">
								{timelineCells.map((cell, index) => <span className={cell.isBarStart ? 'bar-number' : ''} key={index}>{cell.label}</span>)}
								<button className="timeline-seek-surface" type="button" onPointerDown={startTimelineSeekDrag} onKeyDown={handleTimelineSeekKeyDown} disabled={isBusy} aria-label={`Seek playhead, cycle ${formatCycle(studio.runtime.currentCycle)}, ${formatClock(currentSeconds)}`} title="Click or drag to seek" />
								<i className="timeline-playhead" style={{ '--playhead-position': clamp(studio.runtime.currentCycle / studio.songEndCycle, 0, 1) } as CSSProperties} aria-hidden="true" />
							</div>
						</div>
						{blocks.map((block, index) => {
							const trackColor = getTrackColor(index);
							const trackDetails = draftTrackDetails.get(block.id) ?? validTrackDetails.get(block.id);
							const gain = trackDetails?.gain ?? 1;
							const pan = trackDetails?.pan ?? 0.5;
							const timing = getTrackTimingForTimeline(trackDetails, studio.songEndCycle);
							const clipStart = clamp(timing.startCycle / studio.songEndCycle, 0, 1);
							const clipEnd = clamp(timing.endCycle / studio.songEndCycle, clipStart + 0.01, 1);
							const timingLabel = `${formatCycle(timing.startCycle)}–${formatCycle(timing.endCycle)} cycles · ${formatCycle(cyclesToSeconds(timing.endCycle - timing.startCycle, sourceGlobals))}s`;
							return (
								<div
									className={`track-lane ${selectedTrackId === block.id ? 'track-lane-selected' : ''}`}
									style={timelineGridStyle}
									key={block.id}
									tabIndex={0}
									onClick={() => selectTrack(block.id)}
									onFocus={() => setSelectedTrackId(block.id)}
									onContextMenu={(event) => openTrackContextMenu(event, block.id)}
									onKeyDown={(event) => handleTrackLaneKeyDown(event, block.id)}
									aria-current={selectedTrackId === block.id ? 'true' : undefined}
									aria-label={`Track ${(index + 1).toString()}: ${block.name}`}
								>
									<div className="track-header" style={{ '--track-color': trackColor } as CSSProperties}>
										<div className="track-header-top">
											<span className="track-instrument-icon" aria-hidden="true">♩</span>
											<div className="track-title-wrap">
												<div className="track-name-line">
													<span className="track-number">{(index + 1).toString().padStart(2, '0')}</span>
													{renamingTrackId === block.id ? (
														<input
															className="track-name-input"
															type="text"
															value={renamingTrackValue}
															maxLength={TRACK_NAME_MAX_LENGTH}
															autoFocus
															onChange={(event) => setRenamingTrackValue(event.target.value)}
															onClick={(event) => event.stopPropagation()}
															onKeyDown={(event) => {
																if (event.key === 'Enter') {
																	event.preventDefault();
																	event.stopPropagation();
																	void finishTrackRename(block.id);
																} else if (event.key === 'Escape') {
																	event.preventDefault();
																	event.stopPropagation();
																	cancelTrackRename();
																}
																}}
																aria-label={`Rename ${block.name}`}
														/>
													) : (
														<span className="track-name-edit">
															<strong>{block.name}</strong>
															<button className="track-rename-button" type="button" onClick={(event) => { event.stopPropagation(); beginTrackRename(block.id); }} aria-label={`Rename ${block.name}`} title={`Rename ${block.name}`}>
																<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5 4 4M5 19l3.8-.8L19.2 7.8a1.7 1.7 0 0 0-2.4-2.4L6.4 15.8 5 19Z" /></svg>
															</button>
														</span>
													)}
												</div>
												<span className="track-type">{getTrackLabel(block.type)} <span aria-hidden="true">·</span> LINE {block.line}</span>
											</div>
											<div className="track-mode-controls" role="group" aria-label={`${block.name} source modes`}>
												<button className={`track-mode-button ${trackDetails?.muted ? 'track-mode-button-active' : ''}`} type="button" onClick={() => toggleTrackMode(block.id, 'mute', !trackDetails?.muted)} disabled={!trackDetails} aria-label={`Mute ${block.name}`} aria-pressed={trackDetails?.muted ?? false}>M</button>
												<button className={`track-mode-button ${trackDetails?.soloed ? 'track-mode-button-active' : ''}`} type="button" onClick={() => toggleTrackMode(block.id, 'solo', !trackDetails?.soloed)} disabled={!trackDetails} aria-label={`Solo ${block.name}`} aria-pressed={trackDetails?.soloed ?? false}>S</button>
											</div>
										</div>
											<div className="track-mix-controls">
											<label className="track-volume">
												<span className="sr-only">{block.name} gain</span>
												<input className="track-volume-control" type="range" min="0" max="1" step="0.01" value={gain} onChange={(event) => setTrackGain(block.id, Number(event.target.value))} disabled={!trackDetails?.gainEditable} aria-label={`${block.name} gain`} />
											</label>
												<div className="track-pan">
													<span aria-hidden="true">L</span>
													<span className="track-pan-control-wrap">
														<input className="track-pan-control" type="range" min="0" max="100" step="1" value={Math.round(clamp(pan, 0, 1) * 100)} onChange={(event) => setTrackPan(block.id, Number(event.target.value) / 100)} disabled={!trackDetails?.panEditable} aria-label={`${block.name} pan`} />
														<span className="track-pan-center" aria-hidden="true" />
													</span>
													<span aria-hidden="true">R</span>
													<output className="track-pan-value" aria-label={`${block.name} pan value`}>{Math.round(clamp(pan, 0, 1) * 100)}</output>
												</div>
										</div>
									</div>
									<div className="lane-grid" style={{ ...timelineGridStyle, '--track-color': trackColor } as CSSProperties}>
										<div className="lane-grid-lines" style={{ '--timeline-cell-count': timelineCellCount } as CSSProperties} aria-hidden="true">{timelineCells.map((cell, index) => <span className={cell.isBarStart ? 'beat-start' : ''} key={index} />)}</div>
										<div
											className="pattern-region"
											style={{ '--track-color': trackColor, '--clip-start': clipStart, '--clip-end': clipEnd } as CSSProperties}
											onPointerDown={(event) => startTimingDrag(event, block.id, 'move')}
											onKeyDown={(event) => {
												if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
												event.preventDefault();
												const delta = event.key === 'ArrowLeft' ? -TIMELINE_SNAP_CYCLE : TIMELINE_SNAP_CYCLE;
												const range = shiftTrackRange(timing.startCycle, timing.endCycle, delta);
												setTrackRange(block.id, range.startCycle, range.endCycle);
											}}
											role="button"
											tabIndex={0}
											aria-label={`Move ${block.name} clip, currently ${timingLabel}`}
											title={`${block.name}: drag to move in quarter-cycle steps`}
										>
											<button className="clip-handle clip-handle-start" type="button" onPointerDown={(event) => startTimingDrag(event, block.id, 'start')} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const delta = event.key === 'ArrowLeft' ? -TIMELINE_SNAP_CYCLE : TIMELINE_SNAP_CYCLE; setTrackRange(block.id, clamp(timing.startCycle + delta, 0, timing.endCycle - TIMELINE_SNAP_CYCLE), timing.endCycle); } }} aria-label={`Set ${block.name} start point, currently cycle ${formatCycle(timing.startCycle)}`} title={`In ${formatCycle(timing.startCycle)} cycles`} />
											<span>{block.name.toUpperCase()}</span><small>{timingLabel}</small>
											<button className="clip-handle clip-handle-end" type="button" onPointerDown={(event) => startTimingDrag(event, block.id, 'end')} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const delta = event.key === 'ArrowLeft' ? -TIMELINE_SNAP_CYCLE : TIMELINE_SNAP_CYCLE; setTrackRange(block.id, timing.startCycle, Math.max(timing.startCycle + TIMELINE_SNAP_CYCLE, timing.endCycle + delta)); } }} aria-label={`Set ${block.name} end point, currently cycle ${formatCycle(timing.endCycle)}`} title={`Out ${formatCycle(timing.endCycle)} cycles`} />
										</div>
										<span className={`lane-playhead ${studio.runtime.transport === 'playing' ? 'lane-playhead-live' : ''}`} style={{ '--playhead-position': clamp(studio.runtime.currentCycle / studio.songEndCycle, 0, 1) } as CSSProperties} aria-hidden="true" />
									</div>
								</div>
							);
						})}
						{blocks.length ? (
							<div className="timeline-fill" style={timelineGridStyle} aria-hidden="true"><div className="timeline-fill-label" /><div className="lane-grid timeline-fill-grid"><div className="lane-grid-lines" style={{ '--timeline-cell-count': timelineCellCount } as CSSProperties}>{timelineCells.map((cell, index) => <span className={cell.isBarStart ? 'beat-start' : ''} key={index} />)}</div><span className="lane-playhead timeline-fill-playhead" style={{ '--playhead-position': clamp(studio.runtime.currentCycle / studio.songEndCycle, 0, 1) } as CSSProperties} /></div></div>
						) : (
							<div className="timeline-empty-state" style={timelineGridStyle}>
								<strong>NO TRACKS</strong>
								<span>Add a track or write a <code>$:</code> pattern to begin.</span>
							</div>
						)}
					</section>

					{studio.diagnostics.length ? <div className="canvas-diagnostic" role="status" aria-live="polite"><div className="diagnostic-meta"><span className="error-mark" aria-hidden="true">!</span><span>{getDiagnosticLabel(studio.diagnostics[0])}</span><span>{getDiagnosticLocation(studio.diagnostics[0]) || `REV ${formatRevision(studio.diagnostics[0].revision)}`}</span></div><p>{studio.diagnostics[0].message}</p>{studio.diagnostics[0].context ? <code className="diagnostic-context">{studio.diagnostics[0].context}</code> : null}</div> : null}
				</main>
			</div>


			<footer className="studio-footer" aria-label="Studio commands">
				<div className="studio-footer-group studio-footer-left">
					<span className="studio-footer-heading">COMMANDS</span>
					<span><kbd>⌘/Ctrl + Enter</kbd> validate source</span>
					<span><kbd>Backspace/Delete</kbd> delete selected track</span>
				</div>
				<div className="studio-footer-group studio-footer-right">
					<div className="timeline-zoom-control">
						<span className="timeline-zoom-icon timeline-zoom-mountain" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m3 18 5.5-7 3.3 4 3.2-5 6 8H3Z" /></svg></span>
						<label>
							<span className="sr-only">Timeline zoom</span>
							<input type="range" min="0" max="100" step="1" value={timelineZoom} onChange={(event) => setTimelineZoom(Number(event.target.value))} aria-label="Timeline zoom" aria-valuetext={`${Math.round(timelineVisibleCycles)} bars visible`} title="Timeline zoom: overview to one bar" />
						</label>
						<span className="timeline-zoom-icon timeline-zoom-search" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 5 5" /></svg></span>
						<output>{Math.round(timelineVisibleCycles)} BAR{Math.round(timelineVisibleCycles) === 1 ? '' : 'S'}</output>
					</div>
					<span><kbd>Right-click</kbd> track actions</span>
					<span><kbd>←/→</kbd> nudge a clip by ¼ bar</span>
				</div>
			</footer>

			{contextMenu && contextMenuTrack ? (
				<div className="track-context-menu" ref={contextMenuRef} style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" aria-label={`${contextMenuTrack.name} track actions`}>
					<div className="track-context-heading">TRACK {(blocks.findIndex((block) => block.id === contextMenuTrack.id) + 1).toString().padStart(2, '0')} · {contextMenuTrack.name}</div>
					<button type="button" role="menuitem" onClick={() => beginTrackRename(contextMenuTrack.id)}>Rename track</button>
					<button className="track-context-delete" type="button" role="menuitem" onClick={() => void deleteSelectedTrack(contextMenuTrack.id)}>Delete track <span aria-hidden="true">⌫</span></button>
				</div>
			) : null}
		</div>
	);
}
