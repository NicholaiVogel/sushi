export interface EditorPreset {
	id: string;
	name: string;
	description: string;
	bpm: number;
	key: string;
	lanes: number;
	source: string;
}

const TRACK_01_SOURCE = String.raw`setcpm(100 / 4)

const key = "c:minor"

register('acidenv', (x, pat) => pat.lpf(100)
    .lpenv(x * 9).lps(.2).lpd(.12)
)

// melody
$: n("<0 1 4 2 7 8 4 1>*16".add("<0 _ _ -1 -4 _ 7 -1 >*2"))
    .scale(key)
    .detune(rand)
    .octave(1)
    .gain(.4)
    .s("sawtooth")
    .lpf(slider(1424, 200, 2000))
    .lpenv(2)
    .decay(.9)
    .room(.6)
    ._pianoroll()
// gentle synth
$: n("<0 2 4 6 0 7 9 4>*8".add("<0 _ _ -1 -4 _ 7 4>*2"))
    .scale(key)
    .detune(rand)
    .octave(1)
    .s("supersaw")
    .lpf(slider(4000, 200, 4000))
    .gain(1)
    .delay(0.5)
    .room(1.6)
    ._pianoroll()

// harmonies
$: n("<0 4 -1 5>*2".add("<0 1 2>*2"))
    .scale(key)
    .detune(rand)
    .octave(1)
    .s("supersaw")
    .lpf(slider(3437.6, 200, 4000))
    .gain(.5)
    .delay(0.9)
    .room(3.6)
    ._pianoroll()


// melody
$: n("<0 2 4 6 0 7 9 4>*8".add("<0 _ _ -1 -4 _ 7 4>*2"))
    .scale(key)
    .detune(rand)
    .octave(1)
    .s("sawtooth")
    .lpf(slider(1526.6, 200, 2000))
    .gain(2)
    .delay(0.5)
    .room(1.25)
    ._pianoroll()


// bass
$: n("<0>*16".add("<0 _ _ <-1 1> 2 _ -2 -1>*2"))
    .scale(key)
    .detune(rand)
    .octave(-1)
    .s("sawtooth")
    .lpf(slider(1578.8, 200, 2000))
    .lpenv(4)
    .gain(.6)
    .room(1)
    .decay(0.6)
    ._pianoroll()

// sub bass 
$: n("<0>*2".add("<0 _ _ <-1 1> -4 _ -2 -1>*2"))
    .scale(key)
    .octave(-1)
    .s("sawtooth")
    .gain(1.5)
    .lpf(1200)
    ._pianoroll()


//kick drum 
$: s("bd:2!4")
    .duck("3:4:5:6")
    .detune(rand)
    .lpf(slider(1474.4, 200, 2000))
    .duckdepth(.8)
    .duckattack(.16)
    .gain(1.2)
    ._scope()

// hi-hats - offbeat groove_
$: s("~ hh*2 hh*4 hh*2")
    .gain(1)
    .lpf(8000)
    .pan(sine.range(0.3, 0.7).slow(2))
    ._scope()

// snare on 2 and 4
// adding this makes it go crazy: .add("<3 _ 4>")
$: s("sd:2 sd:3 sd:2 sd:3")
    .gain(0.4)
    .room(1.3)
    ._scope()
`;

const TRACK_02_SOURCE = String.raw`setcpm(120 / 4)

const key = "c:minor"

register('acidenv', (x, pat) => pat.lpf(100)
    .lpenv(x * 9).lps(.2).lpd(.12)
)

// track02 scaffold
// idea:
// - swap bpm/key as needed
// - sketch patterns first
// - tune filters and gain after the musical parts feel right

// lead / main motif
$: n("<0 2 4 7>*8".add("<0 2 -1 <-2 3>>"))
    .scale(key)
    .detune(rand)
    .lpenv(1)
    .octave(0)
    .s("sawtooth")
    .gain(.5)
    .lpf(slider(3388.2, 200, 4000))
    .room(.7)
    ._pianoroll()

// nice shit
_$: n("<0 2 4 7>*16".add("<0 2 -1 <-2 3>>"))
    .scale(key)
    .detune(rand)
    .lpenv(1)
    .octave(1)
    .s("sawtooth")
    .gain(.5)
    .lpf(slider(2020.2, 200, 4000))
    .room(.7)
    ._pianoroll()



// harmony / pad
_$: n("<0 3 4 7>*8".add("<1 2 3 4>"))
    .scale(key)
    .octave(0)
    .s("supersaw")
    .gain(0.58)
    .lpf(slider(4000, 200, 4000))
    .room(1.7)
    ._pianoroll()

// bass
_$: n("<0 ~ 0 -1>*16".add("<0 -1 0 -2>"))
    .scale(key)
    .octave(0)
    .s("sawtooth")
    .gain(.45)
    .lpf(slider(1528.8, 100, 2000))
    .lpenv(3)
    .decay(.5)
    ._pianoroll()

// sub bass
_$: n("<0 2 -1 <3 -2>>")
    .scale(key)
    .detune(rand)
    .octave(-1)
    .s("sawtooth")
    .gain(0.8)
    .lpf(400)
    ._pianoroll()

// kick
_$: s("bd:1!4")
    .duck("0:1:2:3")
    .duckdepth(.1)
    .duckattack(.12)
    .gain(.6)
    .room(.3)
    ._scope()


// snare / clap
_$: s("~ hh*2 sd hh ~ hh sd hh")
    .gain(.05)
    .room(.5)
    ._scope()

// optional extra percussion
// $: s("~ cp ~ ~")
//   .gain(.3)
//   .room(.4)
//   ._scope()
`;

const TRACK_03_SOURCE = String.raw`setcpm(124 / 4)

const key = "f:minor"

register('acidenv', (x, pat) => pat.lpf(100)
  .lpenv(x * 9).lps(.2).lpd(.12)
)

// track03
// direction: a little more euphoric and open than track02,
// while still living in the same late-night world.

// main lead
$: n("<0 2 4 7>*8".add("<0 0 1 3>"))
  .scale(key)
  .detune(rand)
  .octave(1)
  .s("sawtooth")
  .gain(.42)
  .lpf(slider(2200, 200, 5000))
  .lpenv(1.4)
  .delay(.25)
  .room(.7)
  ._pianoroll()

// answering line
$: n("<7 6 4 2>*4".add("<0 -1 0 2>"))
  .scale(key)
  .octave(0)
  .s("triangle")
  .gain(.24)
  .lpf(slider(1500, 200, 4000))
  .room(.9)
  ._pianoroll()

// wide pad / harmony
$: n("<0 3 5 7>*4".add("<0 2 1 3>"))
  .scale(key)
  .octave(0)
  .s("supersaw")
  .gain(.34)
  .lpf(slider(1900, 200, 4200))
  .delay(.5)
  .room(1.5)
  ._pianoroll()

// bass movement
$: n("<0 ~ 0 -2>*8".add("<0 0 1 -1>"))
  .scale(key)
  .octave(-1)
  .s("sawtooth")
  .gain(.48)
  .lpf(slider(700, 100, 1800))
  .lpenv(3.2)
  .decay(.45)
  ._pianoroll()

// sub foundation
_$: n("<0 ~ ~ -2>")
  .scale(key)
  .octave(-2)
  .s("sine")
  .gain(.38)
  .lpf(220)
  ._pianoroll()

// kick
$: s("bd:2!4")
  .duck("0:1:2:3")
  .duckdepth(.55)
  .duckattack(.1)
  .gain(.95)
  ._scope()

// hats / top groove
$: s("~ hh hh*2 ~ hh ~ hh*2")
  .gain(.22)
  .lpf(9500)
  .pan(sine.range(0.35, 0.65).slow(4))
  ._scope()

// clap / snare
$: s("~ ~ sd ~ ~ cp sd ~")
  .gain(.16)
  .room(.6)
  ._scope()

// optional sparkle layer
// $: n("<12 11 9 7>*2")
//   .scale(key)
//   .octave(1)
//   .s("triangle")
//   .gain(.12)
//   .delay(.75)
//   .room(1.2)
//   ._pianoroll()
`;

export const EDITOR_PRESETS: readonly EditorPreset[] = [
	{
		id: 'track-01',
		name: 'Acid Bloom',
		description: 'Layered saws, a minor-key bass bed, and a four-on-the-floor pulse.',
		bpm: 100,
		key: 'C minor',
		lanes: 9,
		source: TRACK_01_SOURCE,
	},
	{
		id: 'track-02',
		name: 'Late-night Scaffold',
		description: 'A compact seven-lane sketch with lead, pad, bass, and drum parts.',
		bpm: 120,
		key: 'C minor',
		lanes: 7,
		source: TRACK_02_SOURCE,
	},
	{
		id: 'track-03',
		name: 'Open Sky',
		description: 'An airy, euphoric arrangement with triangle, supersaw, and sine colors.',
		bpm: 124,
		key: 'F minor',
		lanes: 8,
		source: TRACK_03_SOURCE,
	},
];
