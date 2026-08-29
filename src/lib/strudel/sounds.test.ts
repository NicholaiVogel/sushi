import { describe, expect, test } from 'bun:test';
import {
	STRUDEL_SOUND_DEFINITIONS,
	getStrudelSoundDefinition,
	parseStrudelSoundArgument,
	searchStrudelSounds,
	extractStrudelSoundToken,
} from './sounds';

describe('Strudel sound library', () => {
	test('exposes generated synth, sample, and soundfont metadata', () => {
		expect(STRUDEL_SOUND_DEFINITIONS.length).toBeGreaterThan(100);
		expect(getStrudelSoundDefinition('sawtooth')).toMatchObject({ id: 'sawtooth', type: 'synth', category: 'waveform' });
		expect(getStrudelSoundDefinition('saw')?.id).toBe('sawtooth');
		expect(getStrudelSoundDefinition('piano')).toMatchObject({ id: 'piano', type: 'sample' });
		expect(getStrudelSoundDefinition('gm_string_ensemble_2')).toMatchObject({ label: 'GM String Ensemble 2', type: 'soundfont' });
	});

	test('resolves sound pattern qualifiers without changing the catalog id', () => {
		expect(extractStrudelSoundToken('<~ bd:2!4 sd>')).toBe('bd:2!4');
		expect(getStrudelSoundDefinition('bd:2!4')).toMatchObject({ id: 'bd', category: 'drum-kit' });
	});

	test('parses static and dynamic source arguments', () => {
		expect(parseStrudelSoundArgument('"sawtooth"')).toMatchObject({
		kind: 'static',
		value: 'sawtooth',
		token: 'sawtooth',
		definition: { id: 'sawtooth' },
	});
		expect(parseStrudelSoundArgument('soundName')).toMatchObject({ kind: 'dynamic', expression: 'soundName', token: 'soundName' });
		expect(parseStrudelSoundArgument('"future_custom_sound"')).toMatchObject({ kind: 'static', value: 'future_custom_sound' });
		expect(parseStrudelSoundArgument('"future_custom_sound"')?.definition).toBeUndefined();
	});

	test('searches by display label, identifier, category, and type', () => {
		expect(searchStrudelSounds('ensemble', { limit: 5 }).some((sound) => sound.id === 'gm_string_ensemble_2')).toBe(true);
		expect(searchStrudelSounds('', { type: 'soundfont', limit: 3 }).every((sound) => sound.type === 'soundfont')).toBe(true);
		expect(searchStrudelSounds('drum-kit', { limit: 3 }).every((sound) => sound.category === 'drum-kit')).toBe(true);
	});
});

