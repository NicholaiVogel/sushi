export interface TimelineCell {
	label: string;
	barStart: boolean;
}

/** Pixel width of one quarter-note cell in the horizontal arrangement. */
export const TIMELINE_CELL_WIDTH = 64;

/**
 * Build quarter-note cells for the arrangement ruler. A cycle is one bar in
 * the current meter, so each cycle contributes four labelled beat cells.
 */
export function getTimelineCells(endCycle: number): TimelineCell[] {
	const safeEndCycle = Number.isFinite(endCycle) && endCycle > 0 ? endCycle : 1;
	const cellCount = Math.max(4, Math.ceil(safeEndCycle * 4));
	return Array.from({ length: cellCount }, (_, index) => {
		const bar = Math.floor(index / 4) + 1;
		const beat = index % 4;
		return {
			label: beat === 0 ? String(bar) : `${bar}.${beat}`,
			barStart: beat === 0,
		};
	});
}
