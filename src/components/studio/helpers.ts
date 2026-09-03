import {
	createInitialProject,
	DEFAULT_SONG_END_CYCLE,
	EXTENDED_SONG_END_CYCLE,
	diagnosticFromError,
	getSourceBlocks,
	getSourceIdentityDiagnostics,
	LEGACY_DEFAULT_SOURCE,
	type SourceDiagnostic,
} from '../../lib/project/model';
import {
	getSourceBlockDetails,
	getSourceGlobals,
} from '../../lib/project/source-mapper';
import { getTimelineCapacityForEndCycle } from '../../lib/project/timeline';
import type { StoredProjectSnapshot } from '../../lib/project/storage';
import type {
	WebMcpMutationResult,
	WebMcpStateSnapshot,
	WebMcpTrackTarget,
} from '../../lib/webmcp/tools';
import { sourceDiff } from '../../lib/webmcp/tools';
import type { StudioState, TrackDetails } from './types';

export const SONG_LENGTH_PRESETS = [4, 8, 16, 30, 60, 120] as const;
export const TIMELINE_ZOOM_BUTTON_STEP = 10;
export const DEFAULT_TRACK_COLOR = '#dce5df';
export const SOURCE_HISTORY_LIMIT = 100;
export const EDITOR_WIDTH_MIN = 280;
export const EDITOR_WIDTH_MAX = 560;
export const TIMELINE_SNAP_CYCLE = 0.25;
export const DEFAULT_TRACK_END_CYCLE = 4;
export const TRACK_NAME_MAX_LENGTH = 80;
export const TIMELINE_LABEL_MIN_WIDTH = 270;
export const LEGACY_DEFAULT_SONG_END_CYCLES = [187, 187.5];

export interface KeyRootOption {
	value: string;
	label: string;
	alternate?: string;
}

export const KEY_ROOT_OPTIONS: KeyRootOption[] = [
	{ value: 'C', label: 'C' },
	{ value: 'C#', label: 'C#', alternate: 'D♭' },
	{ value: 'D', label: 'D' },
	{ value: 'D#', label: 'D#', alternate: 'E♭' },
	{ value: 'E', label: 'E' },
	{ value: 'F', label: 'F' },
	{ value: 'F#', label: 'F#', alternate: 'G♭' },
	{ value: 'G', label: 'G' },
	{ value: 'G#', label: 'G#', alternate: 'A♭' },
	{ value: 'A', label: 'A' },
	{ value: 'A#', label: 'A#', alternate: 'B♭' },
	{ value: 'B', label: 'B' },
];

export function createInitialStudioState(): StudioState {
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

export function snapshotFromStudio(studio: StudioState): StoredProjectSnapshot {
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

export function createBlankProjectSnapshot(current: StudioState): StoredProjectSnapshot {
	const project = createInitialProject();
	const revision = Math.max(project.source.revision, current.revision + 1);
	project.source.revision = revision;
	return { project, activeRevision: revision };
}

export function rebaseProjectSnapshotRevision(snapshot: StoredProjectSnapshot, currentRevision: number): StoredProjectSnapshot {
	const incomingRevision = snapshot.project.source.revision;
	if (incomingRevision > currentRevision) return snapshot;
	const revision = currentRevision + 1;
	const delta = revision - incomingRevision;
	return {
		...snapshot,
		project: {
			...snapshot.project,
			source: { ...snapshot.project.source, revision },
		},
		activeRevision: snapshot.activeRevision === null ? null : snapshot.activeRevision + delta,
	};
}

export function getDiagnosticLabel(diagnostic: SourceDiagnostic): string {
	return `${diagnostic.phase.toUpperCase()} / ${diagnostic.code}`;
}

export function formatRevision(revision: number | null): string {
	return revision === null ? '—' : `r${revision.toString().padStart(3, '0')}`;
}

export function getErrorDiagnostic(revision: number, error: unknown, phase: SourceDiagnostic['phase'], source: string): SourceDiagnostic {
	// Browser audio errors often carry an implementation-generated lineNumber
	// (Firefox commonly reports 1:1). They are transport failures, not source
	// locations, so do not attach that misleading range to an audio diagnostic.
	const diagnostic = diagnosticFromError(revision, error, phase === 'audio' ? '' : source);
	return { ...diagnostic, phase };
}

export function getDiagnosticLocation(diagnostic: SourceDiagnostic): string {
	if (!diagnostic.range) return '';
	const column = diagnostic.range.column === undefined ? '' : `:${diagnostic.range.column}`;
	return `LINE ${diagnostic.range.line}${column} · REV ${formatRevision(diagnostic.revision)}`;
}

export function getTrackColor(sourceColor?: string): string {
	return sourceColor ?? DEFAULT_TRACK_COLOR;
}

export function getTrackLabel(type: string): string {
	return type === 'unknown' ? 'SOURCE' : type.toUpperCase();
}

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

export function snapCycle(value: number): number {
	return Math.round(value / TIMELINE_SNAP_CYCLE) * TIMELINE_SNAP_CYCLE;
}

export function normalizeTrackRange(startCycle: number, endCycle: number, songEndCycle: number): { startCycle: number; endCycle: number } {
	const safeSongEnd = Number.isFinite(songEndCycle) && songEndCycle > 0 ? songEndCycle : TIMELINE_SNAP_CYCLE;
	const maxEnd = Math.max(TIMELINE_SNAP_CYCLE, Math.floor(safeSongEnd / TIMELINE_SNAP_CYCLE) * TIMELINE_SNAP_CYCLE);
	const start = clamp(snapCycle(Number.isFinite(startCycle) ? startCycle : 0), 0, Math.max(0, maxEnd - TIMELINE_SNAP_CYCLE));
	const end = clamp(snapCycle(Number.isFinite(endCycle) ? endCycle : start + TIMELINE_SNAP_CYCLE), start + TIMELINE_SNAP_CYCLE, maxEnd);
	return { startCycle: Number(start.toFixed(2)), endCycle: Number(end.toFixed(2)) };
}

export function shiftTrackRange(startCycle: number, endCycle: number, delta: number): { startCycle: number; endCycle: number } {
	const length = Math.max(TIMELINE_SNAP_CYCLE, endCycle - startCycle);
	const nextStart = Math.max(0, snapCycle(startCycle + delta));
	return { startCycle: nextStart, endCycle: nextStart + length };
}

export function formatClock(seconds: number): string {
	const totalSeconds = Math.max(0, Math.floor(seconds));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const remainder = totalSeconds % 60;
	return [hours, minutes, remainder].map((value) => value.toString().padStart(2, '0')).join(':');
}

export function formatCycle(cycle: number): string {
	return Number(cycle.toFixed(2)).toString();
}

export function getKeyParts(key: string): { root: string; mode: 'major' | 'minor' } {
	const [root, mode] = key.split(':');
	return {
		root: root?.trim() || 'C',
		mode: mode?.trim().toLowerCase() === 'major' ? 'major' : 'minor',
	};
}

export function formatKeyDisplay(key: string): string {
	const { root, mode } = getKeyParts(key);
	return `${root.replace('#', '♯')} ${mode === 'major' ? 'maj' : 'min'}`;
}

export function getExplicitSourceEndCycle(source: string): number {
	return getSourceBlockDetails(source)
		.filter((block) => block.timing.mode !== 'full')
		.reduce((endCycle, block) => Math.max(endCycle, block.timing.endCycle), 0);
}

export function normalizeImportedSnapshot(snapshot: StoredProjectSnapshot): StoredProjectSnapshot {
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

export function projectFileName(name: string): string {
	const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
	return `${slug || 'sushi-project'}.sushi.json`;
}

export function getSourceCycleStep(source: string): number {
	const quarterNotesPerCycle = getSourceGlobals(source).quarterNotesPerCycle;
	return 1 / Math.max(1, Math.round(quarterNotesPerCycle));
}

export function timelineLabelStride(pixelsPerCycle: number): number {
	if (pixelsPerCycle >= 48) return 1;
	if (pixelsPerCycle >= 24) return 2;
	if (pixelsPerCycle >= 12) return 4;
	if (pixelsPerCycle >= 6) return 8;
	return 16;
}

export function sourceEntityIds(state: WebMcpStateSnapshot): string[] {
	return ['source', ...state.tracks.map((track) => track.id)];
}

export function getTrackTimingForTimeline(track: TrackDetails | undefined, songEndCycle: number): TrackDetails['timing'] {
	if (track?.timing.mode !== 'full') return track?.timing ?? { mode: 'full', startCycle: 0, endCycle: Math.min(DEFAULT_TRACK_END_CYCLE, songEndCycle) };
	return { ...track.timing, endCycle: Math.min(DEFAULT_TRACK_END_CYCLE, songEndCycle) };
}

export type TrackTargetResolution =
	| { ok: true; track: TrackDetails }
	| { ok: false; code: string; message: string };

export function resolveTrackTarget(source: string, target: WebMcpTrackTarget): TrackTargetResolution {
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

export function sourceForTrackMutation(studio: StudioState): string {
	return getSourceBlockDetails(studio.draft).length ? studio.draft : studio.lastValid;
}

export function makeMutationResult(
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

export { DEFAULT_SONG_END_CYCLE, EXTENDED_SONG_END_CYCLE, LEGACY_DEFAULT_SOURCE, getSourceBlocks, getSourceIdentityDiagnostics };
