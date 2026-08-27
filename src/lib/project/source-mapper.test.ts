import { describe, expect, test } from 'bun:test';
import { DEFAULT_SOURCE } from './model';
import {
	cyclesToSeconds,
	getSourceBlockDetails,
	getSourceGlobals,
	secondsToCycles,
	updateTrackGain,
	updateTrackMode,
	updateTrackPan,
	updateTrackRange,
} from './source-mapper';

const pulseId = 'trk_01J4PULSE';

const REGULAR_STRUDEL_SONG = [
	'setcpm(90/4)',
	'$: s("gm_string_ensemble_2").note(`<<E4,F#4,A4,C#5,G#5,G#6>!3 <E4,F#4,A4,C#5,F#5,F#6>!1 <D4,F#4,A4,C#5,C#6>!4>`).fast(4).rel(.1).vel(.5).diode("1.5:0.33")',
	'$: ("gm_synth_bass_1").note("<F#2 D2 F#2 D2 B1!4>")',
	'$: s("oberheimdmx_bd!4").speed(.8).diode(.6).postgain(1.7)',
	'$: s("~ compurhythm8000_cp").fast(2).speed(.8)',
	'$: s("~ korgkr55_sd ~ korgkr55_sd*2").mask("<0!7 1!1>").fast(2).speed("1.03").vel(.8)',
	'$: s("~ rolandmc303_cp ~ ~").mask("<0!3 1!1>").fast(2).speed("1.1").vel(.9)',
	'$: s("gm_synth_brass_2").note(`<B3,D4,F#4,A4>!3 <B3,D4,F#4,C#5>`).s("sawtooth").slow(2).room(.2).struct("x ~ x x").hp("275").resonance(0.6).dec(.9).diode("1.9:0.66").gain("1 0.9 0.7 0.8").vel(.16).mask("<0@4 1@4>")',
].join('\n');

describe('source mapper', () => {
	test('projects marked labels and scalar chain controls', () => {
		const [pulse, glass] = getSourceBlockDetails(DEFAULT_SOURCE);

		expect(pulse).toMatchObject({ id: pulseId, name: 'Pulse', line: 4, label: '$', gain: 0.24, muted: false, soloed: false });
		expect(pulse.expressionRange?.line).toBe(5);
		expect(pulse.pan).toBeUndefined();
		expect(glass.gain).toBe(0.16);
	});

	test('updates only the selected block and appends missing pan', () => {
		const withGain = updateTrackGain(DEFAULT_SOURCE, pulseId, 0.5);
		const withPan = updateTrackPan(withGain, pulseId, 0.25);

		expect(withPan).toContain('$: note("<e2 e2 g2 b2>").s("sawtooth").gain(0.5).pan(0.25)');
		expect(withPan).toContain('$: note("<e4 b3 g4 a4>").s("triangle").gain(0.16)');
	});

	test('projects and updates controls across a multiline chain', () => {
		const source = `// @sushi-track {"id":"trk_multiline","name":"Lead","type":"synth","schema":1}\n$: n("<0 2 4>")\n  .s("sawtooth")\n  .gain(.5)\n  .room(.7)\n\n// @sushi-track {"id":"trk_other","name":"Other","type":"synth","schema":1}\n$: s("bd")`;
		const [lead] = getSourceBlockDetails(source);
		const updated = updateTrackGain(source, 'trk_multiline', 0.8);

		expect(lead.gain).toBe(0.5);
		expect(lead.gainEditable).toBe(true);
		expect(updated).toContain('  .gain(0.8)');
		expect(updated.match(/\.gain\(/g)?.length).toBe(1);
		expect(updated).toContain('  .room(.7)\n\n// @sushi-track');
	});

	test('uses Strudel labels for mute and solo', () => {
		const soloed = updateTrackMode(DEFAULT_SOURCE, pulseId, 'solo', true);
		const unmuted = updateTrackMode(soloed, pulseId, 'solo', false);
		const muted = updateTrackMode(unmuted, pulseId, 'mute', true);
		const restored = updateTrackMode(muted, pulseId, 'mute', false);

		expect(soloed).toContain('S$: note("<e2 e2 g2 b2>")');
		expect(muted).toContain('_$: note("<e2 e2 g2 b2>")');
		expect(unmuted).toContain('$: note("<e2 e2 g2 b2>")');
		expect(restored).toContain('$: note("<e2 e2 g2 b2>")');
	});

	test('does not rewrite non-scalar chain expressions', () => {
		const source = DEFAULT_SOURCE.replace('.gain(0.24)', '.gain(slider(0.24, 0, 1))');
		expect(updateTrackGain(source, pulseId, 0.5)).toBe(source);
	});

	test('projects source tempo, key, and cycle/second conversion', () => {
		const globals = getSourceGlobals(DEFAULT_SOURCE);

		expect(globals).toEqual({ bpm: 84, quarterNotesPerCycle: 4, key: 'E:minor' });
		expect(cyclesToSeconds(10.5, globals)).toBe(30);
		expect(secondsToCycles(30, globals)).toBe(10.5);
	});

	test('writes and reads explicit seqPLoop track ranges', () => {
		const ranged = updateTrackRange(DEFAULT_SOURCE, pulseId, 1, 3.5);
		const [pulse, glass] = getSourceBlockDetails(ranged);

		expect(ranged).toContain('seqPLoop([1, 3.5, note("<e2 e2 g2 b2>").s("sawtooth").gain(0.24)])');
		expect(pulse.timing).toEqual({ mode: 'seqPLoop', startCycle: 1, endCycle: 3.5 });
		expect(glass.timing).toEqual({ mode: 'full', startCycle: 0, endCycle: 4 });
	});

	test('updates the outer range of a multi-part seqPLoop', () => {
		const source = `// @sushi-track {"id":"trk_multirange","name":"Layer","type":"synth","schema":1}\n$: seqPLoop([0, 2, s("bd")], [3, 5, s("cp")])`;
		const updated = updateTrackRange(source, 'trk_multirange', 1, 4);
		const [layer] = getSourceBlockDetails(updated);

		expect(updated).toContain('seqPLoop([1, 2, s("bd")], [3, 4, s("cp")])');
		expect(layer.timing).toEqual({ mode: 'seqPLoop', startCycle: 1, endCycle: 4 });
	});

	test('keeps semicolon-terminated expressions valid when adding a range', () => {
		const source = `// @sushi-track {"id":"trk_semicolon","name":"Pulse","type":"synth","schema":1}\n$: s("bd");`;
		const updated = updateTrackRange(source, 'trk_semicolon', 1, 3);

		expect(updated).toContain('seqPLoop([1, 3, s("bd")]);');
		expect(() => new Function(updated.replace(/^\/\/.*\n/, ''))).not.toThrow();
	});

	test('projects arrange durations as a source timing span', () => {
		const arrangeSource = DEFAULT_SOURCE.replace(
			'note("<e2 e2 g2 b2>").s("sawtooth").gain(0.24)',
			'arrange([2, note("<e2 e2 g2 b2>").s("sawtooth")], [3, note("<a2 b2>").s("sawtooth")])',
		);
		const [pulse] = getSourceBlockDetails(arrangeSource);

		expect(pulse.timing).toEqual({ mode: 'arrange', startCycle: 0, endCycle: 5 });
	});

	test('projects an ordinary seven-lane Strudel song without Sushi markers', () => {
		const tracks = getSourceBlockDetails(REGULAR_STRUDEL_SONG);

		expect(tracks).toHaveLength(7);
		expect(tracks.map((track) => track.id)).toEqual([
			'trk_source_01',
			'trk_source_02',
			'trk_source_03',
			'trk_source_04',
			'trk_source_05',
			'trk_source_06',
			'trk_source_07',
		]);
		expect(tracks.map((track) => track.name)).toEqual([
			'GM String Ensemble 2',
			'GM Synth Bass 1',
			'Oberheim DMX BD',
			'Compurhythm 8000 CP',
			'Korg KR55 SD',
			'Roland MC303 CP',
			'GM Synth Brass 2',
		]);
		expect(tracks.map((track) => track.type)).toEqual(['synth', 'synth', 'drum', 'drum', 'drum', 'drum', 'synth']);
		expect(tracks.map((track) => track.line)).toEqual([2, 3, 4, 5, 6, 7, 8]);
		expect(getSourceGlobals(REGULAR_STRUDEL_SONG)).toMatchObject({ bpm: 90, quarterNotesPerCycle: 4 });
		expect(tracks.every((track) => track.timing.mode === 'full' && track.timing.startCycle === 0 && track.timing.endCycle === 4)).toBe(true);
	});
});
