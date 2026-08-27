import { describe, expect, test } from 'bun:test';
import { DEFAULT_SOURCE } from './model';
import {
	cyclesToSeconds,
	getSourceBlockDetails,
	getSourceGlobals,
	getTrackDisplayTiming,
	secondsToCycles,
	updateSourceKey,
	updateSourceQuarterNotesPerCycle,
	updateSourceTempo,
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

	test('preserves an authored label when toggling source modes', () => {
		const source = `// @sushi-track {"id":"trk_custom","name":"Lead","type":"synth","schema":1}\nlead$: s("sawtooth")`;
		const soloed = updateTrackMode(source, 'trk_custom', 'solo', true);
		const unsoloed = updateTrackMode(soloed, 'trk_custom', 'solo', false);
		const muted = updateTrackMode(source, 'trk_custom', 'mute', true);
		const restored = updateTrackMode(muted, 'trk_custom', 'mute', false);

		expect(soloed).toContain('Slead$: s("sawtooth")');
		expect(unsoloed).toContain('lead$: s("sawtooth")');
		expect(muted).toContain('_lead$: s("sawtooth")');
		expect(restored).toContain('lead$: s("sawtooth")');
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

	test('updates global tempo and cycle divisor without rewriting the source body', () => {
		const source = '  setcpm(84 / 4)\n\n$: s("bd")\n';
		const tempo = updateSourceTempo(source, 92);
		const divisor = updateSourceQuarterNotesPerCycle(tempo, 8);

		expect(divisor).toBe('  setcpm(92 / 8)\n\n$: s("bd")\n');
		expect(getSourceGlobals(divisor)).toEqual({ bpm: 92, quarterNotesPerCycle: 8, key: 'E:minor' });
	});

	test('adds missing global declarations and preserves key quote style', () => {
		const source = '$: s("bd")\n';
		const withTempo = updateSourceTempo(source, 100);
		const withDivisor = updateSourceQuarterNotesPerCycle(withTempo, 2);
		const withKey = updateSourceKey(withDivisor, 'D:minor');

		expect(withKey).toBe('setcpm(100 / 2)\nconst key = "D:minor"\n$: s("bd")\n');
		const singleValue = updateSourceQuarterNotesPerCycle("setcpm(90)\n$: s('bd')", 3);
		expect(singleValue).toBe("setcpm(90 / 3)\n$: s('bd')");

		const singleQuotedKey = updateSourceKey("const key = 'E:minor';\n$: s('bd')", 'A:major');
		expect(singleQuotedKey).toContain("const key = 'A:major';");
	});

	test('ignores invalid global control values', () => {
		expect(updateSourceTempo(DEFAULT_SOURCE, 0)).toBe(DEFAULT_SOURCE);
		expect(updateSourceQuarterNotesPerCycle(DEFAULT_SOURCE, Number.NaN)).toBe(DEFAULT_SOURCE);
		expect(updateSourceKey(DEFAULT_SOURCE, 'bad\nkey')).toBe(DEFAULT_SOURCE);
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

	test('keeps trailing comments outside generated source controls', () => {
		const source = `// @sushi-track {"id":"trk_comment","name":"Pulse","type":"synth","schema":1}\n$: s("bd") // keep this note\n`;
		const withGain = updateTrackGain(source, 'trk_comment', 0.5);
		const withRange = updateTrackRange(withGain, 'trk_comment', 1, 3);

		expect(withRange).toContain('seqPLoop([1, 3, s("bd").gain(0.5)]) // keep this note');
		expect(() => new Function(withRange.replace(/^\/\/.*\n/, ''))).not.toThrow();
	});

	test('ignores non-finite mixer values instead of writing invalid JavaScript', () => {
		const source = DEFAULT_SOURCE;
		expect(updateTrackGain(source, 'trk_01J4PULSE', Number.NaN)).toBe(source);
		expect(updateTrackPan(source, 'trk_01J4PULSE', Number.POSITIVE_INFINITY)).toBe(source);
	});

	test('respects a source meter subdivision when writing a short range', () => {
		const source = `// @sushi-track {"id":"trk_subdivision","name":"Pulse","type":"synth","schema":1}\n$: s("bd")`;
		const updated = updateTrackRange(source, 'trk_subdivision', 0, 0.125, 0.125);
		const [track] = getSourceBlockDetails(updated);

		expect(track.timing).toEqual({ mode: 'seqPLoop', startCycle: 0, endCycle: 0.125 });
	});

	test('projects arrange durations as a source timing span', () => {
		const arrangeSource = DEFAULT_SOURCE.replace(
			'note("<e2 e2 g2 b2>").s("sawtooth").gain(0.24)',
			'arrange([2, note("<e2 e2 g2 b2>").s("sawtooth")], [3, note("<a2 b2>").s("sawtooth")])',
		);
		const [pulse] = getSourceBlockDetails(arrangeSource);

		expect(pulse.timing).toEqual({ mode: 'arrange', startCycle: 0, endCycle: 5 });
	});

	test('accepts whitespace before source timing call parentheses', () => {
		const seqLoop = getSourceBlockDetails(`// @sushi-track {"id":"trk_space_loop","name":"Loop","type":"synth","schema":1}\n$: seqPLoop ([0, 2, s("bd")])`)[0];
		const arranged = getSourceBlockDetails(`// @sushi-track {"id":"trk_space_arrange","name":"Arrange","type":"synth","schema":1}\n$: arrange ([2, s("bd")], [3, s("sd")])`)[0];

		expect(seqLoop.timing).toEqual({ mode: 'seqPLoop', startCycle: 0, endCycle: 2 });
		expect(arranged.timing).toEqual({ mode: 'arrange', startCycle: 0, endCycle: 5 });
	});

	test('projects sound aliases as ordinary Strudel lanes', () => {
		const [track] = getSourceBlockDetails(`$: sound("gm_synth_bass_1")`);

		expect(track.name).toBe('GM Synth Bass 1');
		expect(track.type).toBe('synth');
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

	test('keeps generated projection IDs away from authored marker IDs', () => {
		const source = [
			'$: s("bd")',
			'// @sushi-track {"id":"trk_source_01","name":"Marked","type":"synth","schema":1}',
			'$: s("sawtooth")',
		].join('\n');
		const tracks = getSourceBlockDetails(source);

		expect(tracks.map((track) => track.id)).toEqual(['trk_source_01-2', 'trk_source_01']);
	});

	test('uses the project boundary for full-length tracks', () => {
		const [track] = getSourceBlockDetails(DEFAULT_SOURCE, 16);

		expect(track.timing).toEqual({ mode: 'full', startCycle: 0, endCycle: 16 });
	});

	test('projects repeating seqPLoop lanes through the project boundary', () => {
		const display = getTrackDisplayTiming({ mode: 'seqPLoop', startCycle: 0, endCycle: 4 }, 16);
		const arranged = getTrackDisplayTiming({ mode: 'arrange', startCycle: 0, endCycle: 5 }, 16);

		expect(display).toEqual({ mode: 'seqPLoop', startCycle: 0, endCycle: 4, displayEndCycle: 16, repeating: true });
		expect(arranged).toEqual({ mode: 'arrange', startCycle: 0, endCycle: 5, displayEndCycle: 5, repeating: false });
	});
});
