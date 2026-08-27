import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
	createInitialProject,
	diagnosticFromError,
	getSourceBlocks,
	type RuntimeState,
	type SourceDiagnostic,
} from '../lib/project/model';
import {
	getSourceBlockDetails,
	getSourceGlobals,
	cyclesToSeconds,
	updateTrackGain,
	updateTrackMode,
	updateTrackPan,
	updateTrackRange as updateSourceTrackRange,
} from '../lib/project/source-mapper';
import { getSourceLineNumbers } from '../lib/project/editor';
import { highlightStrudel } from '../lib/project/syntax-highlight';
import { loadProjectSnapshot, saveProjectSnapshot, type StoredProjectSnapshot } from '../lib/project/storage';
import { StrudelAdapter, type AdapterResult, type AdapterRuntimeUpdate } from '../lib/strudel/adapter';
import {
	applyTextEdits,
	getNativeModelContext,
	registerWebMcpTools,
	sourceDiff,
	type SourceMutationInput,
	type SourcePatchInput,
	type WebMcpController,
	type WebMcpMutationResult,
	type WebMcpPlaybackAction,
	type WebMcpPlaybackResult,
	type WebMcpRegistration,
	type WebMcpStateSnapshot,
	type WebMcpValidationResult,
} from '../lib/webmcp/tools';

type StudioPhase = 'booting' | 'ready' | 'validating' | 'error';
type PersistenceState = 'loading' | 'ready' | 'unavailable';

interface StudioState {
	projectName: string;
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
	| { type: 'writeSource'; source: string }
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
}

function createInitialStudioState(): StudioState {
	const project = createInitialProject();
	return {
		projectName: project.name,
		draft: project.source.draft,
		lastValid: project.source.lastValid,
		revision: project.source.revision,
		activeRevision: 0,
		songEndCycle: project.timeline.songEndCycle ?? 4,
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

const BEAT_LABELS = ['1', '1.1', '1.2', '1.3', '2', '2.1', '2.2', '2.3', '3', '3.1', '3.2', '3.3', '4', '4.1', '4.2', '4.3'];
const TRACK_COLORS = ['#d9ff68', '#8fe1ff', '#f0a3c7', '#c7a6ff'];
const SOURCE_HISTORY_LIMIT = 100;
const EDITOR_WIDTH_MIN = 280;
const EDITOR_WIDTH_MAX = 560;

function getTrackColor(index: number): string {
	return TRACK_COLORS[index % TRACK_COLORS.length];
}

function getTrackLabel(type: string): string {
	return type === 'unknown' ? 'SOURCE' : type.toUpperCase();
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
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

function sourceEntityIds(state: WebMcpStateSnapshot): string[] {
	return ['source', ...state.tracks.map((track) => track.id)];
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
): WebMcpMutationResult {
	const diff = sourceDiff(beforeSource, state.source.draft, beforeRevision, state.source.revision);
	return {
		ok,
		action,
		affectedEntityIds: sourceEntityIds(state),
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
	const studioRef = useRef(studio);
	const adapterRef = useRef<StrudelAdapter | null>(null);
	const mountedRef = useRef(true);
	const sourceEditorRef = useRef<HTMLTextAreaElement | null>(null);
	const sourceHighlightRef = useRef<HTMLPreElement | null>(null);
	const editorGutterRef = useRef<HTMLDivElement | null>(null);
	const editorResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const pendingTrackSourceRef = useRef<string | null>(null);
	const trackCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const timingDragRef = useRef<{ trackId: string; edge: 'start' | 'end'; lane: HTMLElement } | null>(null);
	const timelineSeekDragRef = useRef<HTMLElement | null>(null);
	const timelineSeekCycleRef = useRef<number | null>(null);
	const sourceHistoryRef = useRef<SourceHistoryState>({
		cursorSource: createInitialProject().source.draft,
		undo: [],
		redo: [],
	});
	const sourceTransactionsRef = useRef(new Map<string, WebMcpMutationResult>());
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

	useEffect(() => {
		mountedRef.current = true;
		const adapter = new StrudelAdapter(patchRuntime);
		adapterRef.current = adapter;

		const boot = async () => {
			const fallbackProject = createInitialProject();
			let stored: StoredProjectSnapshot | null = null;
			let persistenceState: PersistenceState = 'ready';

			try {
				stored = await loadProjectSnapshot(fallbackProject.id);
			} catch {
				persistenceState = 'unavailable';
			}

			if (!mountedRef.current) return;
			const project = stored?.project ?? fallbackProject;
			const activeRevision = stored?.activeRevision ?? project.source.revision;
			sourceHistoryRef.current = {
				cursorSource: project.source.draft,
				undo: [],
				redo: [],
			};
			sourceTransactionsRef.current.clear();
			patchStudio({
				projectName: project.name,
				draft: project.source.draft,
				lastValid: project.source.lastValid,
				revision: project.source.revision,
				activeRevision,
				songEndCycle: project.timeline.songEndCycle ?? 4,
				persistenceState,
				runtime: { ...studioRef.current.runtime, activeRevision },
			});

			try {
				await adapter.init();
				if (!mountedRef.current) return;
				const initial = await adapter.evaluateSource(studioRef.current.lastValid, {
					autoplay: false,
				});
				if (!mountedRef.current) return;

				if (initial.ok) {
					patchStudio({
						phase: 'ready',
						diagnostics: [],
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
				if (!mountedRef.current) return;
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
			adapter.destroy();
			adapterRef.current = null;
		};
	}, [patchRuntime, patchStudio]);

	useEffect(() => {
		if (studio.persistenceState !== 'ready') return undefined;

		const snapshot = snapshotFromStudio(studioRef.current);
		const timeout = setTimeout(() => {
			void saveProjectSnapshot(snapshot.project.id, snapshot).catch(() => {
				if (mountedRef.current && studioRef.current.persistenceState === 'ready') {
					patchStudio({ persistenceState: 'unavailable' });
				}
			});
		}, 220);

		return () => clearTimeout(timeout);
	}, [patchStudio, studio.activeRevision, studio.draft, studio.lastValid, studio.persistenceState, studio.projectName, studio.revision, studio.songEndCycle]);

	const commitSource = useCallback(
		async (source: string, options: { recordHistory?: boolean } = {}): Promise<CommitSourceResult> => {
			const adapter = adapterRef.current;
			const current = studioRef.current;
			const previousSource = sourceHistoryRef.current.cursorSource;
			if (!adapter) return { ok: false, changed: false, previousSource, source, revision: current.revision, error: diagnosticFromError(current.revision, new Error('The Strudel runtime is not ready.'), source) };
			if (source === current.lastValid && current.diagnostics.length === 0 && source === current.draft) {
				sourceHistoryRef.current.cursorSource = source;
				return { ok: true, changed: false, previousSource, source, revision: current.revision };
			}

			const baseRevision = current.revision;
			const revision = baseRevision + 1;
			patchStudio({ draft: source, revision, phase: 'validating', diagnostics: [] });
			let result: AdapterResult;
			try {
				result = await adapter.evaluateSource(source, {
					autoplay: false,
					restoreSource: current.lastValid,
				});
			} catch (error) {
				result = { ok: false, error };
			}

			if (!mountedRef.current || studioRef.current.revision !== revision) return { ok: false, changed: false, previousSource, source, revision };
			if (result.ok) {
				patchStudio({
					lastValid: source,
					activeRevision: revision,
					diagnostics: [],
					phase: 'ready',
					runtime: { ...studioRef.current.runtime, activeRevision: revision },
				});
				sourceHistoryRef.current.cursorSource = source;
				if (options.recordHistory !== false && source !== previousSource) {
					sourceHistoryRef.current.undo.push({ before: previousSource, after: source, beforeRevision: baseRevision, afterRevision: revision });
					if (sourceHistoryRef.current.undo.length > SOURCE_HISTORY_LIMIT) sourceHistoryRef.current.undo.shift();
					sourceHistoryRef.current.redo = [];
				}
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
			}
			return { ok: false, changed: source !== previousSource, previousSource, source, revision, error: diagnostic };
		},
		[patchStudio],
	);

	const cancelPendingTrackCommit = useCallback(() => {
		if (trackCommitTimerRef.current !== null) {
			clearTimeout(trackCommitTimerRef.current);
			trackCommitTimerRef.current = null;
		}
		pendingTrackSourceRef.current = null;
	}, []);

	const queueTrackCommit = useCallback(
		(source: string) => {
			pendingTrackSourceRef.current = source;
			if (trackCommitTimerRef.current !== null) clearTimeout(trackCommitTimerRef.current);
			trackCommitTimerRef.current = setTimeout(() => {
				const queuedSource = pendingTrackSourceRef.current;
				pendingTrackSourceRef.current = null;
				trackCommitTimerRef.current = null;
				if (queuedSource !== null) void commitSource(queuedSource);
			}, 120);
		},
		[commitSource],
	);

	useEffect(() => cancelPendingTrackCommit, [cancelPendingTrackCommit]);

	const addTrack = useCallback(async () => {
		cancelPendingTrackCommit();
		const currentSource = studioRef.current.draft.trimEnd();
		const nextTrackNumber = getSourceBlocks(currentSource).length + 1;
		const trackId = `trk_${Date.now().toString(36).toUpperCase()}`;
		const nextSource = `${currentSource}\n\n// @sushi-track {"id":"${trackId}","name":"Track ${nextTrackNumber}","type":"synth","schema":1}\n$: note("<c3 e3 g3 a3>").s("sine").gain(0.18)\n`;
		await commitSource(nextSource);
	}, [cancelPendingTrackCommit, commitSource]);

	const updateTrackSource = useCallback(
		(trackId: string, update: (source: string) => string) => {
			const currentSource = studioRef.current.draft;
			const nextSource = update(currentSource);
			if (nextSource === currentSource) return;
			patchStudio({
				draft: nextSource,
				...(studioRef.current.diagnostics.length ? { diagnostics: [], phase: 'ready' as const } : {}),
			});
			queueTrackCommit(nextSource);
		},
		[patchStudio, queueTrackCommit],
	);

	const setTrackRange = useCallback(
		(trackId: string, startCycle: number, endCycle: number) => updateTrackSource(trackId, (source) => updateSourceTrackRange(source, trackId, startCycle, endCycle)),
		[updateTrackSource],
	);

	const handleTimingPointerMove = useCallback(
		(event: PointerEvent) => {
			const drag = timingDragRef.current;
			if (!drag) return;

			const rect = drag.lane.getBoundingClientRect();
			if (!rect.width) return;
			const nextCycle = clamp(Math.round(((event.clientX - rect.left) / rect.width) * studioRef.current.songEndCycle * 4) / 4, 0, studioRef.current.songEndCycle);
			const details = getSourceBlockDetails(studioRef.current.draft).find((block) => block.id === drag.trackId);
			if (!details) return;
			const startCycle = drag.edge === 'start' ? Math.min(nextCycle, details.timing.endCycle - 0.25) : details.timing.startCycle;
			const endCycle = drag.edge === 'end' ? Math.max(nextCycle, details.timing.startCycle + 0.25) : details.timing.endCycle;
			setTrackRange(drag.trackId, Math.max(0, startCycle), Math.min(studioRef.current.songEndCycle, endCycle));
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
		(event: ReactPointerEvent<HTMLButtonElement>, trackId: string, edge: 'start' | 'end') => {
			const lane = event.currentTarget.closest('.lane-grid');
			if (!(lane instanceof HTMLElement)) return;
			event.preventDefault();
			timingDragRef.current = { trackId, edge, lane };
			window.addEventListener('pointermove', handleTimingPointerMove);
			window.addEventListener('pointerup', stopTimingDrag);
			window.addEventListener('pointercancel', stopTimingDrag);
		},
		[handleTimingPointerMove, stopTimingDrag],
	);

	useEffect(() => stopTimingDrag, [stopTimingDrag]);
	useEffect(() => stopEditorResize, [stopEditorResize]);

	const setTrackGain = useCallback(
		(trackId: string, value: number) => updateTrackSource(trackId, (source) => updateTrackGain(source, trackId, value)),
		[updateTrackSource],
	);

	const setTrackPan = useCallback(
		(trackId: string, value: number) => updateTrackSource(trackId, (source) => updateTrackPan(source, trackId, value)),
		[updateTrackSource],
	);

	const toggleTrackMode = useCallback(
		(trackId: string, mode: 'mute' | 'solo', active: boolean) => updateTrackSource(trackId, (source) => updateTrackMode(source, trackId, mode, active)),
		[updateTrackSource],
	);

	const dispatch = useCallback(
		async (command: StudioCommand): Promise<DispatchResult> => {
			if (command.type === 'writeSource') {
				cancelPendingTrackCommit();
				const result = await commitSource(command.source);
				return result.ok ? { ok: true } : { ok: false, error: result.error };
			}

			const adapter = adapterRef.current;
			if (!adapter || studioRef.current.phase === 'booting' || studioRef.current.phase === 'validating') return { ok: false, error: new Error('The Strudel runtime is not ready.') };

			if (command.type === 'play') {
				cancelPendingTrackCommit();
				const current = studioRef.current;
				const draftHasNotBeenEvaluated = current.diagnostics.length === 0;
				if ((current.draft !== current.lastValid && draftHasNotBeenEvaluated) || current.activeRevision === null) {
					const committed = await commitSource(current.draft);
					if (!committed.ok) return { ok: false, error: committed.error };
				}

				const result = await adapter.play(current.songEndCycle);
				if (result.ok) {
					patchStudio({
						phase: 'ready',
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
						runtime: { ...studioRef.current.runtime, audioState: 'error', transport: 'stopped' },
					});
					return { ok: false, error: result.error };
				}
				return { ok: true };
			}

			if (command.type === 'pause') {
				const result = await adapter.pause();
				if (result.ok) {
					patchStudio({
						phase: studioRef.current.diagnostics.length ? 'error' : 'ready',
						runtime: { ...studioRef.current.runtime, transport: 'paused' },
					});
				} else {
					patchStudio({
						phase: 'error',
						diagnostics: [getErrorDiagnostic(studioRef.current.revision, result.error, 'audio', studioRef.current.draft)],
						runtime: { ...studioRef.current.runtime, audioState: 'error' },
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
				patchStudio({
					phase: studioRef.current.diagnostics.length ? 'error' : 'ready',
					runtime: { ...studioRef.current.runtime, transport: 'stopped', currentCycle: 0 },
				});
			} else {
				patchStudio({
					phase: 'error',
						diagnostics: [getErrorDiagnostic(studioRef.current.revision, result.error, 'audio', studioRef.current.draft)],
					runtime: { ...studioRef.current.runtime, audioState: 'error', transport: 'stopped' },
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
		const tracks = getSourceBlockDetails(current.lastValid).map((track) => ({
			id: track.id,
			name: track.name,
			type: track.type,
			line: track.line,
			...(track.label === undefined ? {} : { label: track.label }),
			...(track.expression === undefined ? {} : { expression: track.expression }),
			timing: track.timing,
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
			webmcp: { available: webmcpAvailableRef.current || Boolean(getNativeModelContext()) },
		};
	}, []);

	const rememberMutation = useCallback((result: WebMcpMutationResult): WebMcpMutationResult => {
		if (result.transactionId) {
			sourceTransactionsRef.current.set(result.transactionId, result);
			while (sourceTransactionsRef.current.size > SOURCE_HISTORY_LIMIT) {
				const first = sourceTransactionsRef.current.keys().next().value as string | undefined;
				if (first === undefined) break;
				sourceTransactionsRef.current.delete(first);
			}
		}
		return result;
	}, []);

	const sourceMutationForWebMcp = useCallback(
		async (action: string, input: SourceMutationInput): Promise<WebMcpMutationResult> => {
			const cached = sourceTransactionsRef.current.get(input.transactionId);
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

			const beforeSource = current.draft;
			let result: CommitSourceResult;
			try {
				result = await commitSource(input.source);
			} catch (error) {
				const state = getWebMcpState();
				return rememberMutation(makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, false, 'The source transaction could not be completed.', { code: 'SOURCE_COMMIT_FAILED', message: error instanceof Error ? error.message : String(error) }));
			}

			const state = getWebMcpState();
			if (result.ok) {
				return rememberMutation(makeMutationResult(state, action, input.transactionId, beforeSource, input.baseRevision, true, `Source accepted at ${formatRevision(state.source.revision)}.`));
			}

			const diagnostic = result.error;
			return rememberMutation(makeMutationResult(
				state,
				action,
				input.transactionId,
				beforeSource,
				input.baseRevision,
				false,
				`Source draft updated, but Strudel rejected it; ${formatRevision(state.source.activeRevision)} remains active.`,
				{ code: 'VALIDATION_FAILED', message: diagnostic?.message ?? 'Strudel could not evaluate the source.', details: diagnostic ? { diagnostic } : undefined },
			));
		},
		[commitSource, getWebMcpState, rememberMutation],
	);

	const patchSourceForWebMcp = useCallback(
		async (input: SourcePatchInput): Promise<WebMcpMutationResult> => {
			const cached = sourceTransactionsRef.current.get(input.transactionId);
			if (cached) return cached;
			const current = studioRef.current;
			if (input.baseRevision !== current.revision) {
				return sourceMutationForWebMcp('patch_strudel_source', { source: current.draft, baseRevision: input.baseRevision, transactionId: input.transactionId });
			}
			const applied = applyTextEdits(current.draft, input.edits);
			if (!applied.ok) {
				const state = getWebMcpState();
				return rememberMutation(makeMutationResult(state, 'patch_strudel_source', input.transactionId, current.draft, current.revision, false, 'Patch rejected before validation; the source was not changed.', applied.error));
			}
			if (applied.source === current.draft) {
				const state = getWebMcpState();
				return rememberMutation(makeMutationResult(state, 'patch_strudel_source', input.transactionId, current.draft, current.revision, true, 'No source changes were requested.'));
			}
			return sourceMutationForWebMcp('patch_strudel_source', { source: applied.source, baseRevision: input.baseRevision, transactionId: input.transactionId });
		},
		[getWebMcpState, rememberMutation, sourceMutationForWebMcp],
	);

	const validateSourceForWebMcp = useCallback(
		async (source?: string): Promise<WebMcpValidationResult> => {
			const candidate = source ?? studioRef.current.draft;
			const revision = studioRef.current.revision;
			const adapter = adapterRef.current;
			if (!adapter) {
				const diagnostic = diagnosticFromError(revision, new Error('The Strudel runtime is not ready.'), candidate);
				return { ok: false, action: 'validate_strudel_source', source: candidate, diagnostics: [diagnostic], message: diagnostic.message, revision, state: getWebMcpState(), error: { code: 'VALIDATION_UNAVAILABLE', message: diagnostic.message } };
			}

			try {
				const result = await adapter.validateSource(candidate, studioRef.current.lastValid);
				if (result.ok) return { ok: true, action: 'validate_strudel_source', source: candidate, diagnostics: [], message: 'Strudel accepted the candidate source.', revision, state: getWebMcpState() };
				const diagnostic = diagnosticFromError(revision, result.error, candidate);
				return { ok: false, action: 'validate_strudel_source', source: candidate, diagnostics: [diagnostic], message: diagnostic.message, revision, state: getWebMcpState(), error: { code: 'VALIDATION_FAILED', message: diagnostic.message, details: { diagnostic } } };
			} catch (error) {
				const diagnostic = diagnosticFromError(revision, error, candidate);
				return { ok: false, action: 'validate_strudel_source', source: candidate, diagnostics: [diagnostic], message: diagnostic.message, revision, state: getWebMcpState(), error: { code: 'VALIDATION_FAILED', message: diagnostic.message, details: { diagnostic } } };
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
				const message = input.action === 'seek' ? `Playhead moved to cycle ${formatCycle(state.runtime.currentCycle)}.` : `Playback ${input.action === 'resume' ? 'resumed' : `${input.action}ed`}.`;
				return { ok: true, action: `control_playback:${input.action}`, affectedEntityIds: ['transport'], message, state, revision: state.source.revision, activeRevision: state.source.activeRevision };
			}
			const message = result.error instanceof Error ? result.error.message : String(result.error ?? 'Playback command failed.');
			return { ok: false, action: `control_playback:${input.action}`, affectedEntityIds: ['transport'], message, state, revision: state.source.revision, activeRevision: state.source.activeRevision, error: { code: 'PLAYBACK_FAILED', message } };
		},
		[dispatch, getWebMcpState],
	);

	const undoSourceForWebMcp = useCallback(
		async (input: Omit<SourceMutationInput, 'source'>): Promise<WebMcpMutationResult> => {
			const cached = sourceTransactionsRef.current.get(input.transactionId);
			if (cached) return cached;
			const current = studioRef.current;
			if (input.baseRevision !== current.revision) {
				const state = getWebMcpState();
				return { ok: false, action: 'undo_source_edit', affectedEntityIds: sourceEntityIds(state), message: `Revision conflict: expected ${formatRevision(input.baseRevision)}, current is ${formatRevision(state.source.revision)}.`, state, revision: state.source.revision, activeRevision: state.source.activeRevision, transactionId: input.transactionId, error: { code: 'REVISION_CONFLICT', message: 'The source changed after this transaction was prepared.' }, conflict: { expectedRevision: input.baseRevision, actualRevision: state.source.revision } };
			}
			const entry = sourceHistoryRef.current.undo[sourceHistoryRef.current.undo.length - 1];
			if (!entry) {
				const state = getWebMcpState();
				return rememberMutation(makeMutationResult(state, 'undo_source_edit', input.transactionId, current.draft, current.revision, false, 'There is no source edit to undo.', { code: 'NO_UNDO', message: 'The shared source history is already at its oldest revision.' }));
			}
			const result = await commitSource(entry.before, { recordHistory: false });
			if (!result.ok) {
				const state = getWebMcpState();
				return rememberMutation(makeMutationResult(state, 'undo_source_edit', input.transactionId, current.draft, input.baseRevision, false, 'Undo could not be validated by Strudel.', { code: 'VALIDATION_FAILED', message: result.error?.message ?? 'Undo source was rejected.' }));
			}
			sourceHistoryRef.current.undo.pop();
			sourceHistoryRef.current.redo.push(entry);
			if (sourceHistoryRef.current.redo.length > SOURCE_HISTORY_LIMIT) sourceHistoryRef.current.redo.shift();
			const state = getWebMcpState();
			return rememberMutation(makeMutationResult(state, 'undo_source_edit', input.transactionId, current.draft, input.baseRevision, true, `Undid source edit; now at ${formatRevision(state.source.revision)}.`));
		},
		[commitSource, getWebMcpState, rememberMutation],
	);

	const redoSourceForWebMcp = useCallback(
		async (input: Omit<SourceMutationInput, 'source'>): Promise<WebMcpMutationResult> => {
			const cached = sourceTransactionsRef.current.get(input.transactionId);
			if (cached) return cached;
			const current = studioRef.current;
			if (input.baseRevision !== current.revision) {
				const state = getWebMcpState();
				return { ok: false, action: 'redo_source_edit', affectedEntityIds: sourceEntityIds(state), message: `Revision conflict: expected ${formatRevision(input.baseRevision)}, current is ${formatRevision(state.source.revision)}.`, state, revision: state.source.revision, activeRevision: state.source.activeRevision, transactionId: input.transactionId, error: { code: 'REVISION_CONFLICT', message: 'The source changed after this transaction was prepared.' }, conflict: { expectedRevision: input.baseRevision, actualRevision: state.source.revision } };
			}
			const entry = sourceHistoryRef.current.redo[sourceHistoryRef.current.redo.length - 1];
			if (!entry) {
				const state = getWebMcpState();
				return rememberMutation(makeMutationResult(state, 'redo_source_edit', input.transactionId, current.draft, current.revision, false, 'There is no source edit to redo.', { code: 'NO_REDO', message: 'The shared source history is already at its newest revision.' }));
			}
			const result = await commitSource(entry.after, { recordHistory: false });
			if (!result.ok) {
				const state = getWebMcpState();
				return rememberMutation(makeMutationResult(state, 'redo_source_edit', input.transactionId, current.draft, input.baseRevision, false, 'Redo could not be validated by Strudel.', { code: 'VALIDATION_FAILED', message: result.error?.message ?? 'Redo source was rejected.' }));
			}
			sourceHistoryRef.current.redo.pop();
			sourceHistoryRef.current.undo.push(entry);
			if (sourceHistoryRef.current.undo.length > SOURCE_HISTORY_LIMIT) sourceHistoryRef.current.undo.shift();
			const state = getWebMcpState();
			return rememberMutation(makeMutationResult(state, 'redo_source_edit', input.transactionId, current.draft, input.baseRevision, true, `Redid source edit; now at ${formatRevision(state.source.revision)}.`));
		},
		[commitSource, getWebMcpState, rememberMutation],
	);

	const webmcpController = useMemo<WebMcpController>(() => ({
		getState: getWebMcpState,
		writeSource: (input) => sourceMutationForWebMcp('write_strudel_source', input),
		patchSource: patchSourceForWebMcp,
		validateSource: validateSourceForWebMcp,
		controlPlayback: controlPlaybackForWebMcp,
		undoSourceEdit: undoSourceForWebMcp,
		redoSourceEdit: redoSourceForWebMcp,
	}), [controlPlaybackForWebMcp, getWebMcpState, patchSourceForWebMcp, redoSourceForWebMcp, sourceMutationForWebMcp, undoSourceForWebMcp, validateSourceForWebMcp]);

	useEffect(() => {
		let disposed = false;
		let registration: WebMcpRegistration | null = null;
		void registerWebMcpTools(webmcpController).then((nextRegistration) => {
			if (disposed) {
				nextRegistration.dispose();
				return;
			}
			registration = nextRegistration;
			webmcpRegistrationRef.current = nextRegistration;
			webmcpAvailableRef.current = nextRegistration.available;
		});
		return () => {
			disposed = true;
			registration?.dispose();
			webmcpRegistrationRef.current?.dispose();
			webmcpRegistrationRef.current = null;
			webmcpAvailableRef.current = false;
		};
	}, [webmcpController]);

	const seekTimelineAtClientX = useCallback(
		(clientX: number, ruler: HTMLElement) => {
			const rect = ruler.getBoundingClientRect();
			if (!rect.width) return;
			const songEndCycle = studioRef.current.songEndCycle;
			const cycle = clamp(Math.round(((clientX - rect.left) / rect.width) * songEndCycle * 4) / 4, 0, songEndCycle);
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
			let nextCycle: number | null = null;
			switch (event.key) {
				case 'ArrowLeft':
					nextCycle = currentCycle - 0.25;
					break;
				case 'ArrowRight':
					nextCycle = currentCycle + 0.25;
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
	const sourceGlobals = useMemo(() => getSourceGlobals(studio.lastValid), [studio.lastValid]);
	const isDirty = studio.draft !== studio.lastValid;
	const isBusy = studio.phase === 'booting' || studio.phase === 'validating';
	const canPlay = !isBusy && studio.runtime.audioState !== 'initializing';
	const draftLines = useMemo(() => getSourceLineNumbers(studio.draft), [studio.draft]);
	const activeLaneCount = blocks.length.toString().padStart(2, '0');
	const currentSeconds = cyclesToSeconds(studio.runtime.currentCycle, sourceGlobals);
	const songEndSeconds = cyclesToSeconds(studio.songEndCycle, sourceGlobals);
	const saveStateLabel = studio.persistenceState === 'loading' ? 'LOADING' : studio.persistenceState === 'unavailable' ? 'LOCAL ONLY' : isDirty ? 'DRAFT' : 'SAVED';
	const highlightedSource = useMemo(() => highlightStrudel(studio.draft), [studio.draft]);

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
						<input id="project-name" className="project-name-input" value={studio.projectName ?? 'First light'} onChange={(event) => patchStudio({ projectName: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} aria-label="Project name" title="Rename project" />
						<span className={`save-state ${isDirty || studio.persistenceState === 'loading' ? 'save-state-dirty' : ''}`} title={studio.persistenceState === 'unavailable' ? 'IndexedDB is unavailable; this session will not persist after reload.' : 'Project state is saved locally'}><span className="save-dot" aria-hidden="true" />{saveStateLabel}</span>
					</div>
					<div className="topbar-transport" aria-label="Transport controls">
						<div className="topbar-source-actions" aria-label="Source actions">
							<button className="transport-button source-action-button source-action-revert" type="button" onClick={() => { cancelPendingTrackCommit(); sourceHistoryRef.current.cursorSource = studioRef.current.lastValid; patchStudio({ draft: studioRef.current.lastValid, diagnostics: [], phase: 'ready' }); }} disabled={!isDirty || isBusy} aria-label="Revert source draft" title="Revert source draft">
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7H5v4" /><path d="M5.2 11A7.5 7.5 0 1 0 7.4 5.6L5 7" /></svg>
							</button>
							<button className="transport-button source-action-button source-action-commit" type="button" onClick={() => void dispatch({ type: 'writeSource', source: studioRef.current.draft })} disabled={!isDirty || isBusy} aria-label="Commit source" title="Commit source">
								<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
							</button>
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
					<div className="topbar-metrics" aria-label="Project settings"><span>{formatCycle(sourceGlobals.bpm)} BPM</span><span>{formatCycle(sourceGlobals.quarterNotesPerCycle)} Q/C</span><span>{formatKey(sourceGlobals.key)}</span><span>{formatCycle(songEndSeconds)}s</span></div>
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
										void dispatch({ type: 'writeSource', source: studioRef.current.draft });
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
					<section className="timeline-shell" aria-labelledby="timeline-heading">
						<div className="timeline-head">
							<div className="timeline-heading-cell">
								<div className="arrangement-toolbar">
									<button className="add-track-button" type="button" onClick={() => void addTrack()} disabled={isBusy} aria-label="Add track"><span aria-hidden="true">＋</span> Add track</button>
								</div>
								<span className="timeline-duration">{formatCycle(studio.songEndCycle)} cycles · {formatCycle(songEndSeconds)}s</span>
								<span className="sr-only" id="timeline-heading">{activeLaneCount} source lanes</span>
							</div>
							<div className="timeline-ruler" aria-label="Arrangement beats">
								{BEAT_LABELS.map((label, index) => <span className={index % 4 === 0 ? 'bar-number' : ''} key={label}>{label}</span>)}
								<button className="timeline-seek-surface" type="button" onPointerDown={startTimelineSeekDrag} onKeyDown={handleTimelineSeekKeyDown} disabled={isBusy} aria-label={`Seek playhead, cycle ${formatCycle(studio.runtime.currentCycle)}, ${formatClock(currentSeconds)}`} title="Click or drag to seek" />
								<i className="timeline-playhead" style={{ '--playhead-position': clamp(studio.runtime.currentCycle / studio.songEndCycle, 0, 1) } as CSSProperties} aria-hidden="true" />
							</div>
						</div>
						{blocks.map((block, index) => {
							const trackColor = getTrackColor(index);
							const trackDetails = draftTrackDetails.get(block.id) ?? validTrackDetails.get(block.id);
							const gain = trackDetails?.gain ?? 1;
							const pan = trackDetails?.pan ?? 0.5;
							const timing = trackDetails?.timing ?? { mode: 'full' as const, startCycle: 0, endCycle: studio.songEndCycle };
							const clipStart = clamp(timing.startCycle / studio.songEndCycle, 0, 1);
							const clipEnd = clamp(timing.endCycle / studio.songEndCycle, clipStart + 0.01, 1);
							const timingLabel = `${formatCycle(timing.startCycle)}–${formatCycle(timing.endCycle)} cycles · ${formatCycle(cyclesToSeconds(timing.endCycle - timing.startCycle, sourceGlobals))}s`;
							return (
								<div className="track-lane" key={block.id}>
									<div className="track-header" style={{ '--track-color': trackColor } as CSSProperties}>
										<div className="track-header-top">
											<span className="track-instrument-icon" aria-hidden="true">♩</span>
											<div className="track-title-wrap"><div className="track-name-line"><span className="track-number">{(index + 1).toString().padStart(2, '0')}</span><strong>{block.name}</strong></div><span className="track-type">{getTrackLabel(block.type)} <span aria-hidden="true">·</span> LINE {block.line}</span></div>
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
													<input className="track-pan-control" type="range" min="0" max="1" step="0.01" value={pan} onChange={(event) => setTrackPan(block.id, Number(event.target.value))} disabled={!trackDetails?.panEditable} aria-label={`${block.name} pan`} />
													<span className="track-pan-indicator" aria-hidden="true" style={{ transform: `translateX(-50%) rotate(${(pan - 0.5) * 42}deg)` }} />
												</span>
												<span aria-hidden="true">R</span>
											</div>
										</div>
									</div>
									<div className="lane-grid" style={{ '--track-color': trackColor } as CSSProperties}>
										<div className="lane-grid-lines" aria-hidden="true">{BEAT_LABELS.map((_, cell) => <span className={cell % 4 === 0 ? 'beat-start' : ''} key={cell} />)}</div>
										<div className="pattern-region" style={{ '--track-color': trackColor, '--clip-start': clipStart, '--clip-end': clipEnd } as CSSProperties} title={`${block.name}: ${timingLabel}`}>
											<button className="clip-handle clip-handle-start" type="button" onPointerDown={(event) => startTimingDrag(event, block.id, 'start')} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const delta = event.key === 'ArrowLeft' ? -0.25 : 0.25; setTrackRange(block.id, clamp(timing.startCycle + delta, 0, timing.endCycle - 0.25), timing.endCycle); } }} aria-label={`Set ${block.name} start point, currently cycle ${formatCycle(timing.startCycle)}`} title={`In ${formatCycle(timing.startCycle)} cycles`} />
											<span>{block.name.toUpperCase()}</span><small>{timingLabel}</small>
											<button className="clip-handle clip-handle-end" type="button" onPointerDown={(event) => startTimingDrag(event, block.id, 'end')} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); const delta = event.key === 'ArrowLeft' ? -0.25 : 0.25; setTrackRange(block.id, timing.startCycle, clamp(timing.endCycle + delta, timing.startCycle + 0.25, studio.songEndCycle)); } }} aria-label={`Set ${block.name} end point, currently cycle ${formatCycle(timing.endCycle)}`} title={`Out ${formatCycle(timing.endCycle)} cycles`} />
										</div>
										<span className={`lane-playhead ${studio.runtime.transport === 'playing' ? 'lane-playhead-live' : ''}`} style={{ '--playhead-position': clamp(studio.runtime.currentCycle / studio.songEndCycle, 0, 1) } as CSSProperties} aria-hidden="true" />
									</div>
								</div>
							);
						})}
						<div className="timeline-fill" aria-hidden="true"><div className="timeline-fill-label" /><div className="lane-grid timeline-fill-grid"><div className="lane-grid-lines">{BEAT_LABELS.map((_, cell) => <span className={cell % 4 === 0 ? 'beat-start' : ''} key={cell} />)}</div><span className="lane-playhead timeline-fill-playhead" style={{ '--playhead-position': clamp(studio.runtime.currentCycle / studio.songEndCycle, 0, 1) } as CSSProperties} /></div></div>
					</section>

					{studio.diagnostics.length ? <div className="canvas-diagnostic" role="status" aria-live="polite"><div className="diagnostic-meta"><span className="error-mark" aria-hidden="true">!</span><span>{getDiagnosticLabel(studio.diagnostics[0])}</span><span>{getDiagnosticLocation(studio.diagnostics[0]) || `REV ${formatRevision(studio.diagnostics[0].revision)}`}</span></div><p>{studio.diagnostics[0].message}</p>{studio.diagnostics[0].context ? <code className="diagnostic-context">{studio.diagnostics[0].context}</code> : null}</div> : null}
				</main>
			</div>
		</div>
	);
}
