import { describe, expect, test } from 'bun:test';
import { DEFAULT_SOURCE, DEFAULT_SONG_END_CYCLE, EXTENDED_SONG_END_CYCLE, createInitialProject } from './model';
import {
	cyclesToSeconds,
	deleteTrack,
	extendTrackSourceRangeWithRest,
	getSourceBlockDetails,
	getSourceGlobals,
	getTrackDisplayTiming,
	addTrackEffect,
	removeTrackEffect,
	reorderTrackEffect,
	secondsToCycles,
	updateSourceKey,
	updateSourceQuarterNotesPerCycle,
	updateSourceTempo,
	updateSourceBpm,
	updateTrackColor,
	updateTrackGain,
	updateTrackMode,
	updateTrackName,
	updateTrackPan,
	updateTrackRange,
	updateTrackSlider,
	updateTrackEffect,
	updateTrackSound,
	toggleTrackEffect,
	setTrackEffectsEnabled,
} from './source-mapper';

const pulseId = 'trk_01J4PULSE';

const TRACKED_SOURCE = `setcpm(84 / 4)
const key = "E:minor"

// @sushi-track {"id":"trk_01J4PULSE","name":"Pulse","type":"synth","schema":1}
$: note("<e2 e2 g2 b2>").s("sawtooth").gain(0.24)

// @sushi-track {"id":"trk_01JGLASS","name":"Glass lead","type":"synth","schema":1}
$: note("<e4 b3 g4 a4>").s("triangle").gain(0.16)
`;

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
	test('starts with only the tempo and key header', () => {
		expect(DEFAULT_SOURCE).toBe('setcpm(150 / 4)\nconst key = "E:minor"\n');
		expect(getSourceBlockDetails(DEFAULT_SOURCE)).toHaveLength(0);
		expect(DEFAULT_SONG_END_CYCLE).toBe(30);
		expect(EXTENDED_SONG_END_CYCLE).toBe(137);
		expect(createInitialProject().timeline.songEndCycle).toBe(DEFAULT_SONG_END_CYCLE);
		expect(cyclesToSeconds(DEFAULT_SONG_END_CYCLE, getSourceGlobals(DEFAULT_SOURCE))).toBe(48);
	});

	test('projects marked labels and scalar chain controls', () => {
		const [pulse, glass] = getSourceBlockDetails(TRACKED_SOURCE);

		expect(pulse).toMatchObject({ id: pulseId, name: 'Pulse', line: 4, label: '$', gain: 0.24, muted: false, soloed: false });
		expect(pulse.expressionRange?.line).toBe(5);
		expect(pulse.pan).toBeUndefined();
		expect(glass.gain).toBe(0.16);
	});

	test('updates only the selected block and appends missing pan', () => {
		const withGain = updateTrackGain(TRACKED_SOURCE, pulseId, 0.5);
		const withPan = updateTrackPan(withGain, pulseId, 0.25);

		expect(withPan).toContain('$: note("<e2 e2 g2 b2>").s("sawtooth").gain(0.5).pan(0.25)');
		expect(withPan).toContain('$: note("<e4 b3 g4 a4>").s("triangle").gain(0.16)');
	});

	test('projects source colors and updates or appends color calls', () => {
		const source = TRACKED_SOURCE.replace('.gain(0.24)', '.gain(0.24).color("#ff4d00")');
		const [pulse, glass] = getSourceBlockDetails(source);

		expect(pulse).toMatchObject({ color: '#ff4d00', colorEditable: true });
		expect(glass.color).toBeUndefined();
		expect(glass.colorEditable).toBe(true);

		const updated = updateTrackColor(source, pulseId, '#8fe1ff');
		const appended = updateTrackColor(updated, 'trk_01JGLASS', '#c7a6ff');

		expect(appended).toContain('.gain(0.24).color("#8fe1ff")');
		expect(appended).toContain('.s("triangle").gain(0.16).color("#c7a6ff")');
	});

	test('projects Strudel visualizer hooks from source chains', () => {
		const source = `// @sushi-track {"id":"trk_roll","name":"Roll","type":"synth","schema":1}
$: n("c4 e4 g4").s("sine")._pianoroll()
// @sushi-track {"id":"trk_scope","name":"Scope","type":"drum","schema":1}
_$: s("bd*4")._scope()`;
		const [roll, scope] = getSourceBlockDetails(source);

		expect(roll.visualizer).toBe('pianoroll');
		expect(scope.visualizer).toBe('scope');
	});

	test('projects named Strudel labels and spectrum visualizers', () => {
		const source = `closehat: s("hh16")._spectrum()
openhat: s("[~ hh]*4")._spectrum()`;
		const [closehat, openhat] = getSourceBlockDetails(source);

		expect(closehat).toMatchObject({ label: 'closehat', visualizer: 'spectrum', line: 1 });
		expect(openhat).toMatchObject({ label: 'openhat', visualizer: 'spectrum', line: 2 });

		const muted = updateTrackMode(source, closehat.id, 'mute', true);
		expect(muted).toContain('_closehat: s("hh16")._spectrum()');
	});

	test('keeps named lanes beginning with S intact when toggling modes', () => {
		const source = 'Supersaw: s("supersaw")';
		const [track] = getSourceBlockDetails(source);

		expect(track).toMatchObject({ label: 'Supersaw', muted: false, soloed: false });
		expect(updateTrackMode(source, track.id, 'mute', true)).toBe('_Supersaw: s("supersaw")');
	});

	test('projects and updates numeric Strudel sliders', () => {
		const source = `// @sushi-track {"id":"trk_slider","name":"Filter","type":"synth","schema":1}
$: s("sawtooth").lpf(slider(200, 200, 4000)).gain(slider(.5, 0, 1, .01))`;
		const [track] = getSourceBlockDetails(source);

		expect(track.sliders).toEqual([
			{ id: 'slider-0', label: 'LPF', value: 200, min: 200, max: 4000 },
			{ id: 'slider-1', label: 'GAIN', value: 0.5, min: 0, max: 1, step: 0.01 },
		]);

		const updated = updateTrackSlider(source, 'trk_slider', 'slider-0', 2200);
		const clamped = updateTrackSlider(updated, 'trk_slider', 'slider-1', 2);
		expect(clamped).toContain('.lpf(slider(2200, 200, 4000)).gain(slider(1, 0, 1, .01))');

		const spaced = source.replace('slider(200, 200, 4000)', 'slider( 200 , 200, 4000)');
		expect(updateTrackSlider(spaced, 'trk_slider', 'slider-0', 2200)).toContain('slider( 2200 , 200, 4000)');
	});

	test('projects and updates supported Strudel FX controls', () => {
		const source = `// @sushi-track {"id":"trk_fx","name":"FX layer","type":"synth","schema":1}
$: s("supersaw").detune(rand).lpenv(1).octave(0).room(1.7)`;
		const [track] = getSourceBlockDetails(source);

		expect(track.effects).toMatchObject([
			{
				id: 'effect-detune-0',
				method: 'detune',
				label: 'DETUNE',
				kind: 'random',
				expression: 'rand',
				min: 0,
				max: 24,
				step: 0.1,
				defaultValue: 0,
				supportsRandom: true,
			},
			{
				id: 'effect-lpenv-0',
				method: 'lpenv',
				label: 'LP ENV',
				kind: 'numeric',
				expression: '1',
				value: 1,
				min: -8,
				max: 8,
				step: 0.1,
				defaultValue: 1,
				supportsRandom: false,
			},
			{
				id: 'effect-octave-0',
				method: 'octave',
				label: 'OCTAVE',
				kind: 'numeric',
				expression: '0',
				value: 0,
				min: -4,
				max: 4,
				step: 1,
				defaultValue: 0,
				supportsRandom: false,
			},
			{
				id: 'effect-room-0',
				method: 'room',
				label: 'ROOM',
				kind: 'numeric',
				expression: '1.7',
				value: 1.7,
				min: 0,
				max: 1.7,
				step: 0.01,
				defaultValue: 0.5,
				supportsRandom: false,
			},
		]);
		expect(track.effects[0].definition.source).toBe('strudel');
		expect(track.effects[0].parameters[0]).toMatchObject({ name: 'amount', kind: 'random' });

		const manual = updateTrackEffect(source, 'trk_fx', 'effect-detune-0', 4.2);
		const random = updateTrackEffect(manual, 'trk_fx', 'effect-detune-0', 'rand');
		const room = updateTrackEffect(random, 'trk_fx', 'effect-room-0', 0.25);
		expect(room).toContain('.detune(rand).lpenv(1).octave(0).room(0.25)');

		const duplicate = addTrackEffect(room, 'trk_fx', 'room');
		expect(duplicate).toBe(room);
		const withoutRoom = removeTrackEffect(room, 'trk_fx', 'effect-room-0');
		expect(withoutRoom).toContain('$: s("supersaw").detune(rand).lpenv(1).octave(0)');

		const addedRoom = addTrackEffect(withoutRoom, 'trk_fx', 'room');
		expect(addedRoom).toContain('.room(0.5)');
	});

	test('bypasses and reorders supported Strudel FX controls in source', () => {
		const source = `// @sushi-track {"id":"trk_fx_drawer","name":"FX layer","type":"synth","schema":1}
$: s("supersaw").detune(rand).lpenv(1).octave(0).room(1.7)`;
		const bypassed = toggleTrackEffect(source, 'trk_fx_drawer', 'effect-room-0', false);
		const [bypassedTrack] = getSourceBlockDetails(bypassed);
		expect(bypassed).toContain('/* @sushi-bypass .room(1.7) */');
		expect(bypassedTrack.effects.at(-1)).toMatchObject({ id: 'effect-room-0', expression: '1.7', enabled: false });

		const updated = updateTrackEffect(bypassed, 'trk_fx_drawer', 'effect-room-0', 0.25);
		expect(updated).toContain('/* @sushi-bypass .room(0.25) */');
		const restored = toggleTrackEffect(updated, 'trk_fx_drawer', 'effect-room-0', true);
		expect(restored).toContain('.room(0.25)');
		expect(restored).not.toContain('@sushi-bypass');

		const moved = reorderTrackEffect(source, 'trk_fx_drawer', 'effect-room-0', 'up');
		expect(moved.indexOf('.room(1.7)')).toBeLessThan(moved.indexOf('.octave(0)'));
	});

	test('ignores nested effect calls inside callback expressions', () => {
		const source = `// @sushi-track {"id":"trk_nested_fx","name":"Nested FX","type":"synth","schema":1}
$: s("bd").when(x => x.delay(1)).room(.2).crush(4)`;
		const [track] = getSourceBlockDetails(source);

		expect(track.effects.map((effect) => effect.method)).toEqual(['room', 'crush']);
		const bypassed = toggleTrackEffect(source, 'trk_nested_fx', 'effect-room-0', false);
		expect(bypassed).toContain('.when(x => x.delay(1))');
		expect(bypassed).toContain('/* @sushi-bypass .room(.2) */');
		expect(bypassed).not.toContain('@sushi-bypass .delay(1)');

		const moved = reorderTrackEffect(source, 'trk_nested_fx', 'effect-room-0', 'down');
		expect(moved).toContain('.when(x => x.delay(1)).crush(4).room(.2)');
	});

	test('discovers controls inside timing wrappers', () => {
		const source = `// @sushi-track {"id":"trk_wrapped_chain","name":"Wrapped Chain","type":"synth","schema":1}
$: seqPLoop([0, 4, s("bd").when(x => x.delay(1)).room(.2)])`;
		const [track] = getSourceBlockDetails(source);

		expect(track.sound?.token).toBe('bd');
		expect(track.effects.map((effect) => effect.method)).toEqual(['room']);
	});

	test('resolves ambiguous Strudel aliases to their runtime controls', () => {
		const source = `// @sushi-track {"id":"trk_alias_fx","name":"Alias FX","type":"synth","schema":1}
$: s("bd").size(2).delaytime(.5)`;
		const [track] = getSourceBlockDetails(source);

		expect(track.effects.map((effect) => effect.method)).toEqual(['roomsize', 'delaytime']);
		expect(updateTrackEffect(source, 'trk_alias_fx', 'effect-roomsize-0', 3)).toContain('.size(3)');
	});

	test('bulk enables and bypasses every effect in a source lane', () => {
		const source = `// @sushi-track {"id":"trk_bulk_fx","name":"Bulk FX","type":"synth","schema":1}
$: s("supersaw").detune(rand).room(1.7).futureEffect(sine.range(0, 1))`;
		const bypassed = setTrackEffectsEnabled(source, 'trk_bulk_fx', false);
		expect(bypassed.match(/@sushi-bypass/g)).toHaveLength(3);
		expect(getSourceBlockDetails(bypassed)[0].effects.every((effect) => effect.enabled === false)).toBe(true);

		const enabled = setTrackEffectsEnabled(bypassed, 'trk_bulk_fx', true);
		expect(enabled).toContain('.detune(rand).room(1.7).futureEffect(sine.range(0, 1))');
		expect(enabled).not.toContain('@sushi-bypass');
	});

	test('keeps unknown Strudel controls as generic effects and can edit them', () => {
		const source = `// @sushi-track {"id":"trk_future_fx","name":"Future FX","type":"synth","schema":1}
$: s("supersaw").futureEffect(sine.range(0, 1)).chorus(.4)`;
		const [track] = getSourceBlockDetails(source);

		expect(track.effects).toHaveLength(2);
		expect(track.effects[0]).toMatchObject({ method: 'futureEffect', label: 'FUTURE EFFECT', definition: { source: 'fallback', group: 'unknown' }, kind: 'dynamic' });
		expect(track.effects[0].parameters[0]).toMatchObject({ type: 'expression', expression: 'sine.range(0, 1)' });

		const edited = updateTrackEffect(source, 'trk_future_fx', 'effect-futureEffect-0', 'triangle.range(0, 1)');
		expect(edited).toContain('.futureEffect(triangle.range(0, 1)).chorus(.4)');
		const bypassed = toggleTrackEffect(edited, 'trk_future_fx', 'effect-futureEffect-0', false);
		expect(bypassed).toContain('/* @sushi-bypass .futureEffect(triangle.range(0, 1)) */');
		const removed = removeTrackEffect(bypassed, 'trk_future_fx', 'effect-futureEffect-0');
		expect(removed).toContain('.chorus(.4)');
	});

	test('does not classify ordinary pattern helpers as unknown effects', () => {
		const source = `// @sushi-track {"id":"trk_pattern_helpers","name":"Pattern helpers","type":"synth","schema":1}
$: n("0").scale("c:minor").fast(2).range(0, 1).when(() => true).room(.5)`;
		const [track] = getSourceBlockDetails(source);

		expect(track.effects.map((effect) => effect.method)).toEqual(['room']);
	});

	test('supports multi-parameter effect updates through the shared definitions', () => {
		const source = `// @sushi-track {"id":"trk_distort","name":"Distort","type":"synth","schema":1}
$: s("bd").distort(2, .5, "diode")`;
		const updated = updateTrackEffect(source, 'trk_distort', 'effect-distort-0', 0.8, 1);
		expect(updated).toContain('.distort(2, 0.8, "diode")');
	});

	test('ignores sliders inside source comments', () => {
		const source = `// @sushi-track {"id":"trk_plain","name":"Plain","type":"synth","schema":1}
$: s("sine") // slider(200, 0, 1)
  /* slider(300, 0, 1) */`;
		const [track] = getSourceBlockDetails(source);

		expect(track.sliders).toEqual([]);
	});

	test('ignores visualizer names inside source comments', () => {
		const source = `// @sushi-track {"id":"trk_plain","name":"Plain","type":"synth","schema":1}
$: s("sine") // ._scope()
  // ._pianoroll()`;
		const [track] = getSourceBlockDetails(source);

		expect(track.visualizer).toBeUndefined();
	});

	test('does not rewrite dynamic or unsafe source colors', () => {
		const dynamic = TRACKED_SOURCE.replace('.gain(0.24)', '.gain(0.24).color(rand)');
		const [pulse] = getSourceBlockDetails(dynamic);

		expect(pulse.color).toBeUndefined();
		expect(pulse.colorEditable).toBe(false);
		expect(updateTrackColor(dynamic, pulseId, '#ff4d00')).toBe(dynamic);
		expect(updateTrackColor(TRACKED_SOURCE, pulseId, 'var(--danger)')).toBe(TRACKED_SOURCE);
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
		const soloed = updateTrackMode(TRACKED_SOURCE, pulseId, 'solo', true);
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
		const source = TRACKED_SOURCE.replace('.gain(0.24)', '.gain(slider(0.24, 0, 1))');
		expect(updateTrackGain(source, pulseId, 0.5)).toBe(source);
	});

	test('renames a marked track without changing its identity', () => {
		const renamed = updateTrackName(TRACKED_SOURCE, pulseId, 'Warm Pulse');
		const [pulse, glass] = getSourceBlockDetails(renamed);

		expect(pulse).toMatchObject({ id: pulseId, name: 'Warm Pulse' });
		expect(glass.name).toBe('Glass lead');
		expect(renamed).toContain('// @sushi-track {"id":"trk_01J4PULSE","name":"Warm Pulse","type":"synth","schema":1}');
	});

	test('promotes an unmanaged track when it is renamed', () => {
		const source = '$: s("bd")';
		const renamed = updateTrackName(source, 'trk_source_01', 'Kick');
		const [track] = getSourceBlockDetails(renamed);

		expect(track).toMatchObject({ id: 'trk_source_01', name: 'Kick', marker: true });
		expect(renamed).toContain('// @sushi-track {"id":"trk_source_01","name":"Kick","type":"drum","schema":1}\n$: s("bd")');
	});

	test('deletes only the selected source block', () => {
		const deleted = deleteTrack(TRACKED_SOURCE, pulseId);
		const tracks = getSourceBlockDetails(deleted);

		expect(tracks).toHaveLength(1);
		expect(tracks[0]).toMatchObject({ id: 'trk_01JGLASS', name: 'Glass lead' });
		expect(deleted).not.toContain('trk_01J4PULSE');
	});

	test('leaves only the canonical header when the last track is deleted', () => {
		const source = `${DEFAULT_SOURCE}\n// @sushi-track {"id":"trk_source_01","name":"Kick","type":"drum","schema":1}\n$: s("bd")\n`;
		const deleted = deleteTrack(source, 'trk_source_01');

		expect(getSourceBlockDetails(deleted)).toHaveLength(0);
		expect(deleted).toBe(`${DEFAULT_SOURCE}\n`);
	});

	test('removes both seeded tracks without leaving a parsed ghost block', () => {
		const deletedPulse = deleteTrack(TRACKED_SOURCE, pulseId);
		const deletedBoth = deleteTrack(deletedPulse, 'trk_01JGLASS');

		expect(getSourceBlockDetails(deletedBoth)).toHaveLength(0);
		expect(deletedBoth).toBe('setcpm(84 / 4)\nconst key = "E:minor"\n\n');
	});

	test('does not project an orphan marker after its source track expression is deleted', () => {
		const withoutPulseExpression = TRACKED_SOURCE.replace('$: note("<e2 e2 g2 b2>").s("sawtooth").gain(0.24)\n', '');
		const tracks = getSourceBlockDetails(withoutPulseExpression);

		expect(tracks).toHaveLength(1);
		expect(tracks[0]).toMatchObject({ id: 'trk_01JGLASS', name: 'Glass lead' });
	});

	test('projects source tempo, key, and cycle/second conversion', () => {
		const globals = getSourceGlobals(TRACKED_SOURCE);

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

	test('updates the canonical tempo and key declarations', () => {
		const withTempo = updateSourceBpm(TRACKED_SOURCE, 150);
		const withKey = updateSourceKey(withTempo, 'C:major');

		expect(withKey).toContain('setcpm(150 / 4)');
		expect(withKey).toContain('const key = "C:major"');
		expect(getSourceGlobals(withKey)).toMatchObject({ bpm: 150, quarterNotesPerCycle: 4, key: 'C:major' });
	});

	test('allows a zero BPM source value without producing infinite timeline seconds', () => {
		const source = updateSourceBpm(DEFAULT_SOURCE, 0);
		const globals = getSourceGlobals(source);

		expect(source).toContain('setcpm(0 / 4)');
		expect(globals.bpm).toBe(0);
		expect(cyclesToSeconds(4, globals)).toBe(0);
	});

	test('preserves old source timing when appending an empty range', () => {
		const source = `// @sushi-track {"id":"trk_complex","name":"Complex","type":"synth","schema":1}\n$: seqPLoop([0, 4, s("bd*4").fast(2)])`;
		const extended = extendTrackSourceRangeWithRest(source, 'trk_complex', 4, 8);
		const [track] = getSourceBlockDetails(extended);

		expect(extended).toContain('seqPLoop([0, 4, s("bd*4").fast(2)], [4, 8, s("~")])');
		expect(track.timing).toEqual({ mode: 'seqPLoop', startCycle: 0, endCycle: 8 });

		const full = extendTrackSourceRangeWithRest('$: s("bd*4")', 'trk_source_01', 4, 8);
		expect(full).toContain('seqPLoop([0, 4, s("bd*4")], [4, 8, s("~")])');
		const shortened = updateTrackRange(extended, 'trk_complex', 0, 4);
		expect(shortened).toContain('seqPLoop([0, 4, s("bd*4").fast(2)])');
		expect(shortened).not.toContain('DivisionByZero');
	});

	test('writes and reads explicit seqPLoop track ranges', () => {
		const ranged = updateTrackRange(TRACKED_SOURCE, pulseId, 1, 3.5);
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

		const moved = updateTrackRange(source, 'trk_multirange', 2, 7);
		expect(moved).toContain('seqPLoop([2, 4, s("bd")], [5, 7, s("cp")])');
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

	test('keeps comment-only lines outside generated source controls', () => {
		const source = `// @sushi-track {"id":"trk_comment_line","name":"Pulse","type":"synth","schema":1}\n$: s("bd")\n// keep this note\n\n$: s("cp")`;
		const updated = updateTrackRange(source, 'trk_comment_line', 1, 3);

		expect(updated).toContain('seqPLoop([1, 3, s("bd")])\n// keep this note');
		expect(updated).not.toContain('// keep this note])');
		expect(() => new Function(updated.replace(/^\/\/.*\n/, ''))).not.toThrow();
	});

	test('does not treat URL-like strings as trailing comments', () => {
		const source = `// @sushi-track {"id":"trk_url","name":"Sample","type":"sample","schema":1}\n$: s("https://example.com/sample")`;
		const updated = updateTrackGain(source, 'trk_url', 0.5);

		expect(updated).toContain('s("https://example.com/sample").gain(0.5)');
		expect(() => new Function(updated.replace(/^\/\/.*\n/, ''))).not.toThrow();
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
		const arrangeSource = TRACKED_SOURCE.replace(
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
		expect(track.sound).toMatchObject({ method: 'sound', kind: 'static', value: 'gm_synth_bass_1', definition: { id: 'gm_synth_bass_1' } });
	});

	test('projects unknown and dynamic sounds without rejecting their source', () => {
		const source = [
			'// @sushi-track {"id":"trk_unknown_sound","name":"Unknown","type":"sample","schema":1}',
			'$: s("future_custom_sound")',
			'// @sushi-track {"id":"trk_dynamic_sound","name":"Dynamic","type":"sample","schema":1}',
			'_: sound(soundName)',
		].join('\n');
		const [unknown, dynamic] = getSourceBlockDetails(source);

		expect(unknown.sound).toMatchObject({ kind: 'static', value: 'future_custom_sound', token: 'future_custom_sound' });
		expect(unknown.sound?.definition).toBeUndefined();
		expect(dynamic.sound).toMatchObject({ kind: 'dynamic', expression: 'soundName', token: 'soundName' });
	});

	test('updates first sound calls and appends a sound to tracks without one', () => {
		const source = [
			'// @sushi-track {"id":"trk_short","name":"Short","type":"synth","schema":1}',
			'$: n("c4").s("sawtooth").gain(.5)',
			'// @sushi-track {"id":"trk_long","name":"Long","type":"synth","schema":1}',
			'$: n("c4").sound(soundName).gain(.5)',
			'// @sushi-track {"id":"trk_direct","name":"Direct","type":"synth","schema":1}',
			'$: ("triangle").note("c4")',
			'// @sushi-track {"id":"trk_append","name":"Append","type":"synth","schema":1}',
			'$: n("c4").gain(.5)',
		].join('\n');

		const updated = updateTrackSound(source, 'trk_short', 'piano');
		const dynamic = updateTrackSound(updated, 'trk_long', 'supersaw');
		const direct = updateTrackSound(dynamic, 'trk_direct', 'sine');
		const appended = updateTrackSound(direct, 'trk_append', 'bytebeat');

		expect(appended).toContain('$: n("c4").s("piano").gain(.5)');
		expect(appended).toContain('$: n("c4").sound("supersaw").gain(.5)');
		expect(appended).toContain('$: ("sine").note("c4")');
		expect(appended).toContain('$: n("c4").gain(.5).sound("bytebeat")');
	});

	test('keeps nested sound calls out of source sound edits', () => {
		const source = `// @sushi-track {"id":"trk_nested_sound","name":"Nested Sound","type":"sample","schema":1}
$: s("bd").when(() => s("sd")).sound("hh")`;
		const [track] = getSourceBlockDetails(source);

		expect(track.sound?.token).toBe('bd');
		const updated = updateTrackSound(source, 'trk_nested_sound', 'cp');
		expect(updated).toContain('$: s("cp").when(() => s("sd")).sound("hh")');
	});

	test('projects layered sound voices and updates a selected nested call', () => {
		const source = `// @sushi-track {"id":"trk_layered_sound","name":"Layered","type":"synth","schema":1}
$: seqPLoop([n("<0 2 -1 -2>/2")
  .layer(
    x => x.transpose(-12).sound("supersaw").gain(.22),
    x => x.transpose(-24).sound("sine").gain(.15)
  )
  .lpf(1050)])`;
		const [track] = getSourceBlockDetails(source);

		expect(track.sounds.map((voice) => voice.token)).toEqual(['supersaw', 'sine']);
		expect(track.sounds.map((voice) => voice.scope)).toEqual(['nested', 'nested']);
		expect(track.sounds.map((voice) => voice.label)).toEqual(['Nested voice 1', 'Nested voice 2']);
		expect(track.sound?.id).toBe('sound-0');

		const updated = updateTrackSound(source, track.id, 'triangle', 'sound-1');
		expect(updated).toContain('x => x.transpose(-12).sound("supersaw").gain(.22)');
		expect(updated).toContain('x => x.transpose(-24).sound("triangle").gain(.15)');
	});

	test('keeps nested mixer and color calls out of track-level controls', () => {
		const source = `// @sushi-track {"id":"trk_layered_mix","name":"Layered mix","type":"synth","schema":1}
$: n("0").layer(
  x => x.sound("supersaw").gain(.22).color("#ff0000"),
  x => x.sound("sine").gain(.15)
)`;
		const [track] = getSourceBlockDetails(source);

		expect(track.gain).toBeUndefined();
		expect(track.color).toBeUndefined();
		expect(track.gainEditable).toBe(true);
		expect(track.colorEditable).toBe(true);

		const withGain = updateTrackGain(source, track.id, 0.8);
		const withColor = updateTrackColor(withGain, track.id, '#00ff00');
		expect(withColor).toContain('x => x.sound("supersaw").gain(.22).color("#ff0000")');
		expect(withColor).toContain(').gain(0.8).color("#00ff00")');
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

	test('projects every ordinary source lane without a fixed count cap', () => {
		const source = Array.from({ length: 12 }, (_, index) => `$: s("sawtooth") // lane ${index + 1}`).join('\n');
		const tracks = getSourceBlockDetails(source);

		expect(tracks).toHaveLength(12);
		expect(tracks.map((track) => track.id)).toEqual(Array.from({ length: 12 }, (_, index) => `trk_source_${(index + 1).toString().padStart(2, '0')}`));
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
		const [track] = getSourceBlockDetails(REGULAR_STRUDEL_SONG, 16);

		expect(track.timing).toEqual({ mode: 'full', startCycle: 0, endCycle: 16 });
	});

	test('projects repeating seqPLoop lanes through the project boundary', () => {
		const display = getTrackDisplayTiming({ mode: 'seqPLoop', startCycle: 0, endCycle: 4 }, 16);
		const arranged = getTrackDisplayTiming({ mode: 'arrange', startCycle: 0, endCycle: 5 }, 16);

		expect(display).toEqual({ mode: 'seqPLoop', startCycle: 0, endCycle: 4, displayEndCycle: 16, repeating: true });
		expect(arranged).toEqual({ mode: 'arrange', startCycle: 0, endCycle: 5, displayEndCycle: 5, repeating: false });
	});
});
