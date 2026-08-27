import { describe, expect, test } from 'bun:test';
import { getTimelineCells } from './timeline';

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
});
