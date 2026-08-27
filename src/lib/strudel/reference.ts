export type StrudelReferenceKind = 'function' | 'sound' | 'template' | 'pattern';

export interface StrudelReferenceEntry {
	id: string;
	kind: StrudelReferenceKind;
	title: string;
	summary: string;
	syntax: string;
	example: string;
	tags: string[];
}

/**
 * A small, versioned reference for the constructs Sushi presents or commonly
 * needs when composing. It is deliberately local so an agent can look up
 * syntax without a network dependency or a second source of truth.
 */
export const STRUDEL_REFERENCE_VERSION = '1.3.0';

export const STRUDEL_REFERENCE: StrudelReferenceEntry[] = [
	{
		id: 'setcpm',
		kind: 'function',
		title: 'setcpm',
		summary: 'Set beats per minute and the number of quarter notes in one Strudel cycle.',
		syntax: 'setcpm(bpm / quarterNotesPerCycle)',
		example: 'setcpm(84 / 4)',
		tags: ['tempo', 'bpm', 'cycles', 'timing'],
	},
	{
		id: 'note',
		kind: 'function',
		title: 'note',
		summary: 'Create a pitched pattern from note names. Angle brackets sequence values over cycles.',
		syntax: 'note("<e2 g2 b2>")',
		example: '$: note("<e2 e2 g2 b2>").s("sawtooth")',
		tags: ['pitch', 'melody', 'synth'],
	},
	{
		id: 'n',
		kind: 'function',
		title: 'n',
		summary: 'Create a numeric pattern, often used with a scale or a sound pattern.',
		syntax: 'n("<0 2 4 7>")',
		example: '$: n("<0 2 4 7>").scale("E:minor").s("sawtooth")',
		tags: ['pitch', 'pattern', 'scale'],
	},
	{
		id: 's',
		kind: 'function',
		title: 's / sound',
		summary: 'Choose a sample or synthesizer voice for a pattern.',
		syntax: 's("bd sd")',
		example: '$: s("bd ~ bd ~").gain(0.7)',
		tags: ['sound', 'sample', 'synth'],
	},
	{
		id: 'bd',
		kind: 'sound',
		title: 'bd kick',
		summary: 'The built-in bass-drum sample name used for a four-on-the-floor pulse.',
		syntax: 's("bd")',
		example: '$: s("bd ~ bd ~")',
		tags: ['drum', 'kick', 'sample', 'sound'],
	},
	{
		id: 'sd',
		kind: 'sound',
		title: 'sd snare',
		summary: 'The built-in snare-drum sample name for backbeats and fills.',
		syntax: 's("sd")',
		example: '$: s("~ sd ~ sd")',
		tags: ['drum', 'snare', 'sample', 'sound'],
	},
	{
		id: 'sawtooth',
		kind: 'sound',
		title: 'sawtooth synth',
		summary: 'A bright oscillator voice that works well for bass and lead patterns.',
		syntax: 's("sawtooth")',
		example: '$: note("<e2 g2 b2>").s("sawtooth")',
		tags: ['synth', 'oscillator', 'voice', 'sound'],
	},
	{
		id: 'sine',
		kind: 'sound',
		title: 'sine synth',
		summary: 'A smooth oscillator voice for soft bass, pads, and simple melodies.',
		syntax: 's("sine")',
		example: '$: note("<c3 e3 g3>").s("sine")',
		tags: ['synth', 'oscillator', 'voice', 'sound'],
	},
	{
		id: 'triangle',
		kind: 'sound',
		title: 'triangle synth',
		summary: 'A mellow oscillator voice for rounded lead and plucked textures.',
		syntax: 's("triangle")',
		example: '$: note("<e4 g4 a4>").s("triangle")',
		tags: ['synth', 'oscillator', 'voice', 'sound'],
	},
	{
		id: 'gain',
		kind: 'function',
		title: 'gain',
		summary: 'Set a pattern amplitude multiplier from 0 to 1.',
		syntax: '.gain(value)',
		example: '$: s("bd sd").gain(0.6)',
		tags: ['mixer', 'volume', 'amplitude'],
	},
	{
		id: 'pan',
		kind: 'function',
		title: 'pan',
		summary: 'Set stereo position where 0 is left, 0.5 is center, and 1 is right.',
		syntax: '.pan(value)',
		example: '$: note("<e2 g2>").s("sine").pan(0.25)',
		tags: ['mixer', 'stereo'],
	},
	{
		id: 'seqPLoop',
		kind: 'function',
		title: 'seqPLoop',
		summary: 'Place a pattern between explicit start and end cycle positions and repeat the range.',
		syntax: 'seqPLoop([startCycle, endCycle, pattern])',
		example: '$: seqPLoop([1, 3.5, note("<e2 g2>").s("sawtooth")])',
		tags: ['arrangement', 'timeline', 'range', 'cycles'],
	},
	{
		id: 'arrange',
		kind: 'function',
		title: 'arrange',
		summary: 'Sequence sections with explicit cycle durations.',
		syntax: 'arrange([duration, pattern], [duration, pattern], ...)',
		example: '$: arrange([4, s("bd")], [4, s("bd sd")])',
		tags: ['arrangement', 'timeline', 'sections'],
	},
	{
		id: 'mute-label',
		kind: 'function',
		title: 'Source mute labels',
		summary: 'Prefix a labeled source block with _ to keep it in source while muting it in Strudel.',
		syntax: '_$: pattern',
		example: '_$: s("bd ~ bd ~")',
		tags: ['mute', 'source', 'track'],
	},
	{
		id: 'track-marker',
		kind: 'template',
		title: 'Sushi track marker',
		summary: 'Attach a stable identity and display metadata to the following labeled Strudel expression.',
		syntax: '// @sushi-track {"id":"...","name":"...","type":"synth","schema":1}',
		example: '// @sushi-track {"id":"trk_lead","name":"Lead","type":"synth","schema":1}\n$: note("<e4 g4>").s("sine")',
		tags: ['sushi', 'track', 'metadata', 'source'],
	},
	{
		id: 'drum-pattern',
		kind: 'pattern',
		title: 'Four-on-the-floor',
		summary: 'A simple kick and snare starting point for a four-quarter-note cycle.',
		syntax: 's("bd ~ bd ~, ~ sd ~ sd")',
		example: '$: s("bd ~ bd ~, ~ sd ~ sd").gain(0.7)',
		tags: ['drums', 'starter', 'pattern'],
	},
	{
		id: 'minor-pulse',
		kind: 'pattern',
		title: 'Minor synth pulse',
		summary: 'A compact repeating note pattern suitable for a first source lane.',
		syntax: 'note("<e2 e2 g2 b2>").s("sawtooth")',
		example: '$: note("<e2 e2 g2 b2>").s("sawtooth").gain(0.24)',
		tags: ['synth', 'melody', 'minor', 'starter'],
	},
	{
		id: 'tempo-key-template',
		kind: 'template',
		title: 'Tempo and key header',
		summary: 'The canonical Sushi header for tempo, cycle grouping, and musical key.',
		syntax: 'setcpm(bpm / quarterNotesPerCycle)\nconst key = "E:minor"',
		example: 'setcpm(150 / 4)\nconst key = "E:minor"',
		tags: ['tempo', 'key', 'header', 'sushi'],
	},
];

export function lookupStrudelReference(query: string, kind?: StrudelReferenceKind, limit = 6): StrudelReferenceEntry[] {
	const normalizedQuery = query.trim().toLowerCase();
	const candidates = STRUDEL_REFERENCE.filter((entry) => !kind || entry.kind === kind);
	if (!normalizedQuery) return candidates.slice(0, Math.max(1, Math.min(limit, 12)));

	return candidates
		.map((entry) => {
			const haystack = [entry.id, entry.title, entry.summary, entry.syntax, entry.example, ...entry.tags].join(' ').toLowerCase();
			const words = normalizedQuery.split(/\s+/).filter(Boolean);
			const score = words.reduce((total, word) => {
				if (entry.id === word || entry.title.toLowerCase() === word) return total + 8;
				if (entry.tags.some((tag) => tag === word)) return total + 5;
				if (haystack.includes(word)) return total + 2;
				return total;
			}, 0);
			return { entry, score };
		})
		.filter(({ score }) => score > 0)
		.sort((left, right) => right.score - left.score || left.entry.title.localeCompare(right.entry.title))
		.slice(0, Math.max(1, Math.min(limit, 12)))
		.map(({ entry }) => entry);
}
