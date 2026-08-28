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
