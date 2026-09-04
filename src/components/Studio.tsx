import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent as ReactChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
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
import type { StrudelEditorView } from '@strudel/codemirror';
import {
	getSourceBlockDetails,
	getSourceGlobals,
	addTrackEffect,
	cyclesToSeconds,
	removeTrackEffect,
	reorderTrackEffect,
	toggleTrackEffect,
	updateSourceKey,
	updateSourceQuarterNotesPerCycle,
	deleteTrack as deleteSourceTrack,
	updateSourceBpm,
	updateTrackGain,
	updateTrackColor,
	setTrackEffectsEnabled as setSourceTrackEffectsEnabled,
	updateTrackMode,
	updateTrackMidiRoute,
	updateTrackInstrument,
	updateTrackName as updateSourceTrackName,
	updateTrackPan,
	updateTrackRange as updateSourceTrackRange,
	updateTrackEffect,
	updateTrackSlider,
	updateTrackSound as updateSourceTrackSound,
	type SourceEffectValue,
	type TrackMidiRouteUpdate,
} from '../lib/project/source-mapper';
import type { TrackEffectMethod } from '../lib/strudel/track-effects';
import { extendNoteGridSourceRange, midiToNoteName, parseNoteGrid, trimNoteGridSourceRange, updateNoteGridSource, type NoteGrid, type NoteGridEdit } from '../lib/project/note-grid';
import { EDITOR_PRESETS, getEditorPreset, ONBOARDING_DEMO_PRESET_ID, type EditorPreset } from '../lib/project/presets';
import {
	getTimelineCapacityForEndCycle,
	getTimelineZoomForVisibleCycles,
} from '../lib/project/timeline';
import { listStoredProjects, loadProjectSnapshot, parseProjectExport, saveProjectSnapshot, serializeProjectSnapshot, type StoredProjectSnapshot, type StoredProjectSummary } from '../lib/project/storage';
import { isAudioLockedError, StrudelAdapter, type AdapterResult, type AdapterRuntimeUpdate, type StrudelEvaluationUpdate, type StrudelHap, type StrudelVisualizer, type VisualizerHap } from '../lib/strudel/adapter';
import type { WebMcpMutationResult, WebMcpRegistration } from '../lib/webmcp/tools';
import { TransactionCache } from '../lib/webmcp/transaction-cache';
import { COMPUTER_KEYBOARD_INPUT_ID, MidiService } from '../lib/midi/service';
import { createDisabledMidiRuntimeState, type MidiChannel, type MidiClockSnapshot, type MidiClockMode, type MidiRecordedTake, type MidiRecordingOptions, type MidiRuntimeState } from '../lib/midi/types';
import { MIDI_GENERATED_REGION_END, MIDI_GENERATED_REGION_START, writeMidiTakeToSource } from '../lib/midi/source-writer';
import { StudioHeader } from './studio/StudioHeader';
import { SourceEditor, CanvasDiagnostic, type StrudelCodeMirrorModule } from './studio/SourceEditor';
import { Timeline } from './studio/Timeline';
import { TrackContextMenu } from './studio/TrackContextMenu';
import { TrackFxDrawer } from './studio/TrackFxDrawer';
import { NoteEditor } from './studio/NoteEditor';
import { MidiPanel } from './studio/MidiPanel';
import { useStudioWebMcp } from './studio/useStudioWebMcp';
import { OnboardingModal } from './studio/OnboardingModal';
import { hasOnboardingOverride, markOnboardingCompleted, readOnboardingCompletion } from './studio/onboarding';
import { APPEARANCE_STORAGE_KEY, normalizeAppearanceMode, readStoredAppearanceMode, type AppearanceMode } from '../lib/project/appearance';
import { createIfEnabled, featureFlags, registerIfEnabled } from '../config/feature-flags';
import {
	clamp,
	createBlankProjectSnapshot,
	createInitialStudioState,
	rebaseProjectSnapshotRevision,
	EDITOR_WIDTH_MAX,
	EDITOR_WIDTH_MIN,
	getErrorDiagnostic,
	getExplicitSourceEndCycle,
	getKeyParts,
	getNewAudioTrackExpression,
	getTrackColor,
	getSourceCycleStep,
	getTrackTimingForTimeline,
	formatClock,
	formatCycle,
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
	WorkspaceMode,
} from './studio/types';
import { STUDIO_LAYOUT_SETTLED_EVENT } from './studio/types';

// The home row is the familiar browser-piano layout: white keys are A–K and
// the raised keys are W/E/T/Y/U. Z–M supplies a lower white-key octave.
const COMPUTER_KEYBOARD_NOTE_BY_CODE: Readonly<Record<string, number>> = {
	KeyZ: 48,
	KeyX: 50,
	KeyC: 52,
	KeyV: 53,
	KeyB: 55,
	KeyN: 57,
	KeyM: 59,
	KeyA: 60,
	KeyW: 61,
	KeyS: 62,
	KeyE: 63,
	KeyD: 64,
	KeyF: 65,
	KeyT: 66,
	KeyG: 67,
	KeyY: 68,
	KeyH: 69,
	KeyU: 70,
	KeyJ: 71,
	KeyK: 72,
	KeyL: 74,
	Semicolon: 76,
};

const TIMELINE_SEEK_THROTTLE_MS = 40;
const EDITOR_EDGE_SNAP_PX = 64;
const WORKSPACE_LAYOUT_TRANSITION_MS = 180;
const WORKSPACE_LAYOUT_TRANSITION_FALLBACK_MS = WORKSPACE_LAYOUT_TRANSITION_MS + 80;

type EditorResizeDrag = {
	startX: number;
	startWidth: number;
	bodyWidth: number;
	currentWidth: number;
	mode: WorkspaceMode;
	body: HTMLDivElement;
};

function setTimelinePlayheadPosition(shell: HTMLElement, position: number): void {
	const left = `${position * 100}%`;
	const timelinePlayheads = shell.getElementsByClassName('timeline-playhead');
	const lanePlayheads = shell.getElementsByClassName('lane-playhead');
	for (let index = 0; index < timelinePlayheads.length; index += 1) {
		(timelinePlayheads.item(index) as HTMLElement | null)?.style.setProperty('left', left);
	}
	for (let index = 0; index < lanePlayheads.length; index += 1) {
		(lanePlayheads.item(index) as HTMLElement | null)?.style.setProperty('left', left);
	}
}

function isKeyboardTextEntryTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	return target instanceof HTMLInputElement
		|| target instanceof HTMLTextAreaElement
		|| target instanceof HTMLSelectElement
		|| target.isContentEditable
		|| Boolean(target.closest('.cm-editor, .source-editor, .note-editor'));
}

function noteGridFromMidiTake(take: MidiRecordedTake, timingStartCycle: number, timingEndCycle: number, stepCycle: number, sound: string): NoteGrid {
	const safeStepCycle = Math.max(1 / 4096, stepCycle);
	const patternCycles = Math.max(safeStepCycle, timingEndCycle - timingStartCycle, take.endedAtCycle - timingStartCycle);
	const notes = take.notes.map((note, index) => {
		const startCycle = Math.max(0, note.startCycle - timingStartCycle);
		return {
			id: `live-${take.trackId}-${note.id}-${index}`,
			slot: Math.max(0, Math.floor(startCycle / safeStepCycle)),
			stackIndex: 0,
			startCycle,
			durationCycles: Math.max(safeStepCycle / 4, note.endCycle - note.startCycle),
			midi: note.note,
			sourceValue: midiToNoteName(note.note),
		};
	});
	const steps = Math.max(1, Math.ceil(patternCycles / safeStepCycle));
	const values = Array.from({ length: steps }, () => [] as string[]);
	for (const note of notes) {
		const slot = Math.min(steps - 1, note.slot);
		values[slot].push(note.sourceValue);
	}
	return {
		trackId: take.trackId,
		sourceKind: 'note',
		steps,
		patternCycles,
		stepCycle: safeStepCycle,
		sourceStepCycle: safeStepCycle,
		startOffsets: Array.from({ length: steps }, () => 0),
		values,
		durationInsidePattern: true,
		tokens: values.map((slot) => slot.length ? slot.join(' ') : '~'),
		durations: Array.from({ length: steps }, () => safeStepCycle),
		durationMode: 'dur',
		sound,
		octaveShift: 0,
		notes,
		editable: true,
	};
}

async function waitForMidiBoundary(clock: () => MidiClockSnapshot, targetCycle: number, isCancelled: () => boolean): Promise<boolean> {
	if (!Number.isFinite(targetCycle)) return false;
	return new Promise((resolve) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const poll = () => {
			if (isCancelled()) {
				if (timer !== undefined) clearTimeout(timer);
				resolve(false);
				return;
			}
			if (clock().cycle >= targetCycle - 0.01) {
				resolve(true);
				return;
			}
			timer = setTimeout(poll, 10);
		};
		poll();
	});
}

function createProjectId(): string {
	const randomUuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID().replaceAll('-', '').toUpperCase()
		: `${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 12).toUpperCase()}`;
	return `prj_${randomUuid}`;
}

export default function Studio() {
	const experimentalMidi = featureFlags.experimentalMidi;
	const [studio, setStudio] = useState<StudioState>(createInitialStudioState);
	const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(readStoredAppearanceMode);
	const [systemPrefersDark, setSystemPrefersDark] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	const [editorWidth, setEditorWidth] = useState(350);
	const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('split');
	const [, setSourceHistoryVersion] = useState(0);
	const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
	const selectedTrackIdRef = useRef<string | null>(null);
	selectedTrackIdRef.current = selectedTrackId;
	const [fxDrawerTrackId, setFxDrawerTrackId] = useState<string | null>(null);
	const [noteEditorTrackId, setNoteEditorTrackId] = useState<string | null>(null);
	const [contextMenu, setContextMenu] = useState<{ trackId: string; x: number; y: number } | null>(null);
	const [renamingTrackId, setRenamingTrackId] = useState<string | null>(null);
	const [renamingTrackValue, setRenamingTrackValue] = useState('');
	const [timelineZoom, setTimelineZoom] = useState(0);
	const [openHeaderPopover, setOpenHeaderPopover] = useState<HeaderPopover | null>(null);
	const [midiPanelOpen, setMidiPanelOpen] = useState(false);
	const [localProjects, setLocalProjects] = useState<StoredProjectSummary[]>([]);
	const [localProjectsLoading, setLocalProjectsLoading] = useState(false);
	const [localProjectsError, setLocalProjectsError] = useState<string | null>(null);
	const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
	const [editorModule, setEditorModule] = useState<StrudelCodeMirrorModule | null>(null);
	const [editorModuleError, setEditorModuleError] = useState<string | null>(null);
	const [onboardingOpen, setOnboardingOpen] = useState(false);
	const studioRef = useRef(studio);
	const studioGenerationRef = useRef(0);
	const adapterRef = useRef<StrudelAdapter | null>(null);
	const mountedRef = useRef(true);
	const studioShellRef = useRef<HTMLDivElement | null>(null);
	const studioBodyRef = useRef<HTMLDivElement | null>(null);
	const transportClockRef = useRef<HTMLSpanElement | null>(null);
	const transportCycleRef = useRef<HTMLSpanElement | null>(null);
	const liveSourceGlobalsRef = useRef<ReturnType<typeof getSourceGlobals> | null>(null);
	const sourceEditorViewRef = useRef<StrudelEditorView | null>(null);
	const editorEvaluationRef = useRef<StrudelEvaluationUpdate | null>(null);
	const editorModuleRef = useRef<StrudelCodeMirrorModule | null>(null);
	const editorLoadAttemptRef = useRef(0);
	const projectImportInputRef = useRef<HTMLInputElement | null>(null);
	const timelineViewportRef = useRef<HTMLElement | null>(null);
	const timelineShellRef = useRef<HTMLElement | null>(null);
	const timelineZoomAnchorRef = useRef<number | null>(null);
	const editorResizeRef = useRef<EditorResizeDrag | null>(null);
	const workspaceLayoutTransitionRef = useRef(false);
	const workspaceLayoutTransitionTimerRef = useRef<number | undefined>(undefined);
	const pendingTrackSourceRef = useRef<{ source: string; baseRevision: number } | null>(null);
	const trackCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const sourceCommitQueueRef = useRef<Promise<void>>(Promise.resolve());
	const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
	const timingDragRef = useRef<TimingDrag | null>(null);
	const timelineSeekDragRef = useRef<HTMLElement | null>(null);
	const timelineSeekCycleRef = useRef<number | null>(null);
	const timelineSeekPendingCycleRef = useRef<number | null>(null);
	const timelineSeekPreviewFrameRef = useRef<number | undefined>(undefined);
	const timelineSeekDispatchTimerRef = useRef<number | undefined>(undefined);
	const timelineSeekLastDispatchAtRef = useRef(0);
	const timelineSeekInFlightRef = useRef(false);
	const timelineSeekInFlightCycleRef = useRef<number | null>(null);
	const timelineSeekForceRef = useRef(false);
	const contextMenuRef = useRef<HTMLDivElement | null>(null);
	const headerPopoverScopeRef = useRef<HTMLElement | null>(null);
	const timelineLengthRef = useRef<HTMLDivElement | null>(null);
	const restoredProjectRef = useRef(false);
	const sourceHistoryRef = useRef<SourceHistoryState>({
		cursorSource: createInitialProject().source.draft,
		undo: [],
		redo: [],
	});
	const sourceTransactionsRef = useRef(new TransactionCache<WebMcpMutationResult>(SOURCE_HISTORY_LIMIT));
	const [midiService] = useState<MidiService | null>(() => createIfEnabled(experimentalMidi, () => new MidiService()));
	const midiServiceRef = useRef<MidiService | null>(midiService);
	const externalMidiCpsRef = useRef<number | null>(null);
	const midiRecordStartTokenRef = useRef(0);
	const autoCommitMidiTakeRef = useRef(false);
	const commitMidiTakeRef = useRef<((expectedRevision?: number) => Promise<CommitSourceResult>) | null>(null);
	const webmcpRegistrationRef = useRef<WebMcpRegistration | null>(null);
	const webmcpAvailableRef = useRef(false);
	const isDarkMode = appearanceMode === 'dark' || (appearanceMode === 'system' && systemPrefersDark);
	const [midiState, setMidiState] = useState<MidiRuntimeState>(() => midiServiceRef.current?.getState() ?? createDisabledMidiRuntimeState());
	const getMidiClock = useCallback((): MidiClockSnapshot => {
		const globals = liveSourceGlobalsRef.current ?? getSourceGlobals(studioRef.current.lastValid);
		const timestampMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
		return {
			cycle: adapterRef.current?.getCurrentCycle() ?? studioRef.current.runtime.currentCycle,
			timestampMs,
			cyclesPerSecond: externalMidiCpsRef.current ?? Math.max(0.000001, globals.bpm / (60 * Math.max(0.000001, globals.quarterNotesPerCycle))),
		};
	}, []);

	useEffect(() => {
		const service = midiServiceRef.current;
		if (!experimentalMidi || !service) return undefined;
		service.setClock(getMidiClock);
		const unsubscribe = service.subscribe(setMidiState);
		service.setLiveInputHandler((event) => {
			if (!event.on) {
				adapterRef.current?.releaseLiveMidiNote(event.note, event.channel);
				return;
			}
			const sourceTracks = getSourceBlockDetails(studioRef.current.lastValid);
			const selected = selectedTrackIdRef.current ? sourceTracks.find((track) => track.id === selectedTrackIdRef.current) : undefined;
			const midiTrack = selected?.type === 'midi' ? selected : sourceTracks.find((track) => track.type === 'midi');
			void adapterRef.current?.triggerLiveMidiNote(event.note, event.velocity, midiTrack?.instrument ?? 'sine', undefined, event.channel);
		});
		return () => {
			service.setLiveInputHandler(undefined);
			adapterRef.current?.releaseAllLiveMidiNotes();
			unsubscribe();
			service.destroy();
		};
	}, [experimentalMidi, getMidiClock]);

	useEffect(() => {
		if (!experimentalMidi) return undefined;
		const service = midiServiceRef.current;
		if (!service) return undefined;
		const heldKeys = new Map<string, number>();
		const releaseHeldKeys = () => {
			for (const [code, note] of heldKeys) {
				service.ingestKeyboardNote(note, 0, false);
				heldKeys.delete(code);
			}
			adapterRef.current?.releaseAllLiveMidiNotes();
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.repeat || isKeyboardTextEntryTarget(event.target)) return;
			const baseNote = COMPUTER_KEYBOARD_NOTE_BY_CODE[event.code];
			if (baseNote === undefined) return;
			const note = Math.max(0, Math.min(127, baseNote + (event.shiftKey ? 12 : 0)));
			if (heldKeys.has(event.code)) return;
			heldKeys.set(event.code, note);
			event.preventDefault();
			service.ingestKeyboardNote(note, 0.78, true);
		};
		const handleKeyUp = (event: KeyboardEvent) => {
			const note = heldKeys.get(event.code);
			if (note === undefined) return;
			heldKeys.delete(event.code);
			event.preventDefault();
			service.ingestKeyboardNote(note, 0, false);
		};
		window.addEventListener('keydown', handleKeyDown);
		window.addEventListener('keyup', handleKeyUp);
		window.addEventListener('blur', releaseHeldKeys);
		document.addEventListener('visibilitychange', releaseHeldKeys);
		return () => {
			releaseHeldKeys();
			window.removeEventListener('keydown', handleKeyDown);
			window.removeEventListener('keyup', handleKeyUp);
			window.removeEventListener('blur', releaseHeldKeys);
			document.removeEventListener('visibilitychange', releaseHeldKeys);
		};
	}, [experimentalMidi]);

	useEffect(() => {
		if (!experimentalMidi || midiState.recording.status !== 'recording') return undefined;
		const service = midiServiceRef.current;
		if (!service) return undefined;
		const timer = window.setInterval(() => service.update(), 50);
		return () => window.clearInterval(timer);
	}, [experimentalMidi, midiState.recording.status]);

	const handleAppearanceModeChange = useCallback((mode: AppearanceMode) => {
		const nextMode = normalizeAppearanceMode(mode);
		setAppearanceMode(nextMode);
		try {
			if (nextMode === 'system') window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
			else window.localStorage.setItem(APPEARANCE_STORAGE_KEY, nextMode);
		} catch {
			// A blocked storage area should not prevent the in-session override.
		}
	}, []);

	useEffect(() => {
		if (typeof window === 'undefined') return undefined;
		const media = window.matchMedia('(prefers-color-scheme: dark)');
		const updatePreference = () => setSystemPrefersDark(media.matches);
		updatePreference();
		if (typeof media.addEventListener === 'function') {
			media.addEventListener('change', updatePreference);
			return () => media.removeEventListener('change', updatePreference);
		}
		media.addListener(updatePreference);
		return () => media.removeListener(updatePreference);
	}, []);

	useEffect(() => {
		if (typeof document === 'undefined') return;
		const theme = isDarkMode ? 'dark' : 'light';
		document.documentElement.dataset.theme = theme;
		document.documentElement.style.colorScheme = theme;
		document.querySelector('meta[name="theme-color"]')?.setAttribute('content', isDarkMode ? '#090b0c' : '#f4f6f3');
	}, [isDarkMode]);

	const handleEditorResizePointerMove = useCallback((event: PointerEvent) => {
		const drag = editorResizeRef.current;
		if (!drag) return;
		const requestedWidth = drag.startWidth + event.clientX - drag.startX;
		let mode: WorkspaceMode = 'split';
		let width: number;
		if (requestedWidth <= EDITOR_EDGE_SNAP_PX) {
			mode = 'arrangement';
			width = 0;
		} else if (requestedWidth >= drag.bodyWidth - EDITOR_EDGE_SNAP_PX) {
			mode = 'code';
			width = drag.bodyWidth - 10;
		} else {
			const maxSplitWidth = Math.min(EDITOR_WIDTH_MAX, Math.max(EDITOR_WIDTH_MIN, drag.bodyWidth - 10));
			width = clamp(requestedWidth, EDITOR_WIDTH_MIN, maxSplitWidth);
		}

		// Keep the pointer loop out of React. The timeline is a large subtree, so
		// committing editor width on every pointermove makes the divider chase a
		// queue of expensive renders. The browser can resize the grid directly;
		// React commits the final value once the gesture ends.
		drag.mode = mode;
		drag.currentWidth = width;
		drag.body.style.setProperty('--editor-width', `${width}px`);
		drag.body.classList.toggle('workspace-mode-preview-split', mode === 'split');
		drag.body.classList.toggle('workspace-mode-preview-code', mode === 'code');
		drag.body.classList.toggle('workspace-mode-preview-arrangement', mode === 'arrangement');
	}, []);

	const stopEditorResize = useCallback(() => {
		const drag = editorResizeRef.current;
		if (!drag) return;
		editorResizeRef.current = null;
		window.removeEventListener('pointermove', handleEditorResizePointerMove);
		window.removeEventListener('pointerup', stopEditorResize);
		window.removeEventListener('pointercancel', stopEditorResize);
		if (drag.mode === 'split') {
			setEditorWidth(drag.currentWidth);
			const viewportWidth = timelineViewportRef.current?.clientWidth;
			if (viewportWidth !== undefined) setTimelineViewportWidth((current) => current === viewportWidth ? current : viewportWidth);
		}
		setWorkspaceMode(drag.mode);
		window.requestAnimationFrame(() => {
			if (editorResizeRef.current) return;
			drag.body.classList.remove('studio-body-resizing', 'workspace-mode-preview-split', 'workspace-mode-preview-code', 'workspace-mode-preview-arrangement');
			drag.body.dispatchEvent(new Event(STUDIO_LAYOUT_SETTLED_EVENT));
		});
	}, [handleEditorResizePointerMove]);

	const startEditorResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		const body = studioBodyRef.current;
		if (!body) return;
		const sourceSidebar = body?.querySelector<HTMLElement>('.source-sidebar');
		const bodyWidth = body.getBoundingClientRect().width;
		const startWidth = workspaceMode === 'code'
			? Math.max(0, bodyWidth - 10)
			: workspaceMode === 'arrangement'
				? 0
				: sourceSidebar?.getBoundingClientRect().width ?? editorWidth;
		editorResizeRef.current = {
			startX: event.clientX,
			startWidth,
			bodyWidth: bodyWidth || window.innerWidth,
			currentWidth: startWidth,
			mode: workspaceMode,
			body,
		};
		body.classList.add('studio-body-resizing');
		body.classList.remove('workspace-mode-preview-split', 'workspace-mode-preview-code', 'workspace-mode-preview-arrangement');
		window.addEventListener('pointermove', handleEditorResizePointerMove);
		window.addEventListener('pointerup', stopEditorResize);
		window.addEventListener('pointercancel', stopEditorResize);
	}, [editorWidth, handleEditorResizePointerMove, stopEditorResize, workspaceMode]);

	const commitTimelineViewportWidth = useCallback(() => {
		const viewport = timelineViewportRef.current;
		if (!viewport) return;
		const width = viewport.clientWidth;
		setTimelineViewportWidth((current) => current === width ? current : width);
	}, []);

	const finishWorkspaceLayoutTransition = useCallback(() => {
		if (!workspaceLayoutTransitionRef.current) return;
		workspaceLayoutTransitionRef.current = false;
		if (workspaceLayoutTransitionTimerRef.current !== undefined) {
			window.clearTimeout(workspaceLayoutTransitionTimerRef.current);
			workspaceLayoutTransitionTimerRef.current = undefined;
		}
		studioBodyRef.current?.classList.remove('studio-body-layout-transitioning');
		studioBodyRef.current?.dispatchEvent(new Event(STUDIO_LAYOUT_SETTLED_EVENT));
		// Measure once, after the grid has settled, instead of rerendering the
		// whole timeline for every frame of the layout transition.
		commitTimelineViewportWidth();
	}, [commitTimelineViewportWidth]);

	const beginWorkspaceLayoutTransition = useCallback((mode: WorkspaceMode) => {
		if (mode === workspaceMode && !workspaceLayoutTransitionRef.current) return;
		if (workspaceLayoutTransitionTimerRef.current !== undefined) {
			window.clearTimeout(workspaceLayoutTransitionTimerRef.current);
		}
		workspaceLayoutTransitionRef.current = true;
		studioBodyRef.current?.classList.add('studio-body-layout-transitioning');
		setWorkspaceMode(mode);
		workspaceLayoutTransitionTimerRef.current = window.setTimeout(
			finishWorkspaceLayoutTransition,
			WORKSPACE_LAYOUT_TRANSITION_FALLBACK_MS,
		);
	}, [finishWorkspaceLayoutTransition, workspaceMode]);

	const handleEditorResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
		event.preventDefault();
		if (event.key === 'Home') {
			beginWorkspaceLayoutTransition('arrangement');
			return;
		}
		if (event.key === 'End') {
			beginWorkspaceLayoutTransition('code');
			return;
		}
		const currentWidth = workspaceMode === 'arrangement' ? EDITOR_WIDTH_MIN : workspaceMode === 'code' ? EDITOR_WIDTH_MAX : editorWidth;
		beginWorkspaceLayoutTransition('split');
		setEditorWidth(clamp(currentWidth + (event.key === 'ArrowRight' ? 16 : -16), EDITOR_WIDTH_MIN, EDITOR_WIDTH_MAX));
	}, [beginWorkspaceLayoutTransition, editorWidth, workspaceMode]);

	const handleWorkspaceModeChange = useCallback((mode: WorkspaceMode) => {
		beginWorkspaceLayoutTransition(mode);
	}, [beginWorkspaceLayoutTransition]);

	const patchStudio = useCallback((patch: Partial<StudioState>) => {
		const next = { ...studioRef.current, ...patch };
		studioRef.current = next;
		setStudio(next);
	}, []);

	const patchRuntime = useCallback((update: AdapterRuntimeUpdate) => {
		if (experimentalMidi && update.transport && update.transport !== 'playing') {
			adapterRef.current?.releaseAllLiveMidiNotes();
			if (update.transport === 'stopped') midiServiceRef.current?.panic();
		}
		const runtime = { ...studioRef.current.runtime, ...update };
		const next = { ...studioRef.current, runtime };
		studioRef.current = next;
		// The adapter publishes its scheduler position every 50ms. Keeping that
		// value in the ref lets seeking and transport commands stay current without
		// re-rendering the entire editor while audio is playing. The lightweight
		// playhead/readout loop below paints the live position directly.
		const onlyCurrentCycle = Object.keys(update).every((key) => key === 'currentCycle');
		if (onlyCurrentCycle && runtime.transport === 'playing') return;
		setStudio(next);
	}, [experimentalMidi]);

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

	const applyEditorEvaluation = useCallback((update: StrudelEvaluationUpdate) => {
		editorEvaluationRef.current = update;
		const editor = sourceEditorViewRef.current;
		const editorModule = editorModuleRef.current;
		if (!editor || !editorModule) return;
		// Strudel evaluates asynchronously while React updates the editor
		// document separately. Never apply ranges from one source to another;
		// CodeMirror throws when a stale range exceeds the current document.
		if (editor.state.doc.toString() !== update.code) return;
		const widgets = update.meta?.widgets ?? [];
		try {
			editorModule.updateSliderWidgets(editor, widgets.filter((widget) => widget.type === 'slider'));
			editorModule.updateWidgets(editor, widgets.filter((widget) => widget.type !== 'slider'));
			editorModule.updateMiniLocations(editor, update.meta?.miniLocations ?? []);
		} catch (error) {
			// Editor decorations are auxiliary UI. A malformed third-party range
			// must not tear down the studio or the source editor.
			console.warn('[sushi] could not apply Strudel editor metadata', error);
		}
	}, []);

	const handleEditorReady = useCallback(() => {
		const update = editorEvaluationRef.current;
		if (update) applyEditorEvaluation(update);
	}, [applyEditorEvaluation]);

	const loadEditorModule = useCallback(() => {
		const attempt = editorLoadAttemptRef.current + 1;
		editorLoadAttemptRef.current = attempt;
		editorModuleRef.current = null;
		setEditorModule(null);
		setEditorModuleError(null);
		void import('@strudel/codemirror').then((loadedEditorModule) => {
			if (editorLoadAttemptRef.current !== attempt) return;
			editorModuleRef.current = loadedEditorModule;
			setEditorModule(loadedEditorModule);
			const update = editorEvaluationRef.current;
			if (update) applyEditorEvaluation(update);
		}).catch((error) => {
			if (editorLoadAttemptRef.current !== attempt) return;
			console.error('[sushi] could not load the Strudel code editor', error);
			setEditorModuleError(error instanceof Error ? error.message : String(error));
		});
	}, [applyEditorEvaluation]);

	useEffect(() => {
		loadEditorModule();
		return () => {
			editorLoadAttemptRef.current += 1;
		};
	}, [loadEditorModule]);

	useEffect(() => {
		const generation = studioGenerationRef.current + 1;
		studioGenerationRef.current = generation;
		mountedRef.current = true;
		const adapter = new StrudelAdapter(patchRuntime, undefined, applyEditorEvaluation, undefined, { enableMidi: experimentalMidi });
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
			restoredProjectRef.current = Boolean(storedProject && !isUntouchedLegacySeed);
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
	}, [applyEditorEvaluation, experimentalMidi, patchRuntime, patchStudio]);

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

	const preserveCurrentProjectBeforeBlank = useCallback(async (): Promise<boolean> => {
		const current = studioRef.current;
		if (current.persistenceState !== 'ready') return false;
		const generation = studioGenerationRef.current;
		const snapshot = snapshotFromStudio(current);
		const preservedProjectId = createProjectId();
		const preservedSnapshot: StoredProjectSnapshot = {
			...snapshot,
			project: {
				...snapshot.project,
				id: preservedProjectId,
				name: `${snapshot.project.name.trim() || 'Sushi project'} (before blank)`,
			},
		};

		try {
			await persistenceQueueRef.current;
			if (!mountedRef.current || studioGenerationRef.current !== generation) return false;
			await saveProjectSnapshot(preservedProjectId, preservedSnapshot);
			return true;
		} catch (error) {
			if (mountedRef.current && studioGenerationRef.current === generation) {
				patchStudio({
					persistenceState: 'unavailable',
					diagnostics: [getErrorDiagnostic(current.revision, error, 'commit', current.draft)],
				});
			}
			return false;
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
				const wasPlaying = current.runtime.transport === 'playing';
				let result: AdapterResult;
				try {
					// Re-evaluation tears down the active Strudel pattern. Panic first so
					// external instruments cannot retain a note while the new source is
					// validated and the accepted pattern is restored.
					if (experimentalMidi && (studioRef.current.runtime.transport !== 'stopped' || midiServiceRef.current?.getState().clockRunning)) {
						midiServiceRef.current?.panic();
						adapter.releaseAllLiveMidiNotes();
					}
					result = await adapter.evaluateSource(source, {
						autoplay: false,
						restoreSource: current.lastValid,
					});
				} catch (error) {
					result = { ok: false, error };
				}
				if (experimentalMidi && wasPlaying && studioRef.current.runtime.transport === 'playing') midiServiceRef.current?.startTransportClock();

				if (!mountedRef.current || studioGenerationRef.current !== operationGeneration) return { ok: false, changed: false, previousSource, source, revision };
				if (result.ok) {
					if (experimentalMidi) {
						midiServiceRef.current?.setTempo(getSourceGlobals(source).bpm);
						if (externalMidiCpsRef.current !== null) adapter.setRuntimeCps(externalMidiCpsRef.current);
					}
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
		[bumpSourceHistory, experimentalMidi, patchStudio, persistStudioSnapshot],
	);

	const cancelPendingTrackCommit = useCallback(() => {
		if (trackCommitTimerRef.current !== null) {
			clearTimeout(trackCommitTimerRef.current);
			trackCommitTimerRef.current = null;
		}
		pendingTrackSourceRef.current = null;
	}, []);

	const handleEditorPaste = useCallback(
		(source: string, _caret: number) => {
			const current = studioRef.current;
			const baseRevision = current.revision;
			cancelPendingTrackCommit();
			patchStudio({
				draft: source,
				...(current.diagnostics.length ? { diagnostics: [], phase: 'ready' as const } : {}),
			});
			// A complete paste is an intentional source replacement. Validate it as
			// one transaction so the timeline follows the pasted song immediately;
			// invalid source stays a draft and is surfaced with diagnostics.
			void commitSource(source, { expectedRevision: baseRevision });
		},
		[cancelPendingTrackCommit, commitSource, patchStudio],
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

	const createTrack = useCallback(async (kind: 'audio' | 'midi'): Promise<string | null> => {
		if (kind === 'midi' && !experimentalMidi) return null;
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
		const marker = kind === 'midi'
			? JSON.stringify({ id: trackId, name: 'MIDI Track', type: 'midi', instrument: 'sine', generated: 'midi-recording', schema: 1 })
			: JSON.stringify({ id: trackId, name: 'untitled', type: 'synth', schema: 1 });
		const expression = kind === 'midi'
			? `$: ${MIDI_GENERATED_REGION_START} silence ${MIDI_GENERATED_REGION_END}`
			: getNewAudioTrackExpression(experimentalMidi);
		const nextSource = `${currentSource}\n\n// @sushi-track ${marker}\n${expression}\n`;
		const result = await commitSource(nextSource, { expectedRevision: baseRevision });
		if (!result.ok) return null;
		if (experimentalMidi) setSelectedTrackId(trackId);
		if (kind === 'midi') setFxDrawerTrackId(trackId);
		return trackId;
	}, [cancelPendingTrackCommit, commitSource, experimentalMidi]);
	const addAudioTrack = useCallback(() => { void createTrack('audio'); }, [createTrack]);
	const addMidiTrack = useCallback(() => { void createTrack('midi'); }, [createTrack]);

	const updateSourceDraft = useCallback(
		(update: (source: string) => string): boolean => {
			const currentSource = studioRef.current.draft;
			const nextSource = update(currentSource);
			if (nextSource === currentSource) return false;
			const baseRevision = studioRef.current.revision;
			patchStudio({
				draft: nextSource,
				...(studioRef.current.diagnostics.length ? { diagnostics: [], phase: 'ready' as const } : {}),
			});
			queueTrackCommit(nextSource, baseRevision);
			return true;
		},
		[patchStudio, queueTrackCommit],
	);

	const updateTrackSource = useCallback(
		(_trackId: string, update: (source: string) => string) => updateSourceDraft(update),
		[updateSourceDraft],
	);

	const setTrackRange = useCallback(
		(trackId: string, startCycle: number, endCycle: number, dragBase?: Pick<TimingDrag, 'source' | 'startCycle' | 'endCycle'>) => {
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
			const mutationSource = dragBase?.source ?? sourceForTrackMutation(current);
			const currentTrack = getSourceBlockDetails(mutationSource).find((track) => track.id === trackId);
			const currentTiming = currentTrack ? getTrackTimingForTimeline(currentTrack, current.songEndCycle) : undefined;
			const baseStartCycle = dragBase?.startCycle ?? currentTiming?.startCycle;
			const baseEndCycle = dragBase?.endCycle ?? currentTiming?.endCycle;
			const sameStart = baseStartCycle !== undefined && Math.abs(range.startCycle - baseStartCycle) < 0.000001;
			const extendsEnd = sameStart && baseEndCycle !== undefined && range.endCycle > baseEndCycle;
			const shrinksEnd = sameStart && baseEndCycle !== undefined && range.endCycle < baseEndCycle;
			const adjusted = !experimentalMidi || baseEndCycle === undefined
				? mutationSource
				: extendsEnd
					? extendNoteGridSourceRange(mutationSource, trackId, baseEndCycle, range.endCycle)
					: shrinksEnd ? trimNoteGridSourceRange(mutationSource, trackId, range.endCycle) : mutationSource;
			const nextSource = updateSourceTrackRange(adjusted, trackId, range.startCycle, range.endCycle, getSourceCycleStep(adjusted));
			if (dragBase) {
				if (nextSource === current.draft) return;
				patchStudio({
					draft: nextSource,
					...(current.diagnostics.length ? { diagnostics: [], phase: 'ready' as const } : {}),
				});
				// Keep drag previews in the draft, but validate only the final range
				// on pointer-up. Otherwise an intermediate pointer event can commit
				// first and make the next event conflict against its old revision.
				pendingTrackSourceRef.current = { source: nextSource, baseRevision: current.revision };
				return;
			}
			updateTrackSource(trackId, () => nextSource);
		},
		[experimentalMidi, patchStudio, persistStudioSnapshot, updateTrackSource],
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
		(bpm: number): void => { updateGlobalSource((source) => updateSourceBpm(source, bpm)); },
		[updateGlobalSource],
	);

	const setKey = useCallback(
		(key: string): void => { updateGlobalSource((source) => updateSourceKey(source, key)); },
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
			const currentTrack = getSourceBlockDetails(source).find((track) => track.id === trackId);
			const currentTiming = currentTrack ? getTrackTimingForTimeline(currentTrack, current.songEndCycle) : undefined;
			const previousEndCycle = currentTiming?.endCycle;
			const sameStart = currentTiming !== undefined && Math.abs(range.startCycle - currentTiming.startCycle) < 0.000001;
			const extendsEnd = sameStart && currentTiming !== undefined && range.endCycle > currentTiming.endCycle;
			const shrinksEnd = sameStart && currentTiming !== undefined && range.endCycle < currentTiming.endCycle;
			const adjusted = !experimentalMidi || previousEndCycle === undefined
				? source
				: extendsEnd
					? extendNoteGridSourceRange(source, trackId, previousEndCycle, range.endCycle)
					: shrinksEnd ? trimNoteGridSourceRange(source, trackId, range.endCycle) : source;
			const nextSource = updateSourceTrackRange(adjusted, trackId, range.startCycle, range.endCycle);
			if (nextSource === source) {
				return { ok: true, changed: false, previousSource: source, source, revision: current.revision };
			}
			return commitSource(nextSource);
		},
		[cancelPendingTrackCommit, commitSource, experimentalMidi],
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
			if (result.ok) {
				setSelectedTrackId((selected) => selected === trackId ? null : selected);
				setNoteEditorTrackId((selected) => selected === trackId ? null : selected);
			}
			return result;
		},
		[cancelPendingTrackCommit, commitSource],
	);

	const handleTimingPointerMove = useCallback(
		(event: PointerEvent) => {
			const drag = timingDragRef.current;
			if (!drag) return;

			// Accumulate pointer movement instead of remapping the absolute
			// pointer position on every event. The timeline can grow while the
			// pointer is outside its old boundary, which changes the grid scale;
			// accumulating keeps the drag target stable across that reflow.
			drag.pointerCycle = Math.max(0, drag.pointerCycle + ((event.clientX - drag.lastPointerClientX) / drag.laneWidth) * drag.songEndCycle);
			drag.lastPointerClientX = event.clientX;
			const nextCycle = Math.max(0, snapCycle(drag.pointerCycle));
			let range: { startCycle: number; endCycle: number };

			if (drag.edge === 'move') {
				const delta = nextCycle - drag.pointerStartCycle;
				range = shiftTrackRange(drag.startCycle, drag.endCycle, delta);
			} else {
				const startCycle = drag.edge === 'start' ? Math.min(nextCycle, drag.endCycle - TIMELINE_SNAP_CYCLE) : drag.startCycle;
				const endCycle = drag.edge === 'end' ? Math.max(nextCycle, drag.startCycle + TIMELINE_SNAP_CYCLE) : drag.endCycle;
				range = { startCycle: Math.max(0, startCycle), endCycle: Math.max(0, endCycle) };
			}

			drag.currentStartCycle = range.startCycle;
			drag.currentEndCycle = range.endCycle;
			const clipStart = clamp(range.startCycle / drag.songEndCycle, 0, 1);
			const clipEnd = clamp(range.endCycle / drag.songEndCycle, clipStart + 0.01, 1);
			drag.region.style.setProperty('--clip-start', `${clipStart * 100}%`);
			drag.region.style.setProperty('--clip-width', `${Math.max(0.01, clipEnd - clipStart) * 100}%`);
		},
		[],
	);

	const stopTimingDrag = useCallback(() => {
		const drag = timingDragRef.current;
		timingDragRef.current = null;
		window.removeEventListener('pointermove', handleTimingPointerMove);
		window.removeEventListener('pointerup', stopTimingDrag);
		window.removeEventListener('pointercancel', stopTimingDrag);
		if (drag) {
			drag.region.classList.remove('pattern-region-resizing');
			drag.region.dispatchEvent(new Event(STUDIO_LAYOUT_SETTLED_EVENT, { bubbles: true }));
			setTrackRange(drag.trackId, drag.currentStartCycle, drag.currentEndCycle, drag);
		}
		const pending = pendingTrackSourceRef.current;
		if (pending) {
			pendingTrackSourceRef.current = null;
			void commitSource(pending.source, { expectedRevision: pending.baseRevision });
		}
	}, [commitSource, handleTimingPointerMove, setTrackRange]);

	const startTimingDrag = useCallback(
		(event: ReactPointerEvent<HTMLElement>, trackId: string, edge: 'start' | 'end' | 'move') => {
			const lane = event.currentTarget.closest('.lane-grid');
			if (!(lane instanceof HTMLElement)) return;
			const region = event.currentTarget.closest('.pattern-region');
			if (!(region instanceof HTMLElement)) return;
			const rect = lane.getBoundingClientRect();
			if (!rect.width) return;
			const details = getSourceBlockDetails(studioRef.current.draft).find((block) => block.id === trackId);
			if (!details) return;
			const timing = getTrackTimingForTimeline(details, studioRef.current.songEndCycle);
			const source = sourceForTrackMutation(studioRef.current);
			cancelPendingTrackCommit();
			event.preventDefault();
			event.stopPropagation();
			region.classList.add('pattern-region-resizing');
			const pointerCycle = rect.width
				? Math.max(0, ((event.clientX - rect.left) / rect.width) * studioRef.current.songEndCycle)
				: timing.startCycle;
			timingDragRef.current = {
				trackId,
				edge,
				source,
				lane,
				laneWidth: rect.width,
				songEndCycle: studioRef.current.songEndCycle,
				region,
				pointerStartCycle: snapCycle(pointerCycle),
				startCycle: timing.startCycle,
				endCycle: timing.endCycle,
				currentStartCycle: timing.startCycle,
				currentEndCycle: timing.endCycle,
				pointerCycle,
				lastPointerClientX: event.clientX,
			};
			window.addEventListener('pointermove', handleTimingPointerMove);
			window.addEventListener('pointerup', stopTimingDrag);
			window.addEventListener('pointercancel', stopTimingDrag);
		},
		[cancelPendingTrackCommit, handleTimingPointerMove, stopTimingDrag],
	);

	useEffect(() => stopTimingDrag, [stopTimingDrag]);
	useEffect(() => stopEditorResize, [stopEditorResize]);

	useEffect(() => {
		const body = studioBodyRef.current;
		if (!body) return undefined;
		const handleTransitionEnd = (event: TransitionEvent) => {
			if (event.target !== body || event.propertyName !== 'grid-template-columns') return;
			finishWorkspaceLayoutTransition();
		};
		body.addEventListener('transitionend', handleTransitionEnd);
		return () => body.removeEventListener('transitionend', handleTransitionEnd);
	}, [finishWorkspaceLayoutTransition]);

	useEffect(() => () => {
		if (workspaceLayoutTransitionTimerRef.current !== undefined) {
			window.clearTimeout(workspaceLayoutTransitionTimerRef.current);
			workspaceLayoutTransitionTimerRef.current = undefined;
		}
		workspaceLayoutTransitionRef.current = false;
		studioBodyRef.current?.classList.remove('studio-body-layout-transitioning');
	}, []);

	useEffect(() => {
		const viewport = timelineViewportRef.current;
		if (!viewport) return undefined;
		const updateViewportWidth = () => {
			// During a divider drag or layout transition the outer grid is allowed
			// to move without asking the timeline to recalculate every frame.
			if (editorResizeRef.current || workspaceLayoutTransitionRef.current) return;
			commitTimelineViewportWidth();
		};
		updateViewportWidth();
		if (typeof ResizeObserver === 'undefined') {
			window.addEventListener('resize', updateViewportWidth);
			return () => window.removeEventListener('resize', updateViewportWidth);
		}
		const observer = new ResizeObserver(updateViewportWidth);
		observer.observe(viewport);
		return () => observer.disconnect();
	}, [commitTimelineViewportWidth]);

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
		(trackId: string, effectId: string, value: SourceEffectValue, parameterIndex?: number) => updateTrackSource(trackId, (source) => updateTrackEffect(source, trackId, effectId, value, parameterIndex)),
		[updateTrackSource],
	);

	const toggleTrackEffectInSource = useCallback(
		(trackId: string, effectId: string, enabled: boolean) => updateTrackSource(trackId, (source) => toggleTrackEffect(source, trackId, effectId, enabled)),
		[updateTrackSource],
	);

	const toggleTrackEffectsInSource = useCallback(
		(trackId: string, enabled: boolean) => updateTrackSource(trackId, (source) => setSourceTrackEffectsEnabled(source, trackId, enabled)),
		[updateTrackSource],
	);

	const reorderTrackEffectInSource = useCallback(
		(trackId: string, effectId: string, direction: 'up' | 'down') => updateTrackSource(trackId, (source) => reorderTrackEffect(source, trackId, effectId, direction)),
		[updateTrackSource],
	);

	const addTrackEffectToSource = useCallback(
		(trackId: string, method: TrackEffectMethod) => updateTrackSource(trackId, (source) => addTrackEffect(source, trackId, method)),
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

	const setTrackSound = useCallback(
		(trackId: string, value: string, soundId?: string) => updateTrackSource(trackId, (source) => updateSourceTrackSound(source, trackId, value, soundId)),
		[updateTrackSource],
	);

	const setTrackMidiRoute = useCallback(
		(trackId: string, output: string | number | null | undefined, channel: number, enabled: boolean, settings: Pick<TrackMidiRouteUpdate, 'instrument' | 'velocity' | 'gain' | 'noteOffsetMs' | 'midimap' | 'program'> = {}) => {
			if (!experimentalMidi) return false;
			return updateTrackSource(trackId, (source) => updateTrackMidiRoute(source, trackId, { output, channel, enabled, ...settings }));
		},
		[experimentalMidi, updateTrackSource],
	);
	const setMidiInstrument = useCallback(
		(trackId: string, instrument: string | null) => {
			if (!experimentalMidi) return false;
			return updateTrackSource(trackId, (source) => updateTrackInstrument(source, trackId, instrument));
		},
		[experimentalMidi, updateTrackSource],
	);
	const commitTrackMidiRoute = useCallback(
		async (trackId: string, output: string | number | null | undefined, channel: number, enabled: boolean, settings: Pick<TrackMidiRouteUpdate, 'instrument' | 'velocity' | 'gain' | 'noteOffsetMs' | 'midimap' | 'program'> = {}, expectedRevision?: number): Promise<CommitSourceResult> => {
			const current = studioRef.current;
			if (!experimentalMidi) {
				return { ok: false, changed: false, previousSource: current.draft, source: current.draft, revision: current.revision, error: diagnosticFromError(current.revision, new Error('Experimental MIDI is disabled.'), current.draft) };
			}
			cancelPendingTrackCommit();
			const source = sourceForTrackMutation(current);
			const nextSource = updateTrackMidiRoute(source, trackId, { output, channel, enabled, ...settings });
			if (nextSource === source) return { ok: true, changed: false, previousSource: source, source, revision: current.revision };
			return commitSource(nextSource, expectedRevision === undefined ? {} : { expectedRevision });
		},
		[cancelPendingTrackCommit, commitSource, experimentalMidi],
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
		const imported = rebaseProjectSnapshotRevision(normalizeImportedSnapshot(snapshot), studioRef.current.revision);
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
		if (experimentalMidi) midiServiceRef.current?.panic();
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
		if (experimentalMidi) {
			midiServiceRef.current?.setTempo(getSourceGlobals(imported.project.source.lastValid).bpm);
			if (externalMidiCpsRef.current !== null) adapter.setRuntimeCps(externalMidiCpsRef.current);
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
	}, [bumpSourceHistory, cancelPendingTrackCommit, experimentalMidi, patchStudio, persistStudioSnapshot, refreshLocalProjects]);

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

	const loadEditorPreset = useCallback(async (preset: EditorPreset, expectedRevision = studioRef.current.revision): Promise<CommitSourceResult> => {
		cancelPendingTrackCommit();
		const result = await commitSource(preset.source, { expectedRevision });
		if (!result.ok) return result;

		const presetEndCycle = getTimelineCapacityForEndCycle(Math.max(DEFAULT_SONG_END_CYCLE, getExplicitSourceEndCycle(preset.source)));
		adapterRef.current?.setSongEndCycle(presetEndCycle);
		patchStudio({ projectName: preset.name, songEndCycle: presetEndCycle });
		setOpenHeaderPopover(null);
		await persistStudioSnapshot();
		void refreshLocalProjects();
		return result;
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
		setNoteEditorTrackId((openTrackId) => openTrackId && openTrackId !== trackId ? null : openTrackId);
		setContextMenu(null);
		setFxDrawerTrackId((current) => current ? trackId : current);
	}, []);

	const openTrackFxDrawer = useCallback((trackId: string) => {
		setSelectedTrackId(trackId);
		setContextMenu(null);
		setFxDrawerTrackId((current) => current === trackId ? null : trackId);
	}, []);

	const beginTrackRename = useCallback((trackId: string) => {
		const track = getSourceBlocks(studioRef.current.lastValid).find((block) => block.id === trackId);
		if (!track) return;
		selectTrack(trackId);
		setContextMenu(null);
		setRenamingTrackId(trackId);
		setRenamingTrackValue(track.name);
	}, [selectTrack]);

	const cancelTrackRename = useCallback(() => {
		setRenamingTrackId(null);
		setRenamingTrackValue('');
	}, []);

	const openNoteEditor = useCallback((trackId: string) => {
		if (!experimentalMidi) return;
		if (!getSourceBlocks(studioRef.current.lastValid).some((track) => track.id === trackId)) return;
		cancelTrackRename();
		setSelectedTrackId(trackId);
		setContextMenu(null);
		setNoteEditorTrackId(trackId);
	}, [cancelTrackRename, experimentalMidi]);

	const closeNoteEditor = useCallback(() => {
		setNoteEditorTrackId(null);
	}, []);

	const updateTrackNoteGrid = useCallback(
		(trackId: string, edit: NoteGridEdit) => {
			if (!experimentalMidi) return false;
			return updateTrackSource(trackId, (source) => updateNoteGridSource(source, trackId, edit));
		},
		[experimentalMidi, updateTrackSource],
	);

	const previewTrackNote = useCallback((midi: number, sound: string) => {
		if (!experimentalMidi) return;
		void adapterRef.current?.previewNote(midiToNoteName(midi), sound);
	}, [experimentalMidi]);

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
		const menuHeight = experimentalMidi ? 320 : 280;
		const maxX = Math.max(8, window.innerWidth - menuWidth - 8);
		const maxY = Math.max(8, window.innerHeight - menuHeight - 8);
		setContextMenu({ trackId, x: Math.min(Math.max(8, event.clientX), maxX), y: Math.min(Math.max(8, event.clientY), maxY) });
	}, [experimentalMidi, selectTrack]);

	const handleTrackLaneKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>, trackId: string) => {
			if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
			event.preventDefault();
			const rect = event.currentTarget.getBoundingClientRect();
			const menuWidth = 260;
			const menuHeight = experimentalMidi ? 320 : 280;
			const maxX = Math.max(8, window.innerWidth - menuWidth - 8);
			const maxY = Math.max(8, window.innerHeight - menuHeight - 8);
			selectTrack(trackId);
			setContextMenu({ trackId, x: Math.min(Math.max(8, rect.left + 24), maxX), y: Math.min(Math.max(8, rect.top + 24), maxY) });
		},
		[experimentalMidi, selectTrack],
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
					if (experimentalMidi) midiServiceRef.current?.startTransportClock();
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
				if (experimentalMidi) {
					const service = midiServiceRef.current;
					if (service) {
						const midiRecording = service.getState().recording.status;
						if (midiRecording === 'recording') service.stopRecording(getMidiClock());
						service.panic();
						if (midiRecording === 'count-in' || midiRecording === 'armed') service.cancelRecording();
					}
				}
				const result = await adapter.pause();
				if (result.ok) {
					if (experimentalMidi) midiServiceRef.current?.stopTransportClock();
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
				const wasPlaying = studioRef.current.runtime.transport === 'playing';
				const targetCycle = clamp(command.cycle, 0, studioRef.current.songEndCycle);
				if (experimentalMidi && wasPlaying) midiServiceRef.current?.panic();
				const result = await adapter.seek(targetCycle);
				if (result.ok) {
					if (experimentalMidi && wasPlaying) midiServiceRef.current?.startTransportClock();
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

			if (experimentalMidi) {
				const service = midiServiceRef.current;
				if (service) {
					const midiRecording = service.getState().recording.status;
					if (midiRecording === 'recording') {
						autoCommitMidiTakeRef.current = true;
						service.stopRecording(getMidiClock());
					}
					if (midiRecording === 'count-in' || midiRecording === 'armed') service.cancelRecording();
					service.panic();
				}
			}
			const result = await adapter.stop();
			if (result.ok) {
				if (experimentalMidi) midiServiceRef.current?.stopTransportClock();
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
		[cancelPendingTrackCommit, commitSource, experimentalMidi, getMidiClock, patchStudio],
	);

	useEffect(() => {
		if (!experimentalMidi) return undefined;
		if (midiState.recording.status !== 'review' || studio.runtime.transport !== 'playing' || autoCommitMidiTakeRef.current) return;
		void dispatch({ type: 'stop' });
	}, [dispatch, experimentalMidi, midiState.recording.status, studio.runtime.transport]);

	const completeOnboarding = useCallback(() => {
		markOnboardingCompleted();
		setOpenHeaderPopover(null);
		setOnboardingOpen(false);
	}, []);

	const openOnboarding = useCallback(() => {
		setOpenHeaderPopover(null);
		setOnboardingOpen(true);
	}, []);

	const prepareOnboardingDemo = useCallback(async (): Promise<boolean> => {
		const adapter = adapterRef.current;
		const preset = getEditorPreset(ONBOARDING_DEMO_PRESET_ID);
		if (!adapter || !preset || studioRef.current.phase === 'booting' || studioRef.current.phase === 'validating') return false;

		const unlocked = await adapter.unlockAudio();
		if (!unlocked.ok) {
			const current = studioRef.current;
			patchStudio({
				phase: 'error',
				diagnostics: [getErrorDiagnostic(current.revision, unlocked.error, 'audio', current.draft)],
				runtime: { ...current.runtime, audioState: isAudioLockedError(unlocked.error) ? 'locked' : 'error' },
			});
			return false;
		}

		// loadEditorPreset is the normal template action. Its commitSource call
		// evaluates the bundled source before it is promoted to lastValid.
		const loaded = await loadEditorPreset(preset);
		return loaded.ok;
	}, [loadEditorPreset, patchStudio]);

	const playPreparedOnboardingDemo = useCallback(() => {
		void dispatch({ type: 'play' });
	}, [dispatch]);

	const startNewBlankProject = useCallback(async (confirmed = false): Promise<boolean> => {
		const current = studioRef.current;
		const blankSnapshot = createBlankProjectSnapshot(current);
		const blankProject = blankSnapshot.project;
		const hasCurrentWork = restoredProjectRef.current
			|| current.projectName !== blankProject.name
			|| current.draft !== blankProject.source.draft
			|| current.lastValid !== blankProject.source.lastValid
			|| current.songEndCycle !== blankProject.timeline.songEndCycle
			|| current.assets.length > 0;

		if (hasCurrentWork && !confirmed) {
			const accepted = typeof window !== 'undefined' && window.confirm('Start a new blank project? Your current project will be saved locally first and remain available under Saved locally.');
			if (!accepted) return false;
		}
		if (hasCurrentWork && !(await preserveCurrentProjectBeforeBlank())) return false;

		const started = await applyProjectSnapshot(blankSnapshot);
		if (started) {
			restoredProjectRef.current = false;
			setSelectedTrackId(null);
			setFxDrawerTrackId(null);
			setNoteEditorTrackId(null);
			setContextMenu(null);
			cancelTrackRename();
		}
		return started;
	}, [applyProjectSnapshot, cancelTrackRename, preserveCurrentProjectBeforeBlank]);

	const startOnboardingBlank = useCallback((confirmed = false): Promise<boolean> => startNewBlankProject(confirmed), [startNewBlankProject]);

	const openExistingFromOnboarding = useCallback(() => {
		setOpenHeaderPopover('settings');
	}, []);

	useEffect(() => {
		if (studio.phase === 'booting') return;
		if (hasOnboardingOverride() || !readOnboardingCompletion()) setOnboardingOpen(true);
	}, [studio.phase]);

	useEffect(() => {
		const service = midiServiceRef.current;
		if (!experimentalMidi || !service) return undefined;
		const sourceCps = () => {
			const globals = getSourceGlobals(studioRef.current.lastValid);
			return Math.max(0.000001, globals.bpm / (60 * Math.max(0.000001, globals.quarterNotesPerCycle)));
		};
		const restoreSourceCps = () => {
			externalMidiCpsRef.current = null;
			adapterRef.current?.setRuntimeCps(sourceCps());
		};
		service.setExternalTransportHandler((action) => {
			if (service.getState().clockMode !== 'receive') return;
			if (action === 'stop') {
				restoreSourceCps();
				void dispatch({ type: 'stop' });
			} else void dispatch({ type: 'play' });
		});
		service.setExternalClockHandler((update) => {
			if (service.getState().clockMode !== 'receive') return;
			if (update.action === 'stop') {
				restoreSourceCps();
				return;
			}
			if (update.action === 'clock' && update.bpm !== undefined) {
				const globals = getSourceGlobals(studioRef.current.lastValid);
				externalMidiCpsRef.current = update.bpm / (60 * Math.max(0.000001, globals.quarterNotesPerCycle));
				adapterRef.current?.setRuntimeCps(externalMidiCpsRef.current);
			}
		});
		return () => {
			service.setExternalTransportHandler(undefined);
			service.setExternalClockHandler(undefined);
			restoreSourceCps();
		};
	}, [dispatch, experimentalMidi]);

	const connectMidi = useCallback((sysex = false) => {
		if (!experimentalMidi) return;
		// The Connect button is the visible gesture that may both request MIDI
		// permission and unlock the shared Strudel Web Audio context for live keys.
		void adapterRef.current?.unlockAudio();
		const service = midiServiceRef.current;
		if (!service) return;
		void service.connect({ sysex }).then(() => {
			if (studioRef.current.runtime.transport === 'playing' && service.getState().clockMode === 'send') service.startTransportClock();
		});
	}, [experimentalMidi]);
	const disconnectMidi = useCallback(() => {
		if (!experimentalMidi) return;
		adapterRef.current?.releaseAllLiveMidiNotes();
		void midiServiceRef.current?.disconnect();
	}, [experimentalMidi]);
	const refreshMidi = useCallback(() => {
		if (experimentalMidi) midiServiceRef.current?.refreshPorts();
	}, [experimentalMidi]);
	const setMidiInput = useCallback((id: string | null) => {
		if (experimentalMidi) midiServiceRef.current?.setSelectedInput(id);
	}, [experimentalMidi]);
	const setMidiOutput = useCallback((id: string | null) => {
		if (!experimentalMidi) return;
		const service = midiServiceRef.current;
		if (!service) return;
		const before = service.getState();
		if (before.clockRunning && id !== before.selectedOutputId) service.panic();
		const next = service.setSelectedOutput(id);
		if (id === null) service.stopTransportClock();
		else if (!next.lastError && studioRef.current.runtime.transport === 'playing' && next.clockMode === 'send' && (!next.clockRunning || next.selectedOutputId !== before.selectedOutputId)) service.startTransportClock();
	}, [experimentalMidi]);
	const setMidiInputChannel = useCallback((channel: MidiChannel) => {
		if (experimentalMidi) midiServiceRef.current?.setInputChannel(channel);
	}, [experimentalMidi]);
	const setMidiOutputChannel = useCallback((channel: number) => {
		if (experimentalMidi) midiServiceRef.current?.setOutputChannel(channel);
	}, [experimentalMidi]);
	const setMidiMonitor = useCallback((enabled: boolean) => {
		if (experimentalMidi) midiServiceRef.current?.setMonitor(enabled);
	}, [experimentalMidi]);
	const beginMidiControlLearn = useCallback(() => {
		if (experimentalMidi) midiServiceRef.current?.beginControlLearn();
	}, [experimentalMidi]);
	const setMidiClockMode = useCallback((mode: MidiClockMode) => {
		if (!experimentalMidi) return;
		const service = midiServiceRef.current;
		if (!service) return;
		service.setClockMode(mode);
		if (mode === 'send' && studioRef.current.runtime.transport === 'playing') service.startTransportClock();
		if (mode !== 'receive') {
			externalMidiCpsRef.current = null;
			const globals = getSourceGlobals(studioRef.current.lastValid);
			adapterRef.current?.setRuntimeCps(Math.max(0.000001, globals.bpm / (60 * Math.max(0.000001, globals.quarterNotesPerCycle))));
		}
	}, [experimentalMidi]);
	const panicMidi = useCallback(() => {
		if (!experimentalMidi) return;
		adapterRef.current?.releaseAllLiveMidiNotes();
		midiServiceRef.current?.panic();
	}, [experimentalMidi]);
	const testMidiNote = useCallback(() => {
		if (experimentalMidi) void midiServiceRef.current?.testNote();
	}, [experimentalMidi]);
	const cancelMidiRecording = useCallback(() => {
		if (!experimentalMidi) return;
		midiRecordStartTokenRef.current += 1;
		midiServiceRef.current?.cancelRecording();
	}, [experimentalMidi]);
	const retryMidiRecording = useCallback(() => {
		if (!experimentalMidi) return;
		midiRecordStartTokenRef.current += 1;
		const service = midiServiceRef.current;
		if (!service) return;
		const recording = service.getState().recording;
		if (recording.status !== 'review' || !recording.options) return;
		service.armRecording(recording.options);
	}, [experimentalMidi]);
	const startMidiRecording = useCallback(async (signal?: AbortSignal): Promise<MidiRuntimeState> => {
		if (!experimentalMidi) return createDisabledMidiRuntimeState();
		const service = midiServiceRef.current;
		if (!service) return createDisabledMidiRuntimeState();
		const armed = service.getState().recording;
		if (armed.status !== 'armed' || !armed.options) return service.getState();
		if (signal?.aborted) return service.getState();
		const token = midiRecordStartTokenRef.current + 1;
		midiRecordStartTokenRef.current = token;
		if (studioRef.current.runtime.transport !== 'playing') {
			const playback = await dispatch({ type: 'play' });
			if (!playback.ok || midiRecordStartTokenRef.current !== token || signal?.aborted) {
				service.cancelRecording();
				return service.getState();
			}
		}
		const options = service.getState().recording.options;
		if (!options || service.getState().recording.status !== 'armed') return service.getState();
		const currentCycle = getMidiClock().cycle;
		const targetCycle = options.countInBars === 0 ? currentCycle : Math.ceil(Math.max(0, currentCycle) - 0.000001) + options.countInBars;
		if (options.countInBars > 0) {
			service.setRecordingStatus('count-in');
			const reachedBoundary = await waitForMidiBoundary(getMidiClock, targetCycle, () => midiRecordStartTokenRef.current !== token || signal?.aborted === true || service.getState().recording.status !== 'count-in');
			if (!reachedBoundary || midiRecordStartTokenRef.current !== token || signal?.aborted) {
				service.cancelRecording();
				return service.getState();
			}
		}
		if (service.getState().recording.status !== (options.countInBars > 0 ? 'count-in' : 'armed') || signal?.aborted) {
			service.cancelRecording();
			return service.getState();
		}
		return service.startRecording({ options, clock: getMidiClock() });
	}, [dispatch, experimentalMidi, getMidiClock]);
	const recordMidiNow = useCallback((options: MidiRecordingOptions) => {
		if (!experimentalMidi) return;
		const service = midiServiceRef.current;
		if (!service) return;
		midiRecordStartTokenRef.current += 1;
		const track = getSourceBlockDetails(studioRef.current.lastValid).find((candidate) => candidate.id === options.trackId);
		setSelectedTrackId(options.trackId);
		setFxDrawerTrackId(options.trackId);
		const armed = service.armRecording({
			...options,
			...(options.loop && track ? { loopStartCycle: track.timing.startCycle, loopEndCycle: track.timing.endCycle } : {}),
		});
		if (armed.recording.status === 'armed') void startMidiRecording();
	}, [experimentalMidi, startMidiRecording]);
	const startMidiRecordingForController = useCallback(async (signal?: AbortSignal): Promise<ReturnType<MidiService['getState']>> => {
		return startMidiRecording(signal);
	}, [startMidiRecording]);
	const stopMidiRecording = useCallback(async (): Promise<ReturnType<MidiService['getState']>> => {
		if (!experimentalMidi) return createDisabledMidiRuntimeState();
		const service = midiServiceRef.current;
		if (!service) return createDisabledMidiRuntimeState();
		midiRecordStartTokenRef.current += 1;
		const status = service.getState().recording.status;
		if (status === 'recording') service.stopRecording(getMidiClock());
		else if (status === 'armed' || status === 'count-in') service.cancelRecording();
		if (status === 'recording' || status === 'count-in') await dispatch({ type: 'stop' });
		return service.getState();
	}, [dispatch, experimentalMidi, getMidiClock]);
	const commitMidiTake = useCallback(async (expectedRevision?: number): Promise<CommitSourceResult> => {
		const current = studioRef.current;
		const service = midiServiceRef.current;
		if (!experimentalMidi || !service) {
			return { ok: false, changed: false, previousSource: current.draft, source: current.draft, revision: current.revision, error: diagnosticFromError(current.revision, new Error('Experimental MIDI is disabled.'), current.draft) };
		}
		const recording = service.getState().recording;
		const take = recording.status === 'review' ? recording.take : null;
		if (expectedRevision !== undefined && expectedRevision !== current.revision) return { ok: false, changed: false, previousSource: current.draft, source: current.draft, revision: current.revision, conflict: { expectedRevision, actualRevision: current.revision } };
		if (!take) return { ok: false, changed: false, previousSource: current.draft, source: current.draft, revision: current.revision, error: diagnosticFromError(current.revision, new Error('There is no MIDI take waiting for review.'), current.draft) };
		if (!take.notes.length && !take.automation.length) {
			service.acceptRecording();
			const notice: SourceDiagnostic = {
				revision: current.revision,
				phase: 'audio',
				severity: 'info',
				code: 'MIDI_EMPTY_TAKE',
				message: 'Nothing was recorded; the project source and revision were not changed.',
			};
			patchStudio({ diagnostics: [...current.diagnostics, notice], phase: current.phase === 'error' ? 'error' : 'ready' });
			return { ok: true, changed: false, previousSource: current.draft, source: current.draft, revision: current.revision };
		}
		const source = sourceForTrackMutation(current);
		const midiSnapshot = service.getState();
		const existingTrack = getSourceBlockDetails(source).find((track) => track.id === take.trackId);
		const existingMidiRoute = existingTrack?.midi;
		const includeRoute = existingMidiRoute?.enabled === true;
		const selectedOutput = midiSnapshot.outputs.find((port) => port.id === midiSnapshot.selectedOutputId)?.name;
		const output = includeRoute ? (typeof existingMidiRoute?.output === 'string' ? existingMidiRoute.output : selectedOutput) : undefined;
		const written = writeMidiTakeToSource(source, take, getSourceGlobals(source), {
			instrument: existingTrack?.instrument ?? 'sine',
			outputName: output,
			channel: existingMidiRoute?.channel,
			velocity: existingMidiRoute?.velocity,
			gain: existingMidiRoute?.gain,
			noteOffsetMs: existingMidiRoute?.noteOffsetMs,
			midimap: existingMidiRoute?.midimap,
			program: existingMidiRoute?.program,
			includeRoute,
			startCycle: take.startedAtCycle,
			endCycle: Math.max(take.endedAtCycle, take.startedAtCycle + getSourceCycleStep(source)),
		});
		if (!written.ok) {
			if (written.code === 'EMPTY_TAKE') {
				service.acceptRecording();
				const notice: SourceDiagnostic = {
					revision: current.revision,
					phase: 'audio',
					severity: 'info',
					code: 'MIDI_EMPTY_TAKE',
					message: written.error,
				};
				patchStudio({ diagnostics: [...current.diagnostics, notice], phase: current.phase === 'error' ? 'error' : 'ready' });
				return { ok: true, changed: false, previousSource: current.draft, source: current.draft, revision: current.revision };
			}
			patchStudio({ phase: 'error', diagnostics: [getErrorDiagnostic(current.revision, new Error(written.error), 'commit', source)] });
			return { ok: false, changed: false, previousSource: source, source, revision: current.revision, error: diagnosticFromError(current.revision, new Error(written.error), source) };
		}
		const committed = await commitSource(written.source, { expectedRevision: expectedRevision ?? current.revision });
		if (!committed.ok) return committed;
		service.acceptRecording();
		setSelectedTrackId(take.trackId);
		return committed;
	}, [commitSource, experimentalMidi, patchStudio]);
	commitMidiTakeRef.current = commitMidiTake;
	useEffect(() => {
		if (!experimentalMidi || !autoCommitMidiTakeRef.current || midiState.recording.status !== 'review' || studio.runtime.transport === 'playing') return;
		autoCommitMidiTakeRef.current = false;
		void commitMidiTakeRef.current?.();
	}, [commitMidiTake, experimentalMidi, midiState.recording.status, studio.runtime.transport]);
	const finishMidiRecording = useCallback(async () => {
		if (!experimentalMidi) return;
		autoCommitMidiTakeRef.current = false;
		const stopped = await stopMidiRecording();
		if (stopped.recording.status === 'review') await commitMidiTake();
	}, [commitMidiTake, experimentalMidi, stopMidiRecording]);
	const toggleMidiRecord = useCallback(() => {
		if (!experimentalMidi) return;
		setMidiPanelOpen(true);
		const service = midiServiceRef.current;
		if (!service) return;
		const status = service.getState().recording.status;
		if (status === 'armed') {
			void startMidiRecording();
			return;
		}
		if (status === 'recording' || status === 'count-in') {
			void finishMidiRecording();
			return;
		}
		if (status !== 'idle') return;
		void (async () => {
			const sourceTracks = getSourceBlockDetails(studioRef.current.lastValid);
			const selected = selectedTrackIdRef.current ? sourceTracks.find((track) => track.id === selectedTrackIdRef.current && track.type === 'midi') : undefined;
			const target = selected ?? sourceTracks.find((track) => track.type === 'midi');
			const trackId = target?.id ?? await createTrack('midi');
			if (!trackId) return;
			const midi = service.getState();
			const inputId = midi.enabled && midi.selectedInputId ? midi.selectedInputId : COMPUTER_KEYBOARD_INPUT_ID;
			const armed = service.armRecording({ trackId, inputId, channel: midi.enabled ? midi.inputChannel : 1, mode: 'replace', quantize: '1/16', quantizeStrength: 1, swing: 0, countInBars: 0, loop: false, captureAutomation: false });
			if (armed.recording.status === 'armed') await startMidiRecording();
		})();
	}, [createTrack, experimentalMidi, finishMidiRecording, startMidiRecording]);

	useEffect(() => {
		return registerIfEnabled(experimentalMidi, () => {
			const handleMidiShortcut = (event: KeyboardEvent) => {
				if (event.defaultPrevented || event.key.toLowerCase() !== 'r' || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
				const target = event.target;
				if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)) return;
				const midi = midiServiceRef.current?.getState();
				if (!midi) return;
				if (!midi.enabled && midi.recording.status === 'idle') return;
				event.preventDefault();
				toggleMidiRecord();
			};
			document.addEventListener('keydown', handleMidiShortcut);
			return () => document.removeEventListener('keydown', handleMidiShortcut);
		});
	}, [experimentalMidi, toggleMidiRecord]);

	const { webmcpStatus } = useStudioWebMcp({
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
		loadTemplate: loadEditorPreset,
		midiService: experimentalMidi ? midiService : null,
		startMidiRecording: startMidiRecordingForController,
		stopMidiRecording,
		commitMidiTake,
		setTrackMidiRoute: commitTrackMidiRoute,
	});
	const paintTimelinePlayhead = useCallback((cycle: number) => {
		const state = studioRef.current;
		const songEndCycle = Math.max(0.001, state.songEndCycle);
		const currentCycle = clamp(cycle, 0, songEndCycle);
		const shell = studioShellRef.current;
		if (shell) setTimelinePlayheadPosition(shell, currentCycle / songEndCycle);
		const globals = liveSourceGlobalsRef.current ?? getSourceGlobals(state.lastValid);
		if (transportClockRef.current) transportClockRef.current.textContent = formatClock(cyclesToSeconds(currentCycle, globals));
		if (transportCycleRef.current) transportCycleRef.current.textContent = `CYCLE ${formatCycle(currentCycle)}`;
	}, []);

	const flushTimelineSeek = useCallback(async (force = false): Promise<void> => {
		if (force) timelineSeekForceRef.current = true;
		if (timelineSeekInFlightRef.current) return;
		const pendingCycle = timelineSeekPendingCycleRef.current;
		if (pendingCycle === null) return;
		const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
		const seekImmediately = timelineSeekForceRef.current;
		const elapsed = now - timelineSeekLastDispatchAtRef.current;
		if (!seekImmediately && elapsed < TIMELINE_SEEK_THROTTLE_MS) {
			if (timelineSeekDispatchTimerRef.current === undefined) {
				timelineSeekDispatchTimerRef.current = window.setTimeout(() => {
					timelineSeekDispatchTimerRef.current = undefined;
					void flushTimelineSeek();
				}, TIMELINE_SEEK_THROTTLE_MS - elapsed);
			}
			return;
		}
		if (timelineSeekDispatchTimerRef.current !== undefined) {
			window.clearTimeout(timelineSeekDispatchTimerRef.current);
			timelineSeekDispatchTimerRef.current = undefined;
		}
		timelineSeekForceRef.current = false;
		timelineSeekPendingCycleRef.current = null;
		timelineSeekInFlightRef.current = true;
		timelineSeekInFlightCycleRef.current = pendingCycle;
		timelineSeekLastDispatchAtRef.current = now;
		try {
			await dispatch({ type: 'seek', cycle: pendingCycle });
			if (timelineSeekPendingCycleRef.current === null) paintTimelinePlayhead(pendingCycle);
		} finally {
			timelineSeekInFlightRef.current = false;
			timelineSeekInFlightCycleRef.current = null;
			if (timelineSeekPendingCycleRef.current !== null) void flushTimelineSeek();
		}
	}, [dispatch, paintTimelinePlayhead]);

	const queueTimelineSeek = useCallback((cycle: number) => {
		if (timelineSeekCycleRef.current === cycle) return;
		timelineSeekCycleRef.current = cycle;
		timelineSeekPendingCycleRef.current = cycle;
		if (timelineSeekPreviewFrameRef.current === undefined) {
			timelineSeekPreviewFrameRef.current = window.requestAnimationFrame(() => {
				timelineSeekPreviewFrameRef.current = undefined;
				const previewCycle = timelineSeekCycleRef.current;
				if (previewCycle !== null) paintTimelinePlayhead(previewCycle);
			});
		}
		void flushTimelineSeek();
	}, [flushTimelineSeek, paintTimelinePlayhead]);

	const seekTimelineAtClientX = useCallback(
		(clientX: number, ruler: HTMLElement) => {
			const rect = ruler.getBoundingClientRect();
			if (!rect.width) return;
			const songEndCycle = studioRef.current.songEndCycle;
			const cycle = clamp(snapCycle(((clientX - rect.left) / rect.width) * songEndCycle), 0, songEndCycle);
			queueTimelineSeek(cycle);
		},
		[queueTimelineSeek],
	);

	const handleTimelineSeekPointerMove = useCallback(
		(event: PointerEvent) => {
			const ruler = timelineSeekDragRef.current;
			if (ruler) seekTimelineAtClientX(event.clientX, ruler);
		},
		[seekTimelineAtClientX],
	);

	const stopTimelineSeekDrag = useCallback(() => {
		const wasDragging = timelineSeekDragRef.current !== null;
		const finalCycle = timelineSeekCycleRef.current;
		timelineSeekDragRef.current = null;
		timelineSeekCycleRef.current = null;
		if (timelineSeekPreviewFrameRef.current !== undefined) {
			window.cancelAnimationFrame(timelineSeekPreviewFrameRef.current);
			timelineSeekPreviewFrameRef.current = undefined;
		}
		window.removeEventListener('pointermove', handleTimelineSeekPointerMove);
		window.removeEventListener('pointerup', stopTimelineSeekDrag);
		window.removeEventListener('pointercancel', stopTimelineSeekDrag);
		if (wasDragging && finalCycle !== null && finalCycle !== timelineSeekInFlightCycleRef.current) {
			timelineSeekPendingCycleRef.current = finalCycle;
			paintTimelinePlayhead(finalCycle);
			void flushTimelineSeek(true);
		} else if (wasDragging && finalCycle !== null) {
			paintTimelinePlayhead(finalCycle);
		}
	}, [flushTimelineSeek, handleTimelineSeekPointerMove, paintTimelinePlayhead]);

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
	const draftTrackDetails = useMemo(() => new Map(getSourceBlockDetails(studio.draft).map((block) => [block.id, block])), [studio.draft]);
	const validTrackDetails = useMemo(() => new Map(getSourceBlockDetails(studio.lastValid).map((block) => [block.id, block])), [studio.lastValid]);
	const fxDrawerTrack = useMemo(() => blocks.find((block) => block.id === fxDrawerTrackId), [blocks, fxDrawerTrackId]);
	const fxDrawerTrackDetails = fxDrawerTrack
		? draftTrackDetails.get(fxDrawerTrack.id) ?? validTrackDetails.get(fxDrawerTrack.id)
		: undefined;
	const fxDrawerTrackColor = getTrackColor(fxDrawerTrackDetails?.color);
	const contextMenuTrack = useMemo(() => blocks.find((block) => block.id === contextMenu?.trackId), [blocks, contextMenu?.trackId]);
	const contextMenuTrackDetails = contextMenu?.trackId
		? draftTrackDetails.get(contextMenu.trackId) ?? validTrackDetails.get(contextMenu.trackId)
		: undefined;
	const sourceGlobals = useMemo(() => getSourceGlobals(studio.lastValid), [studio.lastValid]);
	liveSourceGlobalsRef.current = sourceGlobals;
	useEffect(() => {
		if (experimentalMidi) midiServiceRef.current?.setTempo(sourceGlobals.bpm);
	}, [experimentalMidi, sourceGlobals.bpm]);
	const liveMidiTake = midiState.recording.status === 'recording' || midiState.recording.status === 'stopping' || midiState.recording.status === 'review'
		? midiState.recording.take
		: null;
	const noteGrids = useMemo(() => {
		if (!experimentalMidi) return new Map<string, NoteGrid>();
		const next = new Map<string, NoteGrid>();
		for (const block of blocks) {
			if (liveMidiTake?.trackId === block.id) {
				const details = validTrackDetails.get(block.id);
				if (details) {
					next.set(block.id, noteGridFromMidiTake(liveMidiTake, details.timing.startCycle, details.timing.endCycle, getSourceCycleStep(studio.lastValid), details.instrument ?? 'sine'));
					continue;
				}
			}
			const result = parseNoteGrid(studio.lastValid, block.id, sourceGlobals);
			if (result.ok) next.set(block.id, result.grid);
		}
		return next;
	}, [blocks, experimentalMidi, liveMidiTake, sourceGlobals, studio.lastValid, validTrackDetails]);
	const draftGlobals = useMemo(() => getSourceGlobals(studio.draft), [studio.draft]);
	const draftBpm = clamp(Math.round(draftGlobals.bpm), 0, 300);
	const draftKey = getKeyParts(draftGlobals.key);
	const noteEditorTrack = useMemo(() => experimentalMidi ? blocks.find((block) => block.id === noteEditorTrackId) : undefined, [blocks, experimentalMidi, noteEditorTrackId]);
	const noteEditorResult = useMemo(
		() => experimentalMidi && noteEditorTrackId && noteEditorTrack ? parseNoteGrid(studio.draft, noteEditorTrackId, draftGlobals) : null,
		[draftGlobals, experimentalMidi, noteEditorTrack, noteEditorTrackId, studio.draft],
	);
	const isDirty = studio.draft !== studio.lastValid;
	const isBusy = studio.phase === 'booting' || studio.phase === 'validating';
	const canPlay = !isBusy && studio.runtime.audioState !== 'initializing';
	const activeLaneCount = blocks.length.toString().padStart(2, '0');
	const currentSeconds = cyclesToSeconds(studio.runtime.currentCycle, sourceGlobals);
	const songEndSeconds = cyclesToSeconds(studio.songEndCycle, sourceGlobals);
	const getCurrentCycle = useCallback(() => adapterRef.current?.getCurrentCycle() ?? studioRef.current.runtime.currentCycle, []);
	const getEditorHaps = useCallback((begin: number, end: number): StrudelHap[] => adapterRef.current?.getEditorHaps(begin, end) ?? [], []);
	const getVisualizerHaps = useCallback((trackId: string, visualizer: StrudelVisualizer, begin: number, end: number): VisualizerHap[] => adapterRef.current?.getVisualizerHaps(trackId, visualizer, begin, end) ?? [], []);
	const getVisualizerScopeData = useCallback((trackId: string): ArrayLike<number> | undefined => adapterRef.current?.getVisualizerScopeData(trackId), []);
	const getVisualizerSpectrumData = useCallback((trackId: string): ArrayLike<number> | undefined => adapterRef.current?.getVisualizerSpectrumData(trackId), []);
	const cycleStep = getSourceCycleStep(studio.lastValid);
	const saveStateLabel = studio.persistenceState === 'loading' ? 'LOADING' : studio.persistenceState === 'unavailable' ? 'LOCAL ONLY' : isDirty ? 'DRAFT' : 'SAVED';
	const timelineCellCount = Math.max(1, Math.ceil(studio.songEndCycle / TIMELINE_SNAP_CYCLE));
	const timelineSongCycles = Math.max(TIMELINE_SNAP_CYCLE, studio.songEndCycle);
	const zoomOutCycles = timelineSongCycles;
	const timelineVisibleCycles = zoomOutCycles - (zoomOutCycles - 1) * (timelineZoom / 100);
	const timelineAvailableWidth = Math.max(560, (timelineViewportWidth || 960) - TIMELINE_LABEL_MIN_WIDTH);
	const timelineGridWidth = Math.max(560, timelineAvailableWidth * timelineSongCycles / timelineVisibleCycles);
	const timelineShowsQuarterBars = timelineGridWidth / Math.max(1, timelineCellCount) >= 12;
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
		const shell = studioShellRef.current;
		if (!shell) return undefined;
		let animationFrame: number | undefined;
		const updateLiveTransport = () => {
			const state = studioRef.current;
			const currentCycle = clamp(
				adapterRef.current?.getCurrentCycle() ?? state.runtime.currentCycle,
				0,
				Math.max(0, state.songEndCycle),
			);
			const songEndCycle = Math.max(0.001, state.songEndCycle);
			setTimelinePlayheadPosition(shell, clamp(currentCycle / songEndCycle, 0, 1));
			const globals = liveSourceGlobalsRef.current ?? getSourceGlobals(state.lastValid);
			if (transportClockRef.current) transportClockRef.current.textContent = formatClock(cyclesToSeconds(currentCycle, globals));
			if (transportCycleRef.current) transportCycleRef.current.textContent = `CYCLE ${formatCycle(currentCycle)}`;
			if (state.runtime.transport === 'playing') animationFrame = window.requestAnimationFrame(updateLiveTransport);
		};
		updateLiveTransport();
		return () => {
			if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
		};
	}, [studio.runtime.currentCycle, studio.runtime.transport]);

	useEffect(() => {
		if (selectedTrackId && !blocks.some((block) => block.id === selectedTrackId)) setSelectedTrackId(null);
		if (fxDrawerTrackId && !blocks.some((block) => block.id === fxDrawerTrackId)) setFxDrawerTrackId(null);
		if (contextMenu && !blocks.some((block) => block.id === contextMenu.trackId)) setContextMenu(null);
		if (renamingTrackId && !blocks.some((block) => block.id === renamingTrackId)) cancelTrackRename();
		if (fxDrawerTrackId && selectedTrackId && fxDrawerTrackId !== selectedTrackId && blocks.some((block) => block.id === selectedTrackId)) setFxDrawerTrackId(selectedTrackId);
		if (noteEditorTrackId && !blocks.some((block) => block.id === noteEditorTrackId)) setNoteEditorTrackId(null);
	}, [blocks, cancelTrackRename, contextMenu, fxDrawerTrackId, noteEditorTrackId, renamingTrackId, selectedTrackId]);

	return (
		<>
			<div className="studio-shell" ref={studioShellRef} aria-hidden={onboardingOpen ? 'true' : undefined} inert={onboardingOpen || undefined}>
			<StudioHeader
				headerRef={headerPopoverScopeRef}
				transportClockRef={transportClockRef}
				transportCycleRef={transportCycleRef}
				projectName={studio.projectName ?? 'First light'}
				persistenceState={studio.persistenceState}
				saveStateLabel={saveStateLabel}
				isDirty={isDirty}
				isBusy={isBusy}
				canPlay={canPlay}
				experimentalMidi={experimentalMidi}
				workspaceMode={workspaceMode}
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
				appearanceMode={appearanceMode}
				isDarkMode={isDarkMode}
				projectImportInputRef={projectImportInputRef}
				onNewProject={() => { void startNewBlankProject(); }}
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
				onRecordMidi={toggleMidiRecord}
				onToggleMidiPanel={() => setMidiPanelOpen((open) => !open)}
				midiPanelOpen={midiPanelOpen}
				midiState={midiState}
				onLoadPreset={(preset) => { void loadEditorPreset(preset); }}
				onLoadLocalProject={(projectId) => { void loadLocalProject(projectId); }}
				onRefreshLocalProjects={() => { void refreshLocalProjects(); }}
				onAppearanceModeChange={handleAppearanceModeChange}
				onOpenOnboarding={openOnboarding}
				onWorkspaceModeChange={handleWorkspaceModeChange}
			/>

			<div className={`studio-body workspace-mode-${workspaceMode}`} ref={studioBodyRef} style={{ '--editor-width': `${editorWidth}px` } as CSSProperties}>
				<SourceEditor
					draft={studio.draft}
					diagnostics={studio.diagnostics}
					editorModule={editorModule}
					editorError={editorModuleError}
					sourceEditorViewRef={sourceEditorViewRef}
					runtimeTransport={studio.runtime.transport}
					getCurrentCycle={getCurrentCycle}
					getEditorHaps={getEditorHaps}
					onPaste={handleEditorPaste}
					onChange={(nextDraft) => {
						patchStudio({
							draft: nextDraft,
							...(studioRef.current.diagnostics.length ? { diagnostics: [], phase: 'ready' as const } : {}),
						});
					}}
					onValidate={() => { void dispatch({ type: 'writeSource', source: studioRef.current.draft, expectedRevision: studioRef.current.revision }); }}
					onStop={() => { void dispatch({ type: 'stop' }); }}
					onReady={handleEditorReady}
					onDocumentSynced={handleEditorReady}
					onRetryEditor={loadEditorModule}
				/>
				<div className="editor-resize-divider">
					<button
						className="editor-resize-handle"
						type="button"
						onPointerDown={startEditorResize}
						onKeyDown={handleEditorResizeKeyDown}
						aria-label="Resize source editor; use Home for arrangement only or End for code only"
						aria-orientation="vertical"
						aria-valuemin={0}
						aria-valuemax={EDITOR_WIDTH_MAX}
						aria-valuenow={workspaceMode === 'arrangement' ? 0 : workspaceMode === 'code' ? EDITOR_WIDTH_MAX : editorWidth}
						aria-valuetext={workspaceMode === 'arrangement' ? 'Arrangement only' : workspaceMode === 'code' ? 'Code only' : `${editorWidth} pixels, split view`}
						title="Drag to resize; snap to code-only or arrangement-only at the edges"
					/>
				</div>

				<main className="daw-canvas" aria-label="Sushi workstation">
					<Timeline
						enableMidi={experimentalMidi}
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
						noteGrids={noteGrids}
						draftTrackDetails={draftTrackDetails}
						validTrackDetails={validTrackDetails}
						sourceGlobals={sourceGlobals}
						acceptedSourceRevision={studio.phase === 'booting' || studio.phase === 'validating' ? null : studio.activeRevision}
						runtime={studio.runtime}
						getVisualizerHaps={getVisualizerHaps}
						getVisualizerScopeData={getVisualizerScopeData}
						getVisualizerSpectrumData={getVisualizerSpectrumData}
						isBusy={isBusy}
						selectedTrackId={selectedTrackId}
						fxDrawerTrackId={fxDrawerTrackId}
						renamingTrackId={renamingTrackId}
						renamingTrackValue={renamingTrackValue}
						openPopover={openHeaderPopover}
						onTogglePopover={(popover) => setOpenHeaderPopover((current) => current === popover ? null : popover)}
						onAddAudioTrack={addAudioTrack}
						onAddMidiTrack={experimentalMidi ? addMidiTrack : undefined}
						onSetSongEndCycle={setSongEndCycle}
						onAdjustZoom={adjustTimelineZoom}
						onStartTimelineSeekDrag={startTimelineSeekDrag}
						onTimelineSeekKeyDown={handleTimelineSeekKeyDown}
						onSelectTrack={selectTrack}
						onOpenTrackFxDrawer={openTrackFxDrawer}
						onToggleTrackEffects={toggleTrackEffectsInSource}
						onOpenTrackContextMenu={openTrackContextMenu}
						onOpenNoteEditor={experimentalMidi ? openNoteEditor : undefined}
						onTrackLaneKeyDown={handleTrackLaneKeyDown}
						onStartRename={beginTrackRename}
						onRenameValueChange={setRenamingTrackValue}
						onFinishRename={(trackId, name) => { void finishTrackRename(trackId, name); }}
						onCancelRename={cancelTrackRename}
						onToggleTrackMode={toggleTrackMode}
						onSetTrackGain={setTrackGain}
						onSetTrackPan={setTrackPan}
						onStartTimingDrag={startTimingDrag}
						onSetTrackRange={setTrackRange}
					/>

					{studio.diagnostics.length ? <CanvasDiagnostic diagnostic={studio.diagnostics[0]} /> : null}
				</main>
			</div>

			{experimentalMidi && midiPanelOpen ? <MidiPanel
				state={midiState}
				tracks={blocks}
				selectedTrackId={selectedTrackId}
				trackColor={getTrackColor((selectedTrackId ? draftTrackDetails.get(selectedTrackId) ?? validTrackDetails.get(selectedTrackId) : undefined)?.color)}
				isBusy={isBusy}
				onClose={() => setMidiPanelOpen(false)}
				onConnect={connectMidi}
				onDisconnect={disconnectMidi}
				onRefresh={refreshMidi}
				onSelectInput={setMidiInput}
				onSelectOutput={setMidiOutput}
				onSetInputChannel={setMidiInputChannel}
				onSetOutputChannel={setMidiOutputChannel}
				onSetMonitor={setMidiMonitor}
				onBeginControlLearn={beginMidiControlLearn}
				onSetClockMode={setMidiClockMode}
				onPanic={panicMidi}
				onTestNote={testMidiNote}
				onRecordNow={recordMidiNow}
				onStartRecording={startMidiRecording}
				onStopRecording={finishMidiRecording}
				onCancelRecording={cancelMidiRecording}
				onRetryRecording={retryMidiRecording}
				onAcceptTake={() => { void commitMidiTake(); }}
			/> : null}

			{fxDrawerTrack ? <TrackFxDrawer
				track={fxDrawerTrack}
				experimentalMidi={experimentalMidi}
				trackColor={fxDrawerTrackColor}
				trackDetails={fxDrawerTrackDetails}
				isBusy={isBusy}
				onClose={() => setFxDrawerTrackId(null)}
				onSetSlider={setTrackSlider}
				onSetEffect={setTrackEffect}
				onToggleEffect={toggleTrackEffectInSource}
				onAddEffect={addTrackEffectToSource}
				onRemoveEffect={removeTrackEffectFromSource}
				onReorderEffect={reorderTrackEffectInSource}
				onSetSound={setTrackSound}
				midiState={midiState}
				onSetMidiRoute={setTrackMidiRoute}
				onSetMidiInstrument={setMidiInstrument}
				onOpenMidiPanel={() => setMidiPanelOpen(true)}
				onTestMidi={testMidiNote}
			/> : null}

			{experimentalMidi && noteEditorTrack && noteEditorResult ? <NoteEditor
				track={noteEditorTrack}
				trackColor={getTrackColor((draftTrackDetails.get(noteEditorTrack.id) ?? validTrackDetails.get(noteEditorTrack.id))?.color)}
				result={noteEditorResult}
				isBusy={isBusy}
				onClose={closeNoteEditor}
				onSetNote={(slot, midi, stackIndex) => updateTrackNoteGrid(noteEditorTrack.id, { type: 'set', slot, midi, stackIndex })}
				onMoveNote={(slot, targetSlot, midi, stackIndex) => updateTrackNoteGrid(noteEditorTrack.id, { type: 'move', slot, targetSlot, midi, stackIndex })}
				onDeleteNote={(slot, stackIndex) => updateTrackNoteGrid(noteEditorTrack.id, { type: 'delete', slot, stackIndex })}
				onResizeNote={(slot, durationCycles, stackIndex) => updateTrackNoteGrid(noteEditorTrack.id, { type: 'resize', slot, durationCycles, stackIndex })}
				onTrimStartNote={(slot, startCycle, stackIndex) => updateTrackNoteGrid(noteEditorTrack.id, { type: 'trim-start', slot, startCycle, stackIndex })}
				onPreviewNote={previewTrackNote}
			/> : null}

			{contextMenu && contextMenuTrack ? <TrackContextMenu
				track={contextMenuTrack}
				trackNumber={blocks.findIndex((block) => block.id === contextMenuTrack.id) + 1}
				position={{ x: contextMenu.x, y: contextMenu.y }}
				menuRef={contextMenuRef}
				trackDetails={contextMenuTrackDetails}
				onOpenNoteEditor={experimentalMidi ? openNoteEditor : undefined}
				onRename={beginTrackRename}
				onDelete={deleteSelectedTrack}
				onSetColor={setTrackColor}
			/> : null}
			</div>
			{onboardingOpen ? <OnboardingModal
				webmcpStatus={webmcpStatus}
				restoredProjectPresent={restoredProjectRef.current}
				onPrepareDemo={prepareOnboardingDemo}
				onPlayPreparedDemo={playPreparedOnboardingDemo}
				onStartBlank={startOnboardingBlank}
				onOpenExisting={openExistingFromOnboarding}
				onClose={completeOnboarding}
			/> : null}
		</>
	);
}
