import { WITCH_HOUSE_SOURCE } from './presets/witch-house';

export interface EditorPreset {
	id: string;
	name: string;
	description: string;
	bpm: number;
	key: string;
	lanes: number;
	source: string;
}

export type EditorPresetSummary = Omit<EditorPreset, 'source'>;

export const EDITOR_PRESETS: readonly EditorPreset[] = [
	{
		id: 'witch-house-climax',
		name: 'Witch-House Climax',
		description: 'A cinematic 24-cycle build from sparse arpeggios into a dense, distorted climax.',
		bpm: 84,
		key: 'F minor',
		lanes: 16,
		source: WITCH_HOUSE_SOURCE,
	},
];

/** Return the curated template with an exact, stable ID match. */
export function getEditorPreset(id: string): EditorPreset | undefined {
	return EDITOR_PRESETS.find((preset) => preset.id === id);
}

/** Strip source text when an agent only needs to browse available templates. */
export function summarizeEditorPreset(preset: EditorPreset): EditorPresetSummary {
	const { source: _source, ...summary } = preset;
	return summary;
}

/**
 * List loadable templates using the same deterministic metadata exposed in the
 * settings menu. A small limit keeps tool responses useful when the registry
 * grows beyond the current curated set.
 */
export function listEditorPresets(query = '', limit = 12): EditorPresetSummary[] {
	const normalizedQuery = query.trim().toLowerCase();
	const requestedLimit = Number.isFinite(limit) ? Math.trunc(limit) : 12;
	const normalizedLimit = Math.max(1, Math.min(requestedLimit, 12));
	return EDITOR_PRESETS
		.filter((preset) => {
			if (!normalizedQuery) return true;
			return [preset.id, preset.name, preset.description, preset.key, String(preset.bpm), String(preset.lanes)]
				.some((value) => value.toLowerCase().includes(normalizedQuery));
		})
		.slice(0, normalizedLimit)
		.map(summarizeEditorPreset);
}
