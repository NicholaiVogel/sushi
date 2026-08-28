import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent as ReactChangeEvent, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
	createInitialProject,
	DEFAULT_SONG_END_CYCLE,
	EXTENDED_SONG_END_CYCLE,
	diagnosticFromError,
	getSourceBlocks,
	getSourceIdentityDiagnostics,
	LEGACY_DEFAULT_SOURCE,
	type SourceDiagnostic,
} from '../lib/project/model';
import {
	getSourceBlockDetails,
	getSourceGlobals,
	addTrackEffect,
	cyclesToSeconds,
	removeTrackEffect,
	type SourceEffectMethod,
	updateSourceKey,
	updateSourceQuarterNotesPerCycle,
	deleteTrack as deleteSourceTrack,
	updateSourceBpm,
	updateTrackGain,
	updateTrackColor,
	updateTrackMode,
	updateTrackName as updateSourceTrackName,
	updateTrackPan,
	updateTrackRange as updateSourceTrackRange,
	updateTrackEffect,
	updateTrackSlider,
} from '../lib/project/source-mapper';
import { getSourceLineNumbers, replaceSourceSelection } from '../lib/project/editor';
import type { EditorPreset } from '../lib/project/presets';
import {
	getTimelineCapacityForEndCycle,
	getTimelineZoomForVisibleCycles,
} from '../lib/project/timeline';
import { highlightStrudel } from '../lib/project/syntax-highlight';
import { listStoredProjects, loadProjectSnapshot, parseProjectExport, saveProjectSnapshot, serializeProjectSnapshot, type StoredProjectSnapshot, type StoredProjectSummary } from '../lib/project/storage';
import { isAudioLockedError, StrudelAdapter, type AdapterResult, type AdapterRuntimeUpdate, type StrudelVisualizer, type VisualizerHap } from '../lib/strudel/adapter';
import type { WebMcpMutationResult, WebMcpRegistration } from '../lib/webmcp/tools';
import { TransactionCache } from '../lib/webmcp/transaction-cache';
import { StudioHeader } from './studio/StudioHeader';
import { SourceEditor, CanvasDiagnostic } from './studio/SourceEditor';
import { Timeline } from './studio/Timeline';
import { TrackContextMenu } from './studio/TrackContextMenu';
import { useStudioWebMcp } from './studio/useStudioWebMcp';
import {
	clamp,
	createInitialStudioState,
	EDITOR_WIDTH_MAX,
	EDITOR_WIDTH_MIN,
	getErrorDiagnostic,
	getExplicitSourceEndCycle,
	getKeyParts,
	getSourceCycleStep,
	getTrackTimingForTimeline,
	normalizeImportedSnapshot,
	normalizeTrackRange,
	projectFileName,
	snapshotFromStudio,
	shiftTrackRange,
	snapCycle,
	sourceForTrackMutation,
	SOURCE_HISTORY_LIMIT,
	TIMELINE_LABEL_MIN_WIDTH,
	TIMELINE_SNAP_CYCLE,
	timelineLabelStride,
} from './studio/helpers';
import type {
	CommitSourceResult,
	DispatchResult,
	HeaderPopover,
	PersistenceState,
	SourceHistoryState,
	StudioCommand,
	StudioState,
	TimingDrag,
} from './studio/types';
export default function Studio() {
	const [studio, setStudio] = useState<StudioState>(createInitialStudioState);
	const [editorWidth, setEditorWidth] = useState(350);
	const [, setSourceHistoryVersion] = useState(0);
	const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
	const [contextMenu, setContextMenu] = useState<{ trackId: string; x: number; y: number } | null>(null);
	const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
	const [renamingTrackValue, setRenamingTrackValue] = useState('');
	const [timelineZoom, setTimelineZoom] = useState(0);
	const [openHeaderPopover, setOpenHeaderPopover] = useState<HeaderPopover | null>(null);
	const [localProjects, setLocalProjects] = useState<StoredProjectSummary[]>([]);
	const [localProjectsLoading, setLocalProjectsLoading] = useState(false);
	const [localProjectsError, setLocalProjectsError] = useState<string | null>(null);
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
	const editorScrollFrameRef = useRef<number | null>(null);
	const pendingTrackSourceRef = useRef<{ source: string; baseRevision: number } | null>(null);
	const trackCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const sourceCommitQueueRef = useRef<Promise<void>>(Promise.resolve());
	const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
	const timingDragRef = useRef<TimingDrag | null>(null);
	const timelineSeekDragRef = useRef<HTMLElement | null>(null);
	const timelineSeekCycleRef = useRef<number | null>(null);
	const contextMenuRef = useRef<HTMLDivElement | null>(null);
	const headerPopoverScopeRef = useRef<HTMLElement | null>(null);
	const timelineLengthRef = useRef<HTMLDivElement | null>(null);
	const sourceHistoryRef = useRef<SourceHistoryState>({
		cursorSource: createInitialProject().source.draft,
		undo: [],
		redo: [],
	});
	const sourceTransactionsRef = useRef(new TransactionCache<WebMcpMutationResult>(SOURCE_HISTORY_LIMIT));
	const webmcpRegistrationRef = useRef<WebMcpRegistration | null>(null);
	const webmcpAvailableRef = useRef(false);

	const applyEditorScroll = useCallback(() => {
		const editor = sourceEditorRef.current;
		if (!editor) return;
		const { scrollLeft, scrollTop } = editor;
		if (sourceHighlightRef.current) {
			// Keep the highlight layer out of the browser's nested scrolling
			// algorithm. Transforming the overflowing pre directly means the
			// transparent textarea and its selection paint from the same origin,
			// even when a browser reports scroll events before layout settles.
			sourceHighlightRef.current.scrollTop = 0;
			sourceHighlightRef.current.scrollLeft = 0;
			sourceHighlightRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
		}
		if (editorGutterRef.current) editorGutterRef.current.scrollTop = scrollTop;
	}, []);

	const syncEditorScroll = useCallback(() => {
		applyEditorScroll();
		if (typeof window === 'undefined') return;
		if (editorScrollFrameRef.current !== null) window.cancelAnimationFrame(editorScrollFrameRef.current);
		editorScrollFrameRef.current = window.requestAnimationFrame(() => {
			editorScrollFrameRef.current = null;
			applyEditorScroll();
		});
	}, [applyEditorScroll]);

	useEffect(() => () => {
		if (editorScrollFrameRef.current !== null) window.cancelAnimationFrame(editorScrollFrameRef.current);
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

	const refreshLocalProjects = useCallback(async () => {
		setLocalProjectsLoading(true);
		setLocalProjectsError(null);
		try {
			const projects = await listStoredProjects();
			if (!mountedRef.current) return;
			setLocalProjects(projects);
		} catch (error) {
			if (!mountedRef.current) return;
			setLocalProjectsError(error instanceof Error ? error.message : String(error));
		} finally {
			if (mountedRef.current) setLocalProjectsLoading(false);
		}
	}, []);

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
			setTimelineZoom(getTimelineZoomForVisibleCycles(songEndCycle));
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

	const handleEditorPaste = useCallback(
		(event: ReactClipboardEvent<HTMLTextAreaElement>) => {
			const pastedText = event.clipboardData.getData('text/plain');
			if (!pastedText) return;

			event.preventDefault();
			const editor = event.currentTarget;
			const current = studioRef.current;
			const replacement = replaceSourceSelection(
				current.draft,
				pastedText,
				editor.selectionStart,
				editor.selectionEnd,
			);
			const baseRevision = current.revision;
			cancelPendingTrackCommit();
			patchStudio({
				draft: replacement.source,
				...(current.diagnostics.length ? { diagnostics: [], phase: 'ready' as const } : {}),
			});
			// A complete paste is an intentional source replacement. Validate it as
			// one transaction so the timeline follows the pasted song immediately;
			// invalid source stays a draft and is surfaced with diagnostics.
			void commitSource(replacement.source, { expectedRevision: baseRevision });
			requestAnimationFrame(() => {
				if (sourceEditorRef.current !== editor) return;
				editor.setSelectionRange(replacement.caret, replacement.caret);
				syncEditorScroll();
			});
		},
		[cancelPendingTrackCommit, commitSource, patchStudio, syncEditorScroll],
	);

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
		const existingIds = new Set(getSourceBlocks(currentSource).map((track) => track.id));
		let trackId = '';
		while (!trackId || existingIds.has(trackId)) {
			const randomUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
				? crypto.randomUUID().toUpperCase()
				: `${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
			trackId = `trk_${randomUuid}`;
		}
		const nextSource = `${currentSource}\n\n// @sushi-track {"id":"${trackId}","name":"untitled","type":"synth","schema":1}\n$: seqPLoop([0, 4, note("<c3 e3 g3 a3>").s("sine").gain(0.18)])\n`;
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
		const explicitSourceEndCycle = getExplicitSourceEndCycle(studioRef.current.lastValid);
		const nextSongEndCycle = Math.min(EXTENDED_SONG_END_CYCLE, Math.max(requestedEndCycle, explicitSourceEndCycle));
		adapterRef.current?.setSongEndCycle(nextSongEndCycle);
		patchStudio({
			songEndCycle: nextSongEndCycle,
			...(studioRef.current.runtime.currentCycle > nextSongEndCycle ? { runtime: { ...studioRef.current.runtime, currentCycle: nextSongEndCycle } } : {}),
		});
		// Timeline edits are project data too. Persist immediately so a reload
		// cannot lose a boundary change made between autosave ticks.
		void persistStudioSnapshot();
	}, [patchStudio, persistStudioSnapshot]);

	const adjustTimelineZoom = useCallback((value: number) => {
		const shell = timelineShellRef.current;
		if (shell && shell.scrollWidth > 0) {
			timelineZoomAnchorRef.current = (shell.scrollLeft + shell.clientWidth / 2) / shell.scrollWidth;
		}
		setTimelineZoom(Math.max(0, Math.min(100, value)));
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
	}, [timelineZoom]);

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

	const setTrackSlider = useCallback(
		(trackId: string, sliderId: string, value: number) => updateTrackSource(trackId, (source) => updateTrackSlider(source, trackId, sliderId, value)),
		[updateTrackSource],
	);

	const setTrackEffect = useCallback(
		(trackId: string, effectId: string, value: number | 'rand') => updateTrackSource(trackId, (source) => updateTrackEffect(source, trackId, effectId, value)),
		[updateTrackSource],
	);

	const addTrackEffectToSource = useCallback(
		(trackId: string, method: SourceEffectMethod) => updateTrackSource(trackId, (source) => addTrackEffect(source, trackId, method)),
		[updateTrackSource],
	);

	const removeTrackEffectFromSource = useCallback(
		(trackId: string, effectId: string) => updateTrackSource(trackId, (source) => removeTrackEffect(source, trackId, effectId)),
		[updateTrackSource],
	);

	const setTrackColor = useCallback(
		(trackId: string, value: string) => updateTrackSource(trackId, (source) => updateTrackColor(source, trackId, value)),
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

	const applyProjectSnapshot = useCallback(async (snapshot: StoredProjectSnapshot): Promise<boolean> => {
		const generation = studioGenerationRef.current;
		const imported = normalizeImportedSnapshot(snapshot);
		const identityDiagnostics = getSourceIdentityDiagnostics(imported.project.source.revision, imported.project.source.lastValid);
		if (identityDiagnostics.length) {
			patchStudio({ phase: 'error', diagnostics: identityDiagnostics });
			return false;
		}

		const adapter = adapterRef.current;
		if (!adapter) {
			patchStudio({ phase: 'error', diagnostics: [getErrorDiagnostic(studioRef.current.revision, new Error('The Strudel runtime is not ready.'), 'audio', studioRef.current.draft)] });
			return false;
		}

		cancelPendingTrackCommit();
		patchStudio({ phase: 'validating', diagnostics: [] });
		const stopped = await adapter.stop();
		if (!mountedRef.current || studioGenerationRef.current !== generation) return false;
		if (!stopped.ok) {
			patchStudio({ phase: 'error', diagnostics: [getErrorDiagnostic(studioRef.current.revision, stopped.error, 'audio', studioRef.current.draft)] });
			return false;
		}

		const evaluated = await adapter.evaluateSource(imported.project.source.lastValid, { autoplay: false, restoreSource: studioRef.current.lastValid });
		if (!mountedRef.current || studioGenerationRef.current !== generation) return false;
		if (!evaluated.ok) {
			patchStudio({ phase: 'error', diagnostics: [getErrorDiagnostic(imported.project.source.revision, evaluated.error, 'evaluate', imported.project.source.lastValid)] });
			return false;
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
		if (!mountedRef.current || studioGenerationRef.current !== generation) return false;

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
		setOpenHeaderPopover(null);
		await persistStudioSnapshot(imported, generation);
		void refreshLocalProjects();
		return true;
	}, [bumpSourceHistory, cancelPendingTrackCommit, patchStudio, persistStudioSnapshot, refreshLocalProjects]);

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
		await applyProjectSnapshot(parsed.snapshot);
	}, [applyProjectSnapshot, patchStudio]);

	const loadLocalProject = useCallback(async (projectId: string) => {
		if (!projectId.trim()) return;
		try {
			const snapshot = await loadProjectSnapshot(projectId);
			if (!mountedRef.current) return;
			if (!snapshot) {
				patchStudio({ phase: 'error', diagnostics: [getErrorDiagnostic(studioRef.current.revision, new Error('The saved Sushi project could not be found.'), 'commit', studioRef.current.draft)] });
				return;
			}
			await applyProjectSnapshot(snapshot);
		} catch (error) {
			if (mountedRef.current) patchStudio({ phase: 'error', diagnostics: [getErrorDiagnostic(studioRef.current.revision, error, 'commit', studioRef.current.draft)] });
		}
	}, [applyProjectSnapshot, patchStudio]);

	const loadEditorPreset = useCallback(async (preset: EditorPreset) => {
		cancelPendingTrackCommit();
		const current = studioRef.current;
		const result = await commitSource(preset.source, { expectedRevision: current.revision });
		if (!result.ok) return;

		const presetEndCycle = getTimelineCapacityForEndCycle(Math.max(DEFAULT_SONG_END_CYCLE, getExplicitSourceEndCycle(preset.source)));
		adapterRef.current?.setSongEndCycle(presetEndCycle);
		patchStudio({ projectName: preset.name, songEndCycle: presetEndCycle });
		setOpenHeaderPopover(null);
		await persistStudioSnapshot();
		void refreshLocalProjects();
	}, [cancelPendingTrackCommit, commitSource, patchStudio, persistStudioSnapshot, refreshLocalProjects]);

	const saveProject = useCallback(() => {
		void persistStudioSnapshot().then(() => refreshLocalProjects());
	}, [persistStudioSnapshot, refreshLocalProjects]);

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
		async (trackId: string, name = renamingTrackValue) => {
			const result = await renameTrack(trackId, name);
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
		const menuWidth = 260;
		const menuHeight = 280;
		const maxX = Math.max(8, window.innerWidth - menuWidth - 8);
		const maxY = Math.max(8, window.innerHeight - menuHeight - 8);
		setContextMenu({ trackId, x: Math.min(Math.max(8, event.clientX), maxX), y: Math.min(Math.max(8, event.clientY), maxY) });
	}, [selectTrack]);

	const handleTrackLaneKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>, trackId: string) => {
			if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
			event.preventDefault();
			const rect = event.currentTarget.getBoundingClientRect();
			const menuWidth = 260;
			const menuHeight = 280;
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

	useEffect(() => {
		if (!openHeaderPopover) return undefined;
		const handlePointerDown = (event: PointerEvent) => {
			if (event.target instanceof Node && (headerPopoverScopeRef.current?.contains(event.target) || timelineLengthRef.current?.contains(event.target))) return;
			setOpenHeaderPopover(null);
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpenHeaderPopover(null);
		};
		document.addEventListener('pointerdown', handlePointerDown);
		document.addEventListener('keydown', handleKeyDown);
		return () => {
			document.removeEventListener('pointerdown', handlePointerDown);
			document.removeEventListener('keydown', handleKeyDown);
		};
	}, [openHeaderPopover]);

	useEffect(() => {
		if (openHeaderPopover !== 'settings') return;
		void refreshLocalProjects();
	}, [openHeaderPopover, refreshLocalProjects]);

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
				if (current.draft !== current.lastValid && !draftHasNotBeenEvaluated) {
					// Never start the previously accepted song when the visible editor
					// contains a rejected draft. The old behavior made a failed paste
					// sound like an unrelated song and obscured the actual source error.
					return { ok: false, error: current.diagnostics[0] };
				}
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

	useStudioWebMcp({
		studioRef,
		adapterRef,
		sourceTransactionsRef,
		sourceHistoryRef,
		webmcpRegistrationRef,
		webmcpAvailableRef,
		commitSource,
		dispatch,
		patchStudio,
		persistStudioSnapshot,
		bumpSourceHistory,
		commitTempo,
		commitKey,
		commitTrackRange,
		deleteTrack,
		renameTrack,
	});
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
	const contextMenuTrackDetails = contextMenu?.trackId
		? draftTrackDetails.get(contextMenu.trackId) ?? validTrackDetails.get(contextMenu.trackId)
		: undefined;
	const sourceGlobals = useMemo(() => getSourceGlobals(studio.lastValid), [studio.lastValid]);
	const draftGlobals = useMemo(() => getSourceGlobals(studio.draft), [studio.draft]);
	const draftBpm = clamp(Math.round(draftGlobals.bpm), 0, 300);
	const draftKey = getKeyParts(draftGlobals.key);
	const isDirty = studio.draft !== studio.lastValid;
	const isBusy = studio.phase === 'booting' || studio.phase === 'validating';
	const canPlay = !isBusy && studio.runtime.audioState !== 'initializing';
	const draftLines = useMemo(() => getSourceLineNumbers(studio.draft), [studio.draft]);
	const activeLaneCount = blocks.length.toString().padStart(2, '0');
	const currentSeconds = cyclesToSeconds(studio.runtime.currentCycle, sourceGlobals);
	const songEndSeconds = cyclesToSeconds(studio.songEndCycle, sourceGlobals);
	const getCurrentCycle = useCallback(() => adapterRef.current?.getCurrentCycle() ?? studioRef.current.runtime.currentCycle, []);
	const getVisualizerHaps = useCallback((trackId: string, visualizer: StrudelVisualizer, begin: number, end: number): VisualizerHap[] => adapterRef.current?.getVisualizerHaps(trackId, visualizer, begin, end) ?? [], []);
	const getVisualizerScopeData = useCallback((trackId: string): number[] | undefined => adapterRef.current?.getVisualizerScopeData(trackId), []);
	const cycleStep = getSourceCycleStep(studio.lastValid);
	const saveStateLabel = studio.persistenceState === 'loading' ? 'LOADING' : studio.persistenceState === 'unavailable' ? 'LOCAL ONLY' : isDirty ? 'DRAFT' : 'SAVED';
	const highlightedSource = useMemo(() => highlightStrudel(studio.draft), [studio.draft]);
	const timelineCellCount = Math.max(1, Math.ceil(studio.songEndCycle / TIMELINE_SNAP_CYCLE));
	const timelineSongCycles = Math.max(TIMELINE_SNAP_CYCLE, studio.songEndCycle);
	const zoomOutCycles = timelineSongCycles;
	const timelineVisibleCycles = zoomOutCycles - (zoomOutCycles - 1) * (timelineZoom / 100);
	const timelineShowsQuarterBars = timelineVisibleCycles <= DEFAULT_SONG_END_CYCLE;
	const timelineAvailableWidth = Math.max(560, (timelineViewportWidth || 960) - TIMELINE_LABEL_MIN_WIDTH);
	const timelineGridWidth = Math.max(560, timelineAvailableWidth * timelineSongCycles / timelineVisibleCycles);
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
			<StudioHeader
				headerRef={headerPopoverScopeRef}
				projectName={studio.projectName ?? 'First light'}
				persistenceState={studio.persistenceState}
				saveStateLabel={saveStateLabel}
				isDirty={isDirty}
				isBusy={isBusy}
				canPlay={canPlay}
				runtime={studio.runtime}
				sourceGlobals={sourceGlobals}
				draftGlobals={draftGlobals}
				draftBpm={draftBpm}
				draftKey={draftKey}
				currentSeconds={currentSeconds}
				songEndSeconds={songEndSeconds}
				openPopover={openHeaderPopover}
				canUndo={sourceHistoryRef.current.undo.length > 0}
				canRedo={sourceHistoryRef.current.redo.length > 0}
				localProjects={localProjects}
				localProjectsLoading={localProjectsLoading}
				localProjectsError={localProjectsError}
				projectImportInputRef={projectImportInputRef}
				onTogglePopover={(popover) => setOpenHeaderPopover((current) => current === popover ? null : popover)}
				onProjectNameChange={(name) => patchStudio({ projectName: name })}
				onPersistProject={() => { void persistStudioSnapshot(); }}
				onSaveProject={saveProject}
				onSetTempo={setTempo}
				onSetQuarterNotesPerCycle={setQuarterNotesPerCycle}
				onSetKey={setKey}
				onRevertSource={() => { cancelPendingTrackCommit(); sourceHistoryRef.current.cursorSource = studioRef.current.lastValid; patchStudio({ draft: studioRef.current.lastValid, diagnostics: [], phase: 'ready' }); void persistStudioSnapshot(); }}
				onCommitSource={() => { void dispatch({ type: 'writeSource', source: studioRef.current.draft, expectedRevision: studioRef.current.revision }); }}
				onUndoSource={() => { void undoSourceEdit(); }}
				onRedoSource={() => { void redoSourceEdit(); }}
				onExportProject={exportProject}
				onImportProject={importProject}
				onPlay={() => { void dispatch({ type: 'play' }); }}
				onPause={() => { void dispatch({ type: 'pause' }); }}
				onStop={() => { void dispatch({ type: 'stop' }); }}
				onLoadPreset={(preset) => { void loadEditorPreset(preset); }}
				onLoadLocalProject={(projectId) => { void loadLocalProject(projectId); }}
				onRefreshLocalProjects={() => { void refreshLocalProjects(); }}
			/>

			<div className="studio-body" style={{ '--editor-width': `${editorWidth}px` } as CSSProperties}>
				<SourceEditor
					draft={studio.draft}
					draftLines={draftLines}
					draftBlockCount={draftBlocks.length}
					highlightedSource={highlightedSource}
					diagnostics={studio.diagnostics}
					sourceEditorRef={sourceEditorRef}
					sourceHighlightRef={sourceHighlightRef}
					editorGutterRef={editorGutterRef}
					onPaste={handleEditorPaste}
					onChange={(nextDraft) => {
						patchStudio({
							draft: nextDraft,
							...(studioRef.current.diagnostics.length ? { diagnostics: [], phase: 'ready' as const } : {}),
						});
									}}
									onScroll={syncEditorScroll}
									onValidate={() => { void dispatch({ type: 'writeSource', source: studioRef.current.draft, expectedRevision: studioRef.current.revision }); }}
								/>
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
					<Timeline
						timelineViewportRef={timelineViewportRef}
						timelineShellRef={timelineShellRef}
						timelineLengthRef={timelineLengthRef}
						timelineGridStyle={timelineGridStyle}
						timelineCells={timelineCells}
						timelineCellCount={timelineCellCount}
						timelineShowsQuarterBars={timelineShowsQuarterBars}
						timelineVisibleCycles={timelineVisibleCycles}
						timelineZoom={timelineZoom}
						songEndCycle={studio.songEndCycle}
						songEndSeconds={songEndSeconds}
						cycleStep={cycleStep}
						draftBpm={draftBpm}
						blocks={blocks}
						draftTrackDetails={draftTrackDetails}
						validTrackDetails={validTrackDetails}
						sourceGlobals={sourceGlobals}
						runtime={studio.runtime}
						getCurrentCycle={getCurrentCycle}
						getVisualizerHaps={getVisualizerHaps}
						getVisualizerScopeData={getVisualizerScopeData}
						isBusy={isBusy}
						selectedTrackId={selectedTrackId}
						renamingTrackId={renamingTrackId}
						renamingTrackValue={renamingTrackValue}
						openPopover={openHeaderPopover}
						onTogglePopover={(popover) => setOpenHeaderPopover((current) => current === popover ? null : popover)}
						onAddTrack={() => { void addTrack(); }}
						onSetSongEndCycle={setSongEndCycle}
						onAdjustZoom={adjustTimelineZoom}
						onStartTimelineSeekDrag={startTimelineSeekDrag}
						onTimelineSeekKeyDown={handleTimelineSeekKeyDown}
						onSelectTrack={selectTrack}
						onOpenTrackContextMenu={openTrackContextMenu}
						onTrackLaneKeyDown={handleTrackLaneKeyDown}
						onStartRename={beginTrackRename}
						onRenameValueChange={setRenamingTrackValue}
						onFinishRename={(trackId, name) => { void finishTrackRename(trackId, name); }}
						onCancelRename={cancelTrackRename}
						onToggleTrackMode={toggleTrackMode}
						onSetTrackGain={setTrackGain}
						onSetTrackPan={setTrackPan}
						onSetTrackSlider={setTrackSlider}
						onSetTrackEffect={setTrackEffect}
						onAddTrackEffect={addTrackEffectToSource}
						onRemoveTrackEffect={removeTrackEffectFromSource}
						onStartTimingDrag={startTimingDrag}
						onSetTrackRange={setTrackRange}
					/>

					{studio.diagnostics.length ? <CanvasDiagnostic diagnostic={studio.diagnostics[0]} /> : null}
				</main>
			</div>

			{contextMenu && contextMenuTrack ? <TrackContextMenu
				track={contextMenuTrack}
				trackNumber={blocks.findIndex((block) => block.id === contextMenuTrack.id) + 1}
				position={{ x: contextMenu.x, y: contextMenu.y }}
				menuRef={contextMenuRef}
				trackDetails={contextMenuTrackDetails}
				onRename={beginTrackRename}
				onDelete={deleteSelectedTrack}
				onSetColor={setTrackColor}
			/> : null}
		</div>
	);
}
