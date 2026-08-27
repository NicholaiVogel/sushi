import { describe, expect, test } from 'bun:test';
import { getSourceBlockDetails } from './source-mapper';
import { EDITOR_PRESETS } from './presets';

describe('editor presets', () => {
	test('includes the curated garden compositions with matching lane metadata', () => {
		expect(EDITOR_PRESETS).toHaveLength(3);

		for (const preset of EDITOR_PRESETS) {
			const blocks = getSourceBlockDetails(preset.source);

			expect(preset.source).toMatch(/^setcpm\(/);
			expect(preset.source).toContain('const key =');
			expect(blocks).toHaveLength(preset.lanes);
			expect(preset.bpm).toBeGreaterThan(0);
			expect(preset.key).toMatch(/ (major|minor)$/);
		}
	});

	test('keeps preset IDs stable and unique', () => {
		const ids = EDITOR_PRESETS.map((preset) => preset.id);

		expect(new Set(ids).size).toBe(ids.length);
		expect(ids).toEqual(['track-01', 'track-02', 'track-03']);
	});
});
