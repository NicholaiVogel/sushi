import { describe, expect, test } from 'bun:test';
import { getSourceBlockDetails } from './source-mapper';
import { EDITOR_PRESETS, getEditorPreset, listEditorPresets } from './presets';

describe('editor presets', () => {
	test('includes the curated witch-house composition with matching lane metadata', () => {
		expect(EDITOR_PRESETS).toHaveLength(1);

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
		expect(ids).toEqual(['witch-house-climax']);
	});

	test('lists metadata without exposing source text', () => {
		const templates = listEditorPresets();

		expect(templates).toEqual([{
			id: 'witch-house-climax',
			name: 'Witch-House Climax',
			description: 'A cinematic 24-cycle build from sparse arpeggios into a dense, distorted climax.',
			bpm: 84,
			key: 'F minor',
			lanes: 16,
		}]);
		expect(templates[0]).not.toHaveProperty('source');
	});

	test('filters templates by metadata and resolves exact IDs', () => {
		expect(listEditorPresets('witch-house')[0]?.id).toBe('witch-house-climax');
		expect(listEditorPresets('does-not-exist')).toEqual([]);
		expect(getEditorPreset('witch-house-climax')?.source).toContain('const key = "F:minor"');
		expect(getEditorPreset('missing-template')).toBeUndefined();
	});
});
