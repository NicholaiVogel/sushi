import { DEFAULT_SONG_END_CYCLE, EXTENDED_SONG_END_CYCLE } from './model';

export interface TimelineCell {
	label: string;
	barStart: boolean;
}

/** Pixel width of one quarter-note cell in the horizontal arrangement. */
export const TIMELINE_CELL_WIDTH = 64;
export const DEFAULT_TIMELINE_ZOOM = 1;
export const MIN_TIMELINE_ZOOM = 0.25;
export const MAX_TIMELINE_ZOOM = 2;
export const TIMELINE_ZOOM_STEP = 0.25;

/**
 * Timeline capacity grows in 30-bar pages, with a final capped page ending
 * at the 137-bar maximum. Track ranges can still use quarter-cycle precision;
 * this only controls how much room the arrangement exposes around them.
 */
export function getTimelineCapacityForEndCycle(requiredEndCycle: number): number {
	const safeEndCycle = Number.isFinite(requiredEndCycle) && requiredEndCycle > 0
		? requiredEndCycle
		: DEFAULT_SONG_END_CYCLE;
	if (safeEndCycle <= DEFAULT_SONG_END_CYCLE) return DEFAULT_SONG_END_CYCLE;
	return Math.min(EXTENDED_SONG_END_CYCLE, Math.ceil(safeEndCycle / DEFAULT_SONG_END_CYCLE) * DEFAULT_SONG_END_CYCLE);
}

/** Choose the slider position that opens a loaded timeline around the target number of visible bars. */
export function getTimelineZoomForVisibleCycles(timelineEndCycle: number, targetVisibleCycles = DEFAULT_SONG_END_CYCLE): number {
	const safeEndCycle = Number.isFinite(timelineEndCycle) && timelineEndCycle > 0 ? timelineEndCycle : DEFAULT_SONG_END_CYCLE;
	const safeTarget = Number.isFinite(targetVisibleCycles) && targetVisibleCycles > 0
		? Math.min(safeEndCycle, targetVisibleCycles)
		: Math.min(safeEndCycle, DEFAULT_SONG_END_CYCLE);
	if (safeEndCycle <= 1) return 0;
	return Math.max(0, Math.min(100, Math.round(((safeEndCycle - safeTarget) / (safeEndCycle - 1)) * 100)));
}

export function clampTimelineZoom(value: number): number {
	const safeValue = Number.isFinite(value) ? value : DEFAULT_TIMELINE_ZOOM;
	const clamped = Math.max(MIN_TIMELINE_ZOOM, Math.min(MAX_TIMELINE_ZOOM, safeValue));
	return Math.round(clamped / TIMELINE_ZOOM_STEP) * TIMELINE_ZOOM_STEP;
}

export function getTimelineCellWidth(zoom: number): number {
	return TIMELINE_CELL_WIDTH * clampTimelineZoom(zoom);
}

/**
 * Build quarter-note cells for the arrangement ruler. A cycle is one bar in
 * the current meter, so each cycle contributes the source-defined number of
 * quarter-note cells. Strudel's `setcpm(bpm / qpc)` convention uses an integer
 * quarter-note count for a cycle; malformed or fractional values are rounded
 * to the nearest usable subdivision at the presentation boundary.
 */
export function getTimelineCells(endCycle: number, quarterNotesPerCycle = 4): TimelineCell[] {
	const safeEndCycle = Number.isFinite(endCycle) && endCycle > 0 ? endCycle : 1;
	const safeQuarterNotes = Number.isFinite(quarterNotesPerCycle) && quarterNotesPerCycle > 0
		? Math.max(1, Math.round(quarterNotesPerCycle))
		: 4;
	const cellCount = Math.max(safeQuarterNotes, Math.ceil(safeEndCycle * safeQuarterNotes));
	return Array.from({ length: cellCount }, (_, index) => {
		const bar = Math.floor(index / safeQuarterNotes) + 1;
		const beat = index % safeQuarterNotes;
		return {
			label: beat === 0 ? String(bar) : `${bar}.${beat}`,
			barStart: beat === 0,
		};
	});
}
