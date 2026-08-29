import {
	STRUDEL_SOURCE_ALIAS_TARGETS,
	STRUDEL_SOURCE_CONTROLS,
	STRUDEL_SOURCE_VERSION,
	type StrudelSourceControl,
	type StrudelSourceParameter,
} from './strudel-controls.generated';

/** The broad families used to keep the effects drawer easy to scan. */
export type TrackEffectGroup =
	| 'filter'
	| 'envelope'
	| 'modulation'
	| 'delay'
	| 'reverb'
	| 'distortion'
	| 'dynamics'
	| 'spatial'
	| 'pitch'
	| 'synthesis'
	| 'sampling'
	| 'routing'
	| 'other'
	| 'unknown';

export type TrackEffectParameterType = 'number' | 'option' | 'expression';

export interface TrackEffectOption {
	value: string;
	label: string;
}

/** Metadata required by any UI that wants to render one effect parameter. */
export interface TrackEffectParameterDefinition {
	name: string;
	label: string;
	type: TrackEffectParameterType;
	defaultValue: number | string;
	min?: number;
	max?: number;
	step?: number;
	options?: readonly TrackEffectOption[];
	supportsRandom: boolean;
	description?: string;
}

/**
 * Strudel control metadata plus the small amount of presentation information
 * Sushi needs. This is deliberately framework-agnostic so parsing,
 * serialization, the effects drawer, and future control surfaces share it.
 */
export interface TrackEffectDefinition {
	/** Canonical method Sushi writes back to source. */
	method: string;
	/** Strudel aliases accepted by the parser. */
	aliases: readonly string[];
	/** Compact label suitable for a DAW control. */
	label: string;
	group: TrackEffectGroup;
	description: string;
	parameters: readonly TrackEffectParameterDefinition[];
	/** Whether the control can be represented by a `rand` value. */
	supportsRandom: boolean;
	/** Whether the control should be offered by Sushi's Add effect menu. */
	addable: boolean;
	/** `strudel` means this came from the generated Strudel control metadata. */
	source: 'strudel' | 'fallback';
	sourceVersion?: string;
}

export type TrackEffectValueKind = 'numeric' | 'random' | 'dynamic';
export type TrackEffectMethod = string;
export type TrackEffectInput = number | 'rand' | string;

/** One parsed parameter value belonging to an effect call. */
export interface TrackEffectParameter extends TrackEffectParameterDefinition {
	index: number;
	expression: string;
	kind: TrackEffectValueKind;
	value?: number;
}

const numericLiteralPattern = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;

function formatLabel(value: string): string {
	return value
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/[-_]+/g, ' ')
		.toUpperCase();
}

function parseNumeric(value: string): number | undefined {
	const trimmed = value.trim();
	if (!numericLiteralPattern.test(trimmed)) return undefined;
	const numeric = Number(trimmed);
	return Number.isFinite(numeric) ? numeric : undefined;
}

function inferRange(description: string): { min?: number; max?: number } {
	const normalized = description.replace(/[–—]/g, '-');
	const match = normalized.match(/(?:between|from)\s+(-?\d+(?:\.\d+)?)\s*(?:and|to|&)\s*(-?\d+(?:\.\d+)?)/i)
		?? normalized.match(/(-?\d+(?:\.\d+)?)\s+to\s+(-?\d+(?:\.\d+)?)/i);
	if (!match) return {};
	const first = Number(match[1]);
	const second = Number(match[2]);
	if (!Number.isFinite(first) || !Number.isFinite(second) || first === second) return {};
	return { min: Math.min(first, second), max: Math.max(first, second) };
}

function inferOptions(description: string): TrackEffectOption[] | undefined {
	const choices = description.match(/\{([^}]+)\}/)?.[1]
		?? (description.match(/(?:^|\s)((?:tri|square|sine|saw|ramp)(?:\s*\|\s*(?:tri|square|sine|saw|ramp))+)/i)?.[1]);
	if (choices) {
		const values = choices.split('|').map((value) => value.trim()).filter(Boolean);
		if (values.length > 1) return values.map((value) => ({ value, label: value.toUpperCase() }));
	}
	const numbered = [...description.matchAll(/([A-Za-z][\w-]*)\s*\((-?\d+(?:\.\d+)?)\)/g)];
	if (numbered.length > 1 && /type|mode|shape/i.test(description)) {
		return numbered.map(([, label, value]) => ({ value, label: label.toUpperCase() }));
	}
	return undefined;
}

function sourceParameterType(parameter: StrudelSourceParameter): TrackEffectParameterType {
	if (inferOptions(parameter.description)) return 'option';
	if (parameter.type.includes('number')) return 'number';
	return 'expression';
}

function sourceParameterDefinition(parameter: StrudelSourceParameter, index: number): TrackEffectParameterDefinition {
	const type = sourceParameterType(parameter);
	const options = type === 'option' ? inferOptions(parameter.description) : undefined;
	const range = type === 'number' ? inferRange(parameter.description) : {};
	const defaultValue = type === 'number'
		? range.min ?? 0
		: options?.[0]?.value ?? '';
	return {
		name: parameter.name || `value${index + 1}`,
		label: formatLabel(parameter.name || `value${index + 1}`),
		type,
		defaultValue,
		...(range.min === undefined ? {} : { min: range.min }),
		...(range.max === undefined ? {} : { max: range.max }),
		...(range.min !== undefined && range.max !== undefined ? { step: range.max - range.min > 20 ? 1 : 0.01 } : {}),
		...(options ? { options } : {}),
		supportsRandom: type === 'number',
		description: parameter.description || undefined,
	};
}

function fallbackParameter(index = 0): TrackEffectParameterDefinition {
	return {
		name: index === 0 ? 'value' : `value${index + 1}`,
		label: index === 0 ? 'VALUE' : `VALUE ${index + 1}`,
		type: 'expression',
		defaultValue: '',
		supportsRandom: false,
	};
}

type ParameterOverride = Partial<TrackEffectParameterDefinition> & Pick<TrackEffectParameterDefinition, 'name' | 'label' | 'type' | 'defaultValue' | 'supportsRandom'>;
type DefinitionOverride = {
	group: TrackEffectGroup;
	label?: string;
	description?: string;
	aliases?: readonly string[];
	parameters?: readonly ParameterOverride[];
	addable?: boolean;
};

function numberParameter(
	name: string,
	label: string,
	defaultValue: number,
	min: number,
	max: number,
	step = max - min > 20 ? 1 : 0.01,
	supportsRandom = true,
	description?: string,
): ParameterOverride {
	return { name, label, type: 'number', defaultValue, min, max, step, supportsRandom, description };
}

function optionParameter(name: string, label: string, defaultValue: string, options: readonly string[], description?: string): ParameterOverride {
	return {
		name,
		label,
		type: 'option',
		defaultValue,
		options: options.map((value) => ({ value, label: value.toUpperCase() })),
		supportsRandom: false,
		description,
	};
}

/**
 * Classification and defaults live here, beside the Strudel source metadata,
 * rather than in React components. The names, aliases, descriptions, and
 * parameter docs are generated from `@strudel/core/controls.mjs`; overrides
 * only fill in UI-safe ranges/defaults where Strudel's prose cannot.
 */
const EFFECT_OVERRIDES: Readonly<Record<string, DefinitionOverride>> = {
	// Filters and filter envelopes
	lpf: { group: 'filter', label: 'LPF', parameters: [numberParameter('frequency', 'CUTOFF', 2000, 0, 20000, 1)] },
	hpf: { group: 'filter', label: 'HPF', parameters: [numberParameter('frequency', 'CUTOFF', 2000, 0, 20000, 1)] },
	bpf: { group: 'filter', label: 'BPF', parameters: [numberParameter('frequency', 'FREQUENCY', 1000, 0, 20000, 1)] },
	lpq: { group: 'filter', label: 'LP Q', parameters: [numberParameter('q', 'Q', 1, 0, 50, 0.1)] },
	hpq: { group: 'filter', label: 'HP Q', parameters: [numberParameter('q', 'Q', 1, 0, 50, 0.1)] },
	bpq: { group: 'filter', label: 'BP Q', parameters: [numberParameter('q', 'Q', 1, 0, 50, 0.1)] },
	lpenv: { group: 'filter', label: 'LP ENV', parameters: [numberParameter('modulation', 'DEPTH', 1, -8, 8, 0.1, false)] },
	hpenv: { group: 'filter', label: 'HP ENV', parameters: [numberParameter('modulation', 'DEPTH', 1, -8, 8, 0.1, false)] },
	bpenv: { group: 'filter', label: 'BP ENV', parameters: [numberParameter('modulation', 'DEPTH', 1, -8, 8, 0.1, false)] },
	ftype: { group: 'filter', label: 'FILTER TYPE', parameters: [optionParameter('type', 'TYPE', '12db', ['12db', 'ladder', '24db'])] },
	fanchor: { group: 'filter', label: 'FILTER ANCHOR', parameters: [numberParameter('center', 'CENTER', 0, 0, 1, 0.01)] },
	djf: { group: 'filter', label: 'DJ FILTER', parameters: [numberParameter('cutoff', 'CUTOFF', 0.5, 0, 1, 0.01)] },
	// Delay, reverb, and space
	delay: { group: 'delay', label: 'DELAY', parameters: [numberParameter('level', 'LEVEL', 0.25, 0, 1, 0.01)] },
	delayfeedback: { group: 'delay', label: 'DELAY FEEDBACK', parameters: [numberParameter('feedback', 'FEEDBACK', 0.5, 0, 0.99, 0.01)] },
	delayspeed: { group: 'delay', label: 'DELAY SPEED', parameters: [numberParameter('speed', 'SPEED', 1, -8, 8, 0.01)] },
	delaysync: { group: 'delay', label: 'DELAY SYNC', parameters: [numberParameter('cycles', 'CYCLES', 1, 0, 8, 0.01)] },
	room: { group: 'reverb', label: 'ROOM', parameters: [numberParameter('level', 'LEVEL', 0.5, 0, 1, 0.01, false)] },
	roomlp: { group: 'reverb', label: 'ROOM LP', parameters: [numberParameter('frequency', 'FREQUENCY', 10000, 0, 20000, 1)] },
	roomdim: { group: 'reverb', label: 'ROOM DIM', parameters: [numberParameter('frequency', 'FREQUENCY', 4000, 0, 20000, 1)] },
	roomfade: { group: 'reverb', label: 'ROOM FADE', parameters: [numberParameter('seconds', 'SECONDS', 0.5, 0, 8, 0.01)] },
	roomsize: { group: 'reverb', label: 'ROOM SIZE', parameters: [numberParameter('size', 'SIZE', 1, 0, 10, 0.01)] },
	dry: { group: 'reverb', label: 'DRY', parameters: [numberParameter('dry', 'DRY', 0, 0, 1, 0.01)] },
	iresponse: { group: 'reverb', label: 'IMPULSE RESPONSE', parameters: [fallbackParameter()] },
	irspeed: { group: 'reverb', label: 'IR SPEED', parameters: [numberParameter('speed', 'SPEED', 1, -8, 8, 0.01)] },
	irbegin: { group: 'reverb', label: 'IR BEGIN', parameters: [numberParameter('begin', 'BEGIN', 0, 0, 1, 0.01)] },
	// Modulation, pitch, and synthesis
	chorus: { group: 'modulation', label: 'CHORUS', parameters: [numberParameter('mix', 'MIX', 0.5, 0, 1, 0.01)] },
	tremolo: { group: 'modulation', label: 'TREMOLO', parameters: [numberParameter('speed', 'SPEED', 4, 0, 20, 0.01)] },
	tremolosync: { group: 'modulation', label: 'TREMOLO SYNC', parameters: [numberParameter('cycles', 'CYCLES', 2, 0, 16, 0.01)] },
	tremolodepth: { group: 'modulation', label: 'TREMOLO DEPTH', parameters: [numberParameter('depth', 'DEPTH', 0.5, 0, 1, 0.01)] },
	tremoloskew: { group: 'modulation', label: 'TREMOLO SKEW', parameters: [numberParameter('amount', 'SKEW', 0.5, 0, 1, 0.01)] },
	tremolophase: { group: 'modulation', label: 'TREMOLO PHASE', parameters: [numberParameter('offset', 'OFFSET', 0, 0, 1, 0.01)] },
	tremoloshape: { group: 'modulation', label: 'TREMOLO SHAPE', parameters: [optionParameter('shape', 'SHAPE', 'sine', ['tri', 'square', 'sine', 'saw', 'ramp'])] },
	phaser: { group: 'modulation', label: 'PHASER', parameters: [numberParameter('speed', 'SPEED', 2, 0, 16, 0.01)] },
	phasersweep: { group: 'modulation', label: 'PHASER SWEEP', parameters: [numberParameter('sweep', 'SWEEP', 2000, 0, 4000, 1)] },
	phasercenter: { group: 'modulation', label: 'PHASER CENTER', parameters: [numberParameter('frequency', 'FREQUENCY', 1000, 0, 20000, 1)] },
	phaserdepth: { group: 'modulation', label: 'PHASER DEPTH', parameters: [numberParameter('depth', 'DEPTH', 0.75, 0, 1, 0.01)] },
	detune: { group: 'pitch', label: 'DETUNE', parameters: [numberParameter('amount', 'AMOUNT', 0, 0, 24, 0.1, true)] },
	unison: { group: 'synthesis', label: 'UNISON', parameters: [numberParameter('voices', 'VOICES', 1, 1, 16, 1)] },
	spread: { group: 'spatial', label: 'SPREAD', parameters: [numberParameter('spread', 'SPREAD', 0, 0, 1, 0.01)] },
	octave: { group: 'pitch', label: 'OCTAVE', parameters: [numberParameter('octave', 'OCTAVE', 0, -4, 4, 1, false)] },
	vib: { group: 'modulation', label: 'VIBRATO', parameters: [numberParameter('frequency', 'FREQUENCY', 4, 0, 20, 0.01)] },
	vibmod: { group: 'modulation', label: 'VIBRATO DEPTH', parameters: [numberParameter('depth', 'DEPTH', 1, 0, 24, 0.1)] },
	wt: { group: 'synthesis', label: 'WAVETABLE POSITION', parameters: [numberParameter('position', 'POSITION', 0, 0, 1, 0.01)] },
	wtenv: { group: 'synthesis', label: 'WAVETABLE ENV', parameters: [numberParameter('amount', 'AMOUNT', 0, 0, 1, 0.01)] },
	warp: { group: 'synthesis', label: 'WARP', parameters: [numberParameter('amount', 'AMOUNT', 0, 0, 1, 0.01)] },
	warpenv: { group: 'synthesis', label: 'WARP ENV', parameters: [numberParameter('amount', 'AMOUNT', 0, 0, 1, 0.01)] },
	// Envelopes and distortion
	attack: { group: 'envelope', label: 'ATTACK', parameters: [numberParameter('attack', 'TIME', 0, 0, 8, 0.01)] },
	decay: { group: 'envelope', label: 'DECAY', parameters: [numberParameter('time', 'TIME', 0.5, 0, 8, 0.01)] },
	sustain: { group: 'envelope', label: 'SUSTAIN', parameters: [numberParameter('gain', 'LEVEL', 1, 0, 1, 0.01)] },
	release: { group: 'envelope', label: 'RELEASE', parameters: [numberParameter('time', 'TIME', 0.5, 0, 8, 0.01)] },
	penv: { group: 'envelope', label: 'PITCH ENV', parameters: [numberParameter('semitones', 'SEMITONES', 0, -24, 24, 0.1)] },
	pattack: { group: 'envelope', label: 'PITCH ATTACK', parameters: [numberParameter('time', 'TIME', 0, 0, 8, 0.01)] },
	pdecay: { group: 'envelope', label: 'PITCH DECAY', parameters: [numberParameter('time', 'TIME', 0.5, 0, 8, 0.01)] },
	prelease: { group: 'envelope', label: 'PITCH RELEASE', parameters: [numberParameter('time', 'TIME', 0.5, 0, 8, 0.01)] },
	pcurve: { group: 'envelope', label: 'PITCH CURVE', parameters: [optionParameter('type', 'TYPE', 'linear', ['linear', 'exponential'])] },
	panchor: { group: 'envelope', label: 'PITCH ANCHOR', parameters: [numberParameter('anchor', 'ANCHOR', 0, 0, 1, 0.01)] },
	crush: { group: 'distortion', label: 'BIT CRUSH', parameters: [numberParameter('depth', 'DEPTH', 1, 1, 16, 1)] },
	coarse: { group: 'distortion', label: 'COARSE', parameters: [numberParameter('factor', 'FACTOR', 1, 1, 16, 1)] },
	shape: { group: 'distortion', label: 'SHAPE', parameters: [numberParameter('distortion', 'AMOUNT', 0, 0, 1, 0.01)] },
	distort: { group: 'distortion', label: 'DISTORT', parameters: [numberParameter('distortion', 'AMOUNT', 0, 0, 10, 0.01), numberParameter('volume', 'VOLUME', 1, 0, 1, 0.01), optionParameter('type', 'TYPE', 'diode', ['fold', 'chebyshev', 'scurve', 'diode', 'asym', 'sinefold'])] },
	distortvol: { group: 'distortion', label: 'DISTORT VOLUME', parameters: [numberParameter('volume', 'VOLUME', 1, 0, 1, 0.01)] },
	distorttype: { group: 'distortion', label: 'DISTORT TYPE', parameters: [optionParameter('type', 'TYPE', 'diode', ['fold', 'chebyshev', 'scurve', 'diode', 'asym', 'sinefold'])] },
	squiz: { group: 'distortion', label: 'SQUIZ', parameters: [numberParameter('amount', 'AMOUNT', 1, -16, 16, 0.01)] },
	vowel: { group: 'distortion', label: 'VOWEL', parameters: [optionParameter('vowel', 'VOWEL', 'a', ['a', 'e', 'i', 'o', 'u', 'ae', 'aa', 'oe', 'y', 'uh', 'un', 'en', 'an', 'on'])] },
	// Dynamics and routing
	duckorbit: { group: 'dynamics', label: 'DUCK ORBIT', parameters: [numberParameter('orbit', 'ORBIT', 0, 0, 16, 1, false)] },
	duckdepth: { group: 'dynamics', label: 'DUCK DEPTH', parameters: [numberParameter('depth', 'DEPTH', 0.5, 0, 1, 0.01)] },
	duckonset: { group: 'dynamics', label: 'DUCK ONSET', parameters: [numberParameter('time', 'TIME', 0.003, 0, 2, 0.001)] },
	duckattack: { group: 'dynamics', label: 'DUCK ATTACK', parameters: [numberParameter('time', 'TIME', 0.01, 0, 2, 0.001)] },
	compressor: {
		group: 'dynamics',
		label: 'COMPRESSOR',
		parameters: [
			numberParameter('threshold', 'THRESHOLD', -24, -100, 0, 0.1),
			numberParameter('ratio', 'RATIO', 12, 1, 20, 0.1),
			numberParameter('knee', 'KNEE', 30, 0, 40, 0.1),
			numberParameter('attack', 'ATTACK', 0.003, 0, 1, 0.001),
			numberParameter('release', 'RELEASE', 0.25, 0, 1, 0.001),
		],
	},
	leslie: { group: 'modulation', label: 'LESLIE', parameters: [numberParameter('wet', 'WET', 0.5, 0, 1, 0.01)] },
	lrate: { group: 'modulation', label: 'LESLIE RATE', parameters: [numberParameter('rate', 'RATE', 0.7, 0, 12, 0.01)] },
	lsize: { group: 'modulation', label: 'LESLIE SIZE', parameters: [numberParameter('meters', 'SIZE', 0.5, 0, 1, 0.01)] },
};

const NON_EFFECT_METHODS = new Set([
	's', 'sound', 'sample', 'samp', 'n', 'note', 'source', 'bank', 'gain', 'postgain', 'amp', 'velocity', 'vel',
	'pan', 'color', 'colour', 'scale', 'add', 'sub', 'mul', 'div', 'fast', 'slow', 'early', 'late',
	'struct', 'mask', 'degrade', 'sometimes', 'rarely', 'often', 'every', 'palindrome', 'rev',
	'fit', 'accelerate', 'begin', 'end', 'loop', 'loopBegin', 'loopEnd', 'clip', 'legato', 'speed', 'stretch', 'unit', 'octaves',
	'chunk', 'slice', 'segment', 'seqPLoop', 'arrange', 'stack', 'cat', 'silence', 'hush',
	'_pianoroll', '_scope', '_spectrum', 'analyze', 'fft', 'label', 'activeLabel', 'orbit', 'bus',
	'busgain', 'bgain', 'channel', 'channels', 'ch', 'midichan', 'midimap', 'midiport', 'midicmd',
	'control', 'ccn', 'ccv', 'progNum', 'sysex', 'sysexid', 'sysexdata', 'midibend', 'miditouch',
]);

const EFFECT_DESCRIPTION_PATTERN = /effect|filter|reverb|delay|distort|chorus|phaser|tremolo|modulat|envelope|detune|oscillator|vibrato|duck|compress|stereo|spread|pitch|wave|noise|sample/i;
const UNKNOWN_EFFECT_METHOD_PATTERN = /effect|fx|filter|reverb|delay|echo|distort|chorus|phaser|tremolo|modulat|envelope|detune|oscillat|vibrato|duck|compress|stereo|spread|pitch|wave|noise|sample|frequency|flang|fuzz|drive|crush|saturat|reson|cutoff|lfo|verb/i;

const sourceByMethod = new Map(STRUDEL_SOURCE_CONTROLS.map((control) => [control.method, control]));
const sourceByAlias = new Map<string, StrudelSourceControl>();

// Alias targets are generated from registerControl's source-order behavior.
// That matters when a parameter name is later registered as its own control,
// such as `size` (roomsize) and `delaytime` (not delay).
for (const [alias, method] of Object.entries(STRUDEL_SOURCE_ALIAS_TARGETS)) {
	const control = sourceByMethod.get(method);
	if (control) sourceByAlias.set(alias, control);
}
for (const control of STRUDEL_SOURCE_CONTROLS) {
	for (const alias of control.aliases) if (!sourceByAlias.has(alias)) sourceByAlias.set(alias, control);
}

function sourceControlFor(method: string): StrudelSourceControl | undefined {
	return sourceByMethod.get(method) ?? sourceByAlias.get(method);
}

function inferredGroup(control: StrudelSourceControl): TrackEffectGroup {
	const text = `${control.method} ${control.description}`.toLowerCase();
	if (/filter|cutoff|resonance|lpf|hpf|bpf/.test(text)) return 'filter';
	if (/reverb|room|impulse response/.test(text)) return 'reverb';
	if (/delay/.test(text)) return 'delay';
	if (/distort|crusher|squiz|vowel/.test(text)) return 'distortion';
	if (/compress|duck/.test(text)) return 'dynamics';
	if (/envelope|attack|decay|sustain|release/.test(text)) return 'envelope';
	if (/detune|octave|pitch|vibrato/.test(text)) return 'pitch';
	if (/pan|stereo|spread/.test(text)) return 'spatial';
	if (/oscillator|wavetable|waveform/.test(text)) return 'synthesis';
	return 'modulation';
}

function shouldAutoInclude(control: StrudelSourceControl): boolean {
	return !NON_EFFECT_METHODS.has(control.method) && EFFECT_DESCRIPTION_PATTERN.test(`${control.method} ${control.description}`);
}

function buildDefinition(method: string, override?: DefinitionOverride): TrackEffectDefinition {
	const sourceControl = sourceControlFor(method);
	const sourceParameters = sourceControl?.parameters.length
		? sourceControl.parameters.map(sourceParameterDefinition)
		: [fallbackParameter()];
	const parameters = override?.parameters?.length
		? override.parameters.map((parameter, index) => ({
			...sourceParameters[index],
			...parameter,
		}))
		: sourceParameters;
	const aliases = [...new Set([
		...(sourceControl?.aliases ?? []),
		...(sourceControl && sourceControl.method !== method ? [sourceControl.method] : []),
		...(override?.aliases ?? []),
	])].filter((alias) => alias !== method);
	const supportsRandom = parameters.some((parameter) => parameter.supportsRandom);
	return {
		method,
		aliases,
		label: override?.label ?? formatLabel(method),
		group: override?.group ?? (sourceControl ? inferredGroup(sourceControl) : 'other'),
		description: override?.description ?? sourceControl?.description ?? 'Strudel control',
		parameters,
		supportsRandom,
		addable: override?.addable ?? parameters[0].type !== 'expression',
		source: sourceControl ? 'strudel' : 'fallback',
		...(sourceControl ? { sourceVersion: STRUDEL_SOURCE_VERSION } : {}),
	};
}

const effectMethods = new Set([
	...Object.keys(EFFECT_OVERRIDES),
	...STRUDEL_SOURCE_CONTROLS.filter(shouldAutoInclude).map((control) => control.method),
]);

export const TRACK_EFFECT_DEFINITIONS: readonly TrackEffectDefinition[] = [...effectMethods]
	.map((method) => buildDefinition(method, EFFECT_OVERRIDES[method]))
	.sort((left, right) => left.group.localeCompare(right.group) || left.label.localeCompare(right.label));

const definitionByMethod = new Map(TRACK_EFFECT_DEFINITIONS.map((definition) => [definition.method, definition]));
const definitionByAlias = new Map<string, TrackEffectDefinition>();

for (const [alias, method] of Object.entries(STRUDEL_SOURCE_ALIAS_TARGETS)) {
	const definition = definitionByMethod.get(method);
	if (definition) definitionByAlias.set(alias, definition);
}
for (const definition of TRACK_EFFECT_DEFINITIONS) {
	for (const alias of definition.aliases) if (!definitionByAlias.has(alias)) definitionByAlias.set(alias, definition);
}

/** All effect definitions that the UI and source mapper can query. */
export function listTrackEffectDefinitions(options?: { addable?: boolean; group?: TrackEffectGroup }): readonly TrackEffectDefinition[] {
	return TRACK_EFFECT_DEFINITIONS.filter((definition) =>
		(options?.addable === undefined || definition.addable === options.addable)
		&& (options?.group === undefined || definition.group === options.group));
}

/** Resolve a canonical Strudel method or one of its aliases. */
export function getTrackEffectDefinition(method: string): TrackEffectDefinition | undefined {
	if (!method) return undefined;
	return definitionByMethod.get(method) ?? definitionByAlias.get(method);
}

/** Return the method Sushi should write when a source used an alias. */
export function normalizeTrackEffectMethod(method: string): string {
	return getTrackEffectDefinition(method)?.method ?? method;
}

/**
 * Unknown controls remain visible and editable as expression-backed effects.
 * Keeping this fallback outside the UI means a newer Strudel release can be
 * used immediately, even before Sushi has specialized metadata for a method.
 */
export function getUnknownTrackEffectDefinition(method: string): TrackEffectDefinition {
	return {
		method,
		aliases: [],
		label: formatLabel(method),
		group: 'unknown',
		description: 'Strudel control not yet mapped by Sushi; source expression preserved.',
		parameters: [fallbackParameter()],
		supportsRandom: false,
		addable: false,
		source: 'fallback',
	};
}

export function getTrackEffectParameterDefinition(definition: TrackEffectDefinition, index: number): TrackEffectParameterDefinition {
	return definition.parameters[index] ?? fallbackParameter(index);
}

/** Convert a source argument into a uniform value model for any effect. */
export function parseTrackEffectParameter(definition: TrackEffectDefinition, index: number, expression: string): TrackEffectParameter {
	const parameter = getTrackEffectParameterDefinition(definition, index);
	const trimmed = expression.trim();
	const value = parseNumeric(trimmed);
	const kind: TrackEffectValueKind = value !== undefined
		? 'numeric'
		: parameter.supportsRandom && trimmed === 'rand' ? 'random' : 'dynamic';
	const min = parameter.min;
	const max = parameter.max === undefined || value === undefined ? parameter.max : Math.max(parameter.max, value);
	return {
		...parameter,
		index,
		expression: trimmed,
		kind,
		...(value === undefined ? {} : { value }),
		...(min === undefined ? {} : { min }),
		...(max === undefined ? {} : { max }),
	};
}

export function isLikelyTrackEffectMethod(method: string): boolean {
	if (NON_EFFECT_METHODS.has(method) || method.startsWith('_')) return false;
	if (getTrackEffectDefinition(method)) return true;
	const sourceControl = sourceControlFor(method);
	if (sourceControl) return shouldAutoInclude(sourceControl);
	// A method absent from the generated Strudel snapshot may still be a newer
	// effect. Keep obvious effect names editable through the fallback without
	// turning arbitrary pattern helpers into FX rows.
	return UNKNOWN_EFFECT_METHOD_PATTERN.test(method);
}

export function isExcludedTrackControl(method: string): boolean {
	return NON_EFFECT_METHODS.has(method) || method.startsWith('_');
}

export const STRUDEL_EFFECT_SOURCE = {
	packageName: '@strudel/core',
	controlsModule: 'controls.mjs',
	version: STRUDEL_SOURCE_VERSION,
} as const;
