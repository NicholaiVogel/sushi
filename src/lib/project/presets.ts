import { D_MINOR_PULSE_SOURCE } from './presets/d-minor-pulse';
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

export const ONBOARDING_DEMO_PRESET_ID = 'd-minor-pulse';

export const EDITOR_PRESETS: readonly EditorPreset[] = [
	{
		id: ONBOARDING_DEMO_PRESET_ID,
		name: 'D Minor Pulse',
		description: 'A compact 23-cycle arrangement with a moving bassline, layered piano motifs, and a restrained pulse.',
		bpm: 90,
		key: 'D minor',
		lanes: 12,
		source: D_MINOR_PULSE_SOURCE,
	},
	{
		id: 'witch-house-climax',
		name: 'F Minor Arrangement',
		description: 'A detailed 24-cycle arrangement that builds from sparse arpeggios into a dense final section.',
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
