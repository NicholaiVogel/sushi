import { describe, expect, test } from 'bun:test';
import { clampTimelineZoom, getTimelineCellWidth, getTimelineCells } from './timeline';

describe('arrangement timeline cells', () => {
	test('expands the ruler beyond the default four cycles', () => {
		const cells = getTimelineCells(16);

		expect(cells).toHaveLength(64);
		expect(cells.slice(0, 8).map((cell) => cell.label)).toEqual(['1', '1.1', '1.2', '1.3', '2', '2.1', '2.2', '2.3']);
		expect(cells[60]).toEqual({ label: '16', barStart: true });
	});

	test('rounds a partial final cycle up to its visible quarter-note cell', () => {
		expect(getTimelineCells(2.25)).toHaveLength(9);
	});

	test('uses the source quarter-note count when grouping bars', () => {
		const cells = getTimelineCells(2, 8);

		expect(cells).toHaveLength(16);
		expect(cells.slice(0, 10).map((cell) => cell.label)).toEqual(['1', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '2', '2.1']);
	});

	test('clamps arrangement zoom to usable quarter-note widths', () => {
		expect(clampTimelineZoom(0)).toBe(0.25);
		expect(clampTimelineZoom(1.12)).toBe(1);
		expect(clampTimelineZoom(9)).toBe(2);
		expect(getTimelineCellWidth(0.5)).toBe(32);
	});
});
