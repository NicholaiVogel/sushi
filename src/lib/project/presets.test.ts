import { describe, expect, test } from 'bun:test';
import { getSourceBlockDetails } from './source-mapper';
import { EDITOR_PRESETS, getEditorPreset, listEditorPresets, ONBOARDING_DEMO_PRESET_ID } from './presets';

describe('editor presets', () => {
	test('includes curated compositions with matching lane metadata', () => {
		expect(EDITOR_PRESETS).toHaveLength(2);

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
		expect(ids).toEqual(['d-minor-pulse', 'witch-house-climax']);
		expect(ONBOARDING_DEMO_PRESET_ID).toBe('d-minor-pulse');
	});

	test('lists metadata without exposing source text', () => {
		const templates = listEditorPresets();

		expect(templates).toEqual([
			{
				id: 'd-minor-pulse',
				name: 'D Minor Pulse',
				description: 'A compact 23-cycle arrangement with a moving bassline, layered piano motifs, and a restrained pulse.',
				bpm: 90,
				key: 'D minor',
				lanes: 12,
			},
			{
				id: 'witch-house-climax',
				name: 'F Minor Arrangement',
				description: 'A detailed 24-cycle arrangement that builds from sparse arpeggios into a dense final section.',
				bpm: 84,
				key: 'F minor',
				lanes: 16,
			},
		]);
		expect(templates[0]).not.toHaveProperty('source');
	});

	test('filters templates by metadata and resolves exact IDs', () => {
		expect(listEditorPresets('D minor')[0]?.id).toBe('d-minor-pulse');
		expect(listEditorPresets('F minor')[0]?.id).toBe('witch-house-climax');
		expect(listEditorPresets('does-not-exist')).toEqual([]);
		expect(getEditorPreset('witch-house-climax')?.source).toContain('const key = "F:minor"');
		expect(getEditorPreset('missing-template')).toBeUndefined();
	});
});
