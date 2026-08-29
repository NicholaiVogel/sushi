/**
 * Generated from @strudel/core/controls.mjs.
 * Run `bun run effects:generate` after upgrading Strudel.
 */

export interface StrudelSourceParameter {
	name: string;
	type: string;
	description: string;
}

export interface StrudelSourceControl {
	method: string;
	aliases: readonly string[];
	description: string;
	parameters: readonly StrudelSourceParameter[];
}

export const STRUDEL_SOURCE_VERSION = "1.2.6";

export const STRUDEL_SOURCE_CONTROLS: readonly StrudelSourceControl[] = [
	{
		"method": "accelerate",
		"aliases": [],
		"description": "A pattern of numbers that speed up (or slow down) samples while they play. Currently only supported by osc / superdirt.",
		"parameters": [
			{
				"name": "amount",
				"type": "number | Pattern",
				"description": "acceleration."
			}
		]
	},
	{
		"method": "activeLabel",
		"aliases": [],
		"description": "Sets the displayed text for an event on the pianoroll",
		"parameters": [
			{
				"name": "label",
				"type": "string",
				"description": "text to display"
			}
		]
	},
	{
		"method": "amp",
		"aliases": [],
		"description": "Like `gain`, but linear.",
		"parameters": [
			{
				"name": "amount",
				"type": "number | Pattern",
				"description": "gain."
			}
		]
	},
	{
		"method": "analyze",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "anchor",
		"aliases": [],
		"description": "The top note to align the voicing to. Defaults to c5",
		"parameters": [
			{
				"name": "anchorNote",
				"type": "string | Pattern",
				"description": "the note to align the voicings to"
			}
		]
	},
	{
		"method": "attack",
		"aliases": [
			"att"
		],
		"description": "Amplitude envelope attack time: Specifies how long it takes for the sound to reach its peak value, relative to the onset.",
		"parameters": [
			{
				"name": "attack",
				"type": "number | Pattern",
				"description": "time in seconds."
			}
		]
	},
	{
		"method": "bandq",
		"aliases": [
			"bpq"
		],
		"description": "",
		"parameters": []
	},
	{
		"method": "bank",
		"aliases": [],
		"description": "Select the sound bank to use. To be used together with `s`. The bank name (+ \"_\") will be prepended to the value of `s`.",
		"parameters": [
			{
				"name": "bank",
				"type": "string | Pattern",
				"description": "the name of the bank"
			}
		]
	},
	{
		"method": "begin",
		"aliases": [],
		"description": "A pattern of numbers from 0 to 1. Skips the beginning of each sample, e.g. `0.25` to cut off the first quarter from each sample.",
		"parameters": [
			{
				"name": "amount",
				"type": "number | Pattern",
				"description": "between 0 and 1, where 1 is the length of the sample"
			}
		]
	},
	{
		"method": "binshift",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "bpattack",
		"aliases": [
			"bpa"
		],
		"description": "Sets the attack duration for the bandpass filter envelope.",
		"parameters": [
			{
				"name": "attack",
				"type": "number | Pattern",
				"description": "time of the bandpass filter envelope"
			}
		]
	},
	{
		"method": "bpdc",
		"aliases": [],
		"description": "DC offset of the LFO for the bandpass filter",
		"parameters": [
			{
				"name": "dcoffset",
				"type": "number | Pattern",
				"description": "dc offset. set to 0 for unipolar"
			}
		]
	},
	{
		"method": "bpdecay",
		"aliases": [
			"bpd"
		],
		"description": "Sets the decay duration for the bandpass filter envelope.",
		"parameters": [
			{
				"name": "decay",
				"type": "number | Pattern",
				"description": "time of the bandpass filter envelope"
			}
		]
	},
	{
		"method": "bpdepth",
		"aliases": [],
		"description": "Depth of the LFO for the bandpass filter",
		"parameters": [
			{
				"name": "depth",
				"type": "number | Pattern",
				"description": "depth of modulation"
			}
		]
	},
	{
		"method": "bpdepthfrequency",
		"aliases": [
			"bpdepthfreq"
		],
		"description": "Depth of the LFO for the bandpass filter, in HZ",
		"parameters": [
			{
				"name": "depth",
				"type": "number | Pattern",
				"description": "depth of modulation"
			}
		]
	},
	{
		"method": "bpenv",
		"aliases": [
			"bpe"
		],
		"description": "Sets the bandpass filter envelope modulation depth.",
		"parameters": [
			{
				"name": "modulation",
				"type": "number | Pattern",
				"description": "depth of the bandpass filter envelope between 0 and _n_"
			}
		]
	},
	{
		"method": "bpf",
		"aliases": [
			"bandf",
			"bp"
		],
		"description": "Sets the center frequency of the **b**and-**p**ass **f**ilter. When using mininotation, you can also optionally supply the 'bpq' parameter separated by ':'.",
		"parameters": [
			{
				"name": "frequency",
				"type": "number | Pattern",
				"description": "center frequency"
			}
		]
	},
	{
		"method": "bprate",
		"aliases": [],
		"description": "Rate of the LFO for the bandpass filter",
		"parameters": [
			{
				"name": "rate",
				"type": "number | Pattern",
				"description": "rate in hertz"
			}
		]
	},
	{
		"method": "bprelease",
		"aliases": [
			"bpr"
		],
		"description": "Sets the release time for the bandpass filter envelope.",
		"parameters": [
			{
				"name": "release",
				"type": "number | Pattern",
				"description": "time of the bandpass filter envelope"
			}
		]
	},
	{
		"method": "bpshape",
		"aliases": [],
		"description": "Shape of the LFO for the bandpass filter",
		"parameters": [
			{
				"name": "shape",
				"type": "number | Pattern",
				"description": "Shape of the lfo (0, 1, 2, ..)"
			}
		]
	},
	{
		"method": "bpskew",
		"aliases": [],
		"description": "Skew of the LFO for the bandpass filter",
		"parameters": [
			{
				"name": "skew",
				"type": "number | Pattern",
				"description": "How much to bend the LFO shape"
			}
		]
	},
	{
		"method": "bpsustain",
		"aliases": [
			"bps"
		],
		"description": "Sets the sustain amplitude for the bandpass filter envelope.",
		"parameters": [
			{
				"name": "sustain",
				"type": "number | Pattern",
				"description": "amplitude of the bandpass filter envelope"
			}
		]
	},
	{
		"method": "bpsync",
		"aliases": [],
		"description": "Cycle-synced rate of the LFO for the bandpass filter",
		"parameters": [
			{
				"name": "rate",
				"type": "number | Pattern",
				"description": "rate in cycles"
			}
		]
	},
	{
		"method": "bus",
		"aliases": [],
		"description": "A `bus` is a send which can be used for mixing patterns. It combines with.. s(\"bus\") to play that bus through another pattern (for, say, applying non-linear effects like distortion to multiple signals) otherPat.bmod(..) (to modulate another pattern with the bus)",
		"parameters": [
			{
				"name": "number",
				"type": "number | Pattern",
				"description": ""
			}
		]
	},
	{
		"method": "busgain",
		"aliases": [
			"bgain"
		],
		"description": "Postgain multiplier prior to sending the signal to the audio bus.",
		"parameters": [
			{
				"name": "number",
				"type": "number | Pattern",
				"description": ""
			}
		]
	},
	{
		"method": "byteBeatExpression",
		"aliases": [
			"bbexpr"
		],
		"description": "Create byte beats with custom expressions",
		"parameters": [
			{
				"name": "byteBeatExpression",
				"type": "number | Pattern",
				"description": "bitwise expression for creating bytebeat"
			}
		]
	},
	{
		"method": "byteBeatStartTime",
		"aliases": [
			"bbst"
		],
		"description": "Create byte beats with custom expressions",
		"parameters": [
			{
				"name": "byteBeatStartTime",
				"type": "number | Pattern",
				"description": "in samples (t)"
			}
		]
	},
	{
		"method": "ccn",
		"aliases": [],
		"description": "MIDI control number: Sends a MIDI control change message.",
		"parameters": [
			{
				"name": "MIDI",
				"type": "number | Pattern",
				"description": "control number (0-127)"
			}
		]
	},
	{
		"method": "ccv",
		"aliases": [],
		"description": "MIDI control value: Sends a MIDI control change message.",
		"parameters": [
			{
				"name": "MIDI",
				"type": "number | Pattern",
				"description": "control value (0-127)"
			}
		]
	},
	{
		"method": "channel",
		"aliases": [],
		"description": "Choose the channel the pattern is sent to in superdirt",
		"parameters": [
			{
				"name": "channel",
				"type": "number | Pattern",
				"description": "channel number"
			}
		]
	},
	{
		"method": "channels",
		"aliases": [
			"ch"
		],
		"description": "Allows you to set the output channels on the interface",
		"parameters": [
			{
				"name": "channels",
				"type": "number | Pattern",
				"description": "pattern the output channels"
			}
		]
	},
	{
		"method": "chord",
		"aliases": [],
		"description": "The chord to voice",
		"parameters": [
			{
				"name": "symbols",
				"type": "string | Pattern",
				"description": "chord symbols to voice e.g., C, Eb, Fm7, G7. The symbols can be defined via addVoicings"
			}
		]
	},
	{
		"method": "chorus",
		"aliases": [],
		"description": "mix control for the chorus effect",
		"parameters": [
			{
				"name": "chorus",
				"type": "string | Pattern",
				"description": "mix amount between 0 and 1"
			}
		]
	},
	{
		"method": "clip",
		"aliases": [
			"legato"
		],
		"description": "Multiplies the duration with the given number. Also cuts samples off at the end if they exceed the duration.",
		"parameters": [
			{
				"name": "factor",
				"type": "number | Pattern",
				"description": ">= 0"
			}
		]
	},
	{
		"method": "coarse",
		"aliases": [],
		"description": "Fake-resampling for lowering the sample rate. Caution: This effect seems to only work in chromium based browsers",
		"parameters": [
			{
				"name": "factor",
				"type": "number | Pattern",
				"description": "1 for original 2 for half, 3 for a third and so on."
			}
		]
	},
	{
		"method": "color",
		"aliases": [
			"colour"
		],
		"description": "Sets the color of the hap in visualizations like pianoroll or highlighting.",
		"parameters": [
			{
				"name": "color",
				"type": "string",
				"description": "Hexadecimal or CSS color name"
			}
		]
	},
	{
		"method": "comb",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "compressor",
		"aliases": [],
		"description": "Dynamics Compressor. The params are `compressor(\"threshold:ratio:knee:attack:release\")` More info [here](https://developer.mozilla.org/en-US/docs/Web/API/DynamicsCompressorNode?retiredLocale=de#instance_properties)",
		"parameters": []
	},
	{
		"method": "compressorAttack",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "compressorKnee",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "compressorRatio",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "compressorRelease",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "cps",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "crush",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "ctlNum",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "ctranspose",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "curve",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "cut",
		"aliases": [],
		"description": "In the style of classic drum-machines, `cut` will stop a playing sample as soon as another samples with in same cutgroup is to be played. An example would be an open hi-hat followed by a closed one, essentially muting the open.",
		"parameters": [
			{
				"name": "group",
				"type": "number | Pattern",
				"description": "cut group number"
			}
		]
	},
	{
		"method": "decay",
		"aliases": [
			"dec"
		],
		"description": "Amplitude envelope decay time: the time it takes after the attack time to reach the sustain level. Note that the decay is only audible if the sustain value is lower than 1.",
		"parameters": [
			{
				"name": "time",
				"type": "number | Pattern",
				"description": "decay time in seconds"
			}
		]
	},
	{
		"method": "degree",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "delay",
		"aliases": [],
		"description": "Sets the level of the delay signal. When using mininotation, you can also optionally add the 'delaytime' and 'delayfeedback' parameter, separated by ':'.",
		"parameters": [
			{
				"name": "level",
				"type": "number | Pattern",
				"description": "between 0 and 1"
			}
		]
	},
	{
		"method": "delayfeedback",
		"aliases": [
			"delayfb",
			"dfb"
		],
		"description": "Sets the level of the signal that is fed back into the delay. Caution: Values >= 1 will result in a signal that gets louder and louder! Don't do it",
		"parameters": [
			{
				"name": "feedback",
				"type": "number | Pattern",
				"description": "between 0 and 1"
			}
		]
	},
	{
		"method": "delayspeed",
		"aliases": [],
		"description": "Sets the level of the signal that is fed back into the delay. Caution: Values >= 1 will result in a signal that gets louder and louder! Don't do it",
		"parameters": [
			{
				"name": "feedback",
				"type": "number | Pattern",
				"description": "between 0 and 1"
			}
		]
	},
	{
		"method": "delaysync",
		"aliases": [],
		"description": "Sets the time of the delay effect in cycles.",
		"parameters": [
			{
				"name": "cycles",
				"type": "number | Pattern",
				"description": "delay length in cycles"
			}
		]
	},
	{
		"method": "delaytime",
		"aliases": [
			"delayt",
			"dt"
		],
		"description": "Sets the time of the delay effect.",
		"parameters": [
			{
				"name": "delayspeed",
				"type": "number | Pattern",
				"description": "controls the pitch of the delay feedback"
			}
		]
	},
	{
		"method": "deltaSlide",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "density",
		"aliases": [],
		"description": "Noise crackle density",
		"parameters": [
			{
				"name": "density",
				"type": "number | Pattern",
				"description": "between 0 and x"
			}
		]
	},
	{
		"method": "detune",
		"aliases": [
			"det"
		],
		"description": "Set detune for stacked voices of supported oscillators",
		"parameters": [
			{
				"name": "amount",
				"type": "number | Pattern",
				"description": ""
			}
		]
	},
	{
		"method": "dictionary",
		"aliases": [
			"dict"
		],
		"description": "Which dictionary to use for the voicings. This falls back to the default dictionary if not provided",
		"parameters": [
			{
				"name": "dictionaryName",
				"type": "string",
				"description": "which dictionary (having been defined with `addVoicings`) to use"
			}
		]
	},
	{
		"method": "distort",
		"aliases": [
			"dist"
		],
		"description": "Wave shaping distortion. CAUTION: it can get loud. Second option in optional array syntax (ex: \".9:.5\") applies a postgain to the output. Third option sets the waveshaping type. Most useful values are usually between 0 and 10 (depending on source gain). If you are feeling adventurous, you can turn it up to 11 and beyond ;)",
		"parameters": [
			{
				"name": "distortion",
				"type": "number | Pattern",
				"description": "amount of distortion to apply"
			},
			{
				"name": "volume",
				"type": "number | Pattern",
				"description": "linear postgain of the distortion"
			},
			{
				"name": "type",
				"type": "number | string | Pattern",
				"description": "type of distortion to apply"
			}
		]
	},
	{
		"method": "distorttype",
		"aliases": [
			"disttype"
		],
		"description": "Type of waveshaping distortion to apply.",
		"parameters": [
			{
				"name": "type",
				"type": "number | string | Pattern",
				"description": "type of distortion to apply"
			}
		]
	},
	{
		"method": "distortvol",
		"aliases": [
			"distvol"
		],
		"description": "Postgain for waveshaping distortion.",
		"parameters": [
			{
				"name": "volume",
				"type": "number | Pattern",
				"description": "linear postgain of the distortion"
			}
		]
	},
	{
		"method": "djf",
		"aliases": [],
		"description": "DJ filter, below 0.5 is low pass filter, above is high pass filter.",
		"parameters": [
			{
				"name": "cutoff",
				"type": "number | Pattern",
				"description": "below 0.5 is low pass filter, above is high pass filter"
			}
		]
	},
	{
		"method": "drive",
		"aliases": [],
		"description": "Filter overdrive for supported filter types",
		"parameters": [
			{
				"name": "amount",
				"type": "number | Pattern",
				"description": ""
			}
		]
	},
	{
		"method": "dry",
		"aliases": [],
		"description": "Set dryness of reverb. See `room` and `size` for more information about reverb.",
		"parameters": [
			{
				"name": "dry",
				"type": "number | Pattern",
				"description": "0 = wet, 1 = dry"
			}
		]
	},
	{
		"method": "duckattack",
		"aliases": [
			"duckatt"
		],
		"description": "The time required for the ducked signal(s) to return to their normal volume. Can vary across orbits with the ':' mininotation, e.g. `duckonset(\"0:0.003\")`. Note: this requires first applying the effect to multiple orbits with e.g. `duckorbit(\"2:3\")`.",
		"parameters": [
			{
				"name": "time",
				"type": "number | Pattern",
				"description": "The attack time in seconds"
			}
		]
	},
	{
		"method": "duckdepth",
		"aliases": [],
		"description": "The amount of ducking applied to target orbit Can vary across orbits with the ':' mininotation, e.g. `duckdepth(\"0.3:0.1\")`. Note: this requires first applying the effect to multiple orbits with e.g. `duckorbit(\"2:3\")`.",
		"parameters": [
			{
				"name": "depth",
				"type": "number | Pattern",
				"description": "depth of modulation from 0 to 1"
			}
		]
	},
	{
		"method": "duckonset",
		"aliases": [
			"duckons"
		],
		"description": "The time required for the ducked signal(s) to reach their lowest volume. Can be used to prevent clicking or for creative rhythmic effects. Can vary across orbits with the ':' mininotation, e.g. `duckonset(\"0:0.003\")`. Note: this requires first applying the effect to multiple orbits with e.g. `duckorbit(\"2:3\")`.",
		"parameters": [
			{
				"name": "time",
				"type": "number | Pattern",
				"description": "The onset time in seconds"
			}
		]
	},
	{
		"method": "duckorbit",
		"aliases": [
			"duck"
		],
		"description": "Modulate the amplitude of an orbit to create a \"sidechain\" like effect. Can be applied to multiple orbits with the ':' mininotation, e.g. `duckorbit(\"2:3\")`",
		"parameters": [
			{
				"name": "orbit",
				"type": "number | Pattern",
				"description": "target orbit"
			}
		]
	},
	{
		"method": "duration",
		"aliases": [
			"dur"
		],
		"description": "Sets the duration of the event in cycles. Similar to clip / legato, it also cuts samples off at the end if they exceed the duration.",
		"parameters": [
			{
				"name": "seconds",
				"type": "number | Pattern",
				"description": ">= 0"
			}
		]
	},
	{
		"method": "end",
		"aliases": [],
		"description": "The same as .begin, but cuts off the end off each sample.",
		"parameters": [
			{
				"name": "length",
				"type": "number | Pattern",
				"description": "1 = whole sample, .5 = half sample, .25 = quarter sample etc.."
			}
		]
	},
	{
		"method": "enhance",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "expression",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "fadeInTime",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "fadeTime",
		"aliases": [
			"fadeOutTime"
		],
		"description": "",
		"parameters": []
	},
	{
		"method": "fanchor",
		"aliases": [],
		"description": "controls the center of the filter envelope. 0 is unipolar positive, .5 is bipolar, 1 is unipolar negative",
		"parameters": [
			{
				"name": "center",
				"type": "number | Pattern",
				"description": "0 to 1"
			}
		]
	},
	{
		"method": "fft",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "frameRate",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "frames",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "freeze",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "freq",
		"aliases": [],
		"description": "Set frequency of sound.",
		"parameters": [
			{
				"name": "frequency",
				"type": "number | Pattern",
				"description": "in Hz. the audible range is between 20 and 20000 Hz"
			}
		]
	},
	{
		"method": "fshift",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "fshiftnote",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "fshiftphase",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "ftype",
		"aliases": [],
		"description": "Sets the filter type. The ladder filter is more aggressive. More types might be added in the future.",
		"parameters": [
			{
				"name": "type",
				"type": "number | Pattern",
				"description": "12db (0), ladder (1), or 24db (2)"
			}
		]
	},
	{
		"method": "FXrelease",
		"aliases": [
			"FXr",
			"FXrel",
			"fxr"
		],
		"description": "",
		"parameters": []
	},
	{
		"method": "gain",
		"aliases": [],
		"description": "Controls the gain by an exponential amount.",
		"parameters": [
			{
				"name": "amount",
				"type": "number | Pattern",
				"description": "gain."
			}
		]
	},
	{
		"method": "gate",
		"aliases": [
			"gat"
		],
		"description": "",
		"parameters": []
	},
	{
		"method": "harmonic",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "hbrick",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "hcutoff",
		"aliases": [
			"hp",
			"hpf"
		],
		"description": "",
		"parameters": []
	},
	{
		"method": "hold",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "hours",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "hpattack",
		"aliases": [
			"hpa"
		],
		"description": "Sets the attack duration for the highpass filter envelope.",
		"parameters": [
			{
				"name": "attack",
				"type": "number | Pattern",
				"description": "time of the highpass filter envelope"
			}
		]
	},
	{
		"method": "hpdc",
		"aliases": [],
		"description": "DC offset of the LFO for the highpass filter",
		"parameters": [
			{
				"name": "dcoffset",
				"type": "number | Pattern",
				"description": "dc offset. set to 0 for unipolar"
			}
		]
	},
	{
		"method": "hpdecay",
		"aliases": [
			"hpd"
		],
		"description": "Sets the decay duration for the highpass filter envelope.",
		"parameters": [
			{
				"name": "decay",
				"type": "number | Pattern",
				"description": "time of the highpass filter envelope"
			}
		]
	},
	{
		"method": "hpdepth",
		"aliases": [],
		"description": "Depth of the LFO for the highpass filter",
		"parameters": [
			{
				"name": "depth",
				"type": "number | Pattern",
				"description": "depth of modulation"
			}
		]
	},
	{
		"method": "hpdepthfrequency",
		"aliases": [
			"hpdepthfreq"
		],
		"description": "Depth of the LFO for the hipass filter, in hz",
		"parameters": [
			{
				"name": "depth",
				"type": "number | Pattern",
				"description": "depth of modulation"
			}
		]
	},
	{
		"method": "hpenv",
		"aliases": [
			"hpe"
		],
		"description": "Sets the highpass filter envelope modulation depth.",
		"parameters": [
			{
				"name": "modulation",
				"type": "number | Pattern",
				"description": "depth of the highpass filter envelope between 0 and _n_"
			}
		]
	},
	{
		"method": "hpq",
		"aliases": [
			"hresonance"
		],
		"description": "Controls the **h**igh-**p**ass **q**-value.",
		"parameters": [
			{
				"name": "q",
				"type": "number | Pattern",
				"description": "resonance factor between 0 and 50"
			}
		]
	},
	{
		"method": "hprate",
		"aliases": [],
		"description": "Rate of the LFO for the highpass filter",
		"parameters": [
			{
				"name": "rate",
				"type": "number | Pattern",
				"description": "rate in hertz"
			}
		]
	},
	{
		"method": "hprelease",
		"aliases": [
			"hpr"
		],
		"description": "Sets the release time for the highpass filter envelope.",
		"parameters": [
			{
				"name": "release",
				"type": "number | Pattern",
				"description": "time of the highpass filter envelope"
			}
		]
	},
	{
		"method": "hpshape",
		"aliases": [],
		"description": "Shape of the LFO for the highpass filter",
		"parameters": [
			{
				"name": "shape",
				"type": "number | Pattern",
				"description": "Shape of the lfo (0, 1, 2, ..)"
			}
		]
	},
	{
		"method": "hpskew",
		"aliases": [],
		"description": "Skew of the LFO for the highpass filter",
		"parameters": [
			{
				"name": "skew",
				"type": "number | Pattern",
				"description": "How much to bend the LFO shape"
			}
		]
	},
	{
		"method": "hpsustain",
		"aliases": [
			"hps"
		],
		"description": "Sets the sustain amplitude for the highpass filter envelope.",
		"parameters": [
			{
				"name": "sustain",
				"type": "number | Pattern",
				"description": "amplitude of the highpass filter envelope"
			}
		]
	},
	{
		"method": "hpsync",
		"aliases": [],
		"description": "Cycle-synced rate of the LFO for the highpass filter",
		"parameters": [
			{
				"name": "rate",
				"type": "number | Pattern",
				"description": "rate in cycles"
			}
		]
	},
	{
		"method": "imag",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "irbegin",
		"aliases": [],
		"description": "Sets the beginning of the IR response sample",
		"parameters": [
			{
				"name": "begin",
				"type": "string | Pattern",
				"description": "between 0 and 1"
			}
		]
	},
	{
		"method": "iresponse",
		"aliases": [
			"ir"
		],
		"description": "Sets the sample to use as an impulse response for the reverb.",
		"parameters": [
			{
				"name": "sample",
				"type": "string | Pattern",
				"description": "to use as an impulse response"
			}
		]
	},
	{
		"method": "irspeed",
		"aliases": [],
		"description": "Sets speed of the sample for the impulse response.",
		"parameters": [
			{
				"name": "speed",
				"type": "string | Pattern",
				"description": ""
			}
		]
	},
	{
		"method": "kcutoff",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "krush",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "label",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "lbrick",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "leslie",
		"aliases": [],
		"description": "Emulation of a Leslie speaker: speakers rotating in a wooden amplified cabinet.",
		"parameters": [
			{
				"name": "wet",
				"type": "number | Pattern",
				"description": "between 0 and 1"
			}
		]
	},
	{
		"method": "lock",
		"aliases": [],
		"description": "Specifies whether delaytime is calculated relative to cps.",
		"parameters": [
			{
				"name": "enable",
				"type": "number | Pattern",
				"description": "When set to 1, delaytime is a direct multiple of a cycle."
			}
		]
	},
	{
		"method": "loop",
		"aliases": [],
		"description": "Loops the sample. Note that the tempo of the loop is not synced with the cycle tempo. To change the loop region, use loopBegin / loopEnd.",
		"parameters": [
			{
				"name": "on",
				"type": "number | Pattern",
				"description": "If 1, the sample is looped"
			}
		]
	},
	{
		"method": "loopBegin",
		"aliases": [
			"loopb"
		],
		"description": "Begin to loop at a specific point in the sample (inbetween `begin` and `end`). Note that the loop point must be inbetween `begin` and `end`, and before `loopEnd`! Note: Samples starting with wt_ will automatically loop! (wt = wavetable)",
		"parameters": [
			{
				"name": "time",
				"type": "number | Pattern",
				"description": "between 0 and 1, where 1 is the length of the sample"
			}
		]
	},
	{
		"method": "loopEnd",
		"aliases": [
			"loope"
		],
		"description": "End the looping section at a specific point in the sample (inbetween `begin` and `end`). Note that the loop point must be inbetween `begin` and `end`, and after `loopBegin`!",
		"parameters": [
			{
				"name": "time",
				"type": "number | Pattern",
				"description": "between 0 and 1, where 1 is the length of the sample"
			}
		]
	},
	{
		"method": "lpattack",
		"aliases": [
			"lpa"
		],
		"description": "Sets the attack duration for the lowpass filter envelope.",
		"parameters": [
			{
				"name": "attack",
				"type": "number | Pattern",
				"description": "time of the filter envelope"
			}
		]
	},
	{
		"method": "lpdc",
		"aliases": [],
		"description": "DC offset of the LFO for the lowpass filter",
		"parameters": [
			{
				"name": "dcoffset",
				"type": "number | Pattern",
				"description": "dc offset. set to 0 for unipolar"
			}
		]
	},
	{
		"method": "lpdecay",
		"aliases": [
			"lpd"
		],
		"description": "Sets the decay duration for the lowpass filter envelope.",
		"parameters": [
			{
				"name": "decay",
				"type": "number | Pattern",
				"description": "time of the filter envelope"
			}
		]
	},
	{
		"method": "lpdepth",
		"aliases": [],
		"description": "Depth of the LFO for the lowpass filter",
		"parameters": [
			{
				"name": "depth",
				"type": "number | Pattern",
				"description": "depth of modulation"
			}
		]
	},
	{
		"method": "lpdepthfrequency",
		"aliases": [
			"lpdepthfreq"
		],
		"description": "Depth of the LFO for the lowpass filter, in HZ",
		"parameters": [
			{
				"name": "depth",
				"type": "number | Pattern",
				"description": "depth of modulation"
			}
		]
	},
	{
		"method": "lpenv",
		"aliases": [
			"lpe"
		],
		"description": "Sets the lowpass filter envelope modulation depth.",
		"parameters": [
			{
				"name": "modulation",
				"type": "number | Pattern",
				"description": "depth of the lowpass filter envelope between 0 and _n_"
			}
		]
	},
	{
		"method": "lpf",
		"aliases": [
			"ctf",
			"cutoff",
			"lp"
		],
		"description": "Applies the cutoff frequency of the **l**ow-**p**ass **f**ilter. When using mininotation, you can also optionally add the 'lpq' parameter, separated by ':'.",
		"parameters": [
			{
				"name": "frequency",
				"type": "number | Pattern",
				"description": "audible between 0 and 20000"
			}
		]
	},
	{
		"method": "lprate",
		"aliases": [],
		"description": "Rate of the LFO for the lowpass filter",
		"parameters": [
			{
				"name": "rate",
				"type": "number | Pattern",
				"description": "rate in hertz"
			}
		]
	},
	{
		"method": "lprelease",
		"aliases": [
			"lpr"
		],
		"description": "Sets the release time for the lowpass filter envelope.",
		"parameters": [
			{
				"name": "release",
				"type": "number | Pattern",
				"description": "time of the filter envelope"
			}
		]
	},
	{
		"method": "lpshape",
		"aliases": [],
		"description": "Shape of the LFO for the lowpass filter",
		"parameters": [
			{
				"name": "shape",
				"type": "number | Pattern",
				"description": "Shape of the lfo (0, 1, 2, ..)"
			}
		]
	},
	{
		"method": "lpskew",
		"aliases": [],
		"description": "Skew of the LFO for the lowpass filter",
		"parameters": [
			{
				"name": "skew",
				"type": "number | Pattern",
				"description": "How much to bend the LFO shape"
			}
		]
	},
	{
		"method": "lpsustain",
		"aliases": [
			"lps"
		],
		"description": "Sets the sustain amplitude for the lowpass filter envelope.",
		"parameters": [
			{
				"name": "sustain",
				"type": "number | Pattern",
				"description": "amplitude of the lowpass filter envelope"
			}
		]
	},
	{
		"method": "lpsync",
		"aliases": [],
		"description": "Cycle-synced rate of the LFO for the lowpass filter",
		"parameters": [
			{
				"name": "rate",
				"type": "number | Pattern",
				"description": "rate in cycles"
			}
		]
	},
	{
		"method": "lrate",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "lsize",
		"aliases": [],
		"description": "Physical size of the cabinet in meters. Be careful, it might be slightly larger than your computer. Affects the Doppler amount (pitch warble)",
		"parameters": [
			{
				"name": "meters",
				"type": "number | Pattern",
				"description": "somewhere between 0 and 1"
			}
		]
	},
	{
		"method": "midibend",
		"aliases": [],
		"description": "MIDI pitch bend: Sends a MIDI pitch bend message.",
		"parameters": [
			{
				"name": "midibend",
				"type": "number | Pattern",
				"description": "MIDI pitch bend (-1 - 1)"
			}
		]
	},
	{
		"method": "midichan",
		"aliases": [],
		"description": "MIDI channel: Sets the MIDI channel for the event.",
		"parameters": [
			{
				"name": "channel",
				"type": "number | Pattern",
				"description": "MIDI channel number (0-15)"
			}
		]
	},
	{
		"method": "midicmd",
		"aliases": [],
		"description": "MIDI command: Sends a MIDI command message.",
		"parameters": [
			{
				"name": "command",
				"type": "number | Pattern",
				"description": "MIDI command"
			}
		]
	},
	{
		"method": "midimap",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "midiport",
		"aliases": [],
		"description": "MIDI port: Sets the MIDI port for the event.",
		"parameters": [
			{
				"name": "port",
				"type": "number | Pattern",
				"description": "MIDI port"
			}
		]
	},
	{
		"method": "miditouch",
		"aliases": [],
		"description": "MIDI key after touch: Sends a MIDI key after touch message.",
		"parameters": [
			{
				"name": "miditouch",
				"type": "number | Pattern",
				"description": "MIDI key after touch (0-1)"
			}
		]
	},
	{
		"method": "minutes",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "mode",
		"aliases": [],
		"description": "Remove anchor note from the voicing. Useful for melody harmonization",
		"parameters": [
			{
				"name": "modeName",
				"type": "string | Pattern",
				"description": "one of {below | above | duck | root}"
			}
		]
	},
	{
		"method": "mtranspose",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "n",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "noise",
		"aliases": [],
		"description": "Adds pink noise to the mix",
		"parameters": [
			{
				"name": "wet",
				"type": "number | Pattern",
				"description": "wet amount"
			}
		]
	},
	{
		"method": "note",
		"aliases": [],
		"description": "Plays the given note name or midi number. A note name consists of - a letter (a-g or A-G) - optional accidentals (b or #) - optional (possibly negative) octave number (0-9). Defaults to 3 Examples of valid note names: `c`, `bb`, `Bb`, `f#`, `c3`, `A4`, `Eb2`, `c#5` You can also use midi numbers instead of note names, where 69 is mapped to A4 440Hz in 12EDO.",
		"parameters": []
	},
	{
		"method": "nrpnn",
		"aliases": [],
		"description": "MIDI NRPN non-registered parameter number: Sends a MIDI NRPN non-registered parameter number message.",
		"parameters": [
			{
				"name": "nrpnn",
				"type": "number | Pattern",
				"description": "MIDI NRPN non-registered parameter number (0-127)"
			}
		]
	},
	{
		"method": "nrpv",
		"aliases": [],
		"description": "MIDI NRPN non-registered parameter value: Sends a MIDI NRPN non-registered parameter value message.",
		"parameters": [
			{
				"name": "nrpv",
				"type": "number | Pattern",
				"description": "MIDI NRPN non-registered parameter value (0-127)"
			}
		]
	},
	{
		"method": "nudge",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "octave",
		"aliases": [
			"oct"
		],
		"description": "Sets the default octave of a synth.",
		"parameters": [
			{
				"name": "octave",
				"type": "number | Pattern",
				"description": "octave number"
			}
		]
	},
	{
		"method": "octaveR",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "octaves",
		"aliases": [],
		"description": "How many octaves are voicing steps spread apart, defaults to 1",
		"parameters": [
			{
				"name": "count",
				"type": "number | Pattern",
				"description": "the number of octaves"
			}
		]
	},
	{
		"method": "octer",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "octersub",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "octersubsub",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "offset",
		"aliases": [],
		"description": "Sets how the voicing is offset from the anchored position",
		"parameters": [
			{
				"name": "shift",
				"type": "number | Pattern",
				"description": "the amount to shift the voicing up or down"
			}
		]
	},
	{
		"method": "orbit",
		"aliases": [
			"o"
		],
		"description": "An `orbit` is a global parameter context for patterns. Patterns with the same orbit will share the same global effects.",
		"parameters": [
			{
				"name": "number",
				"type": "number | Pattern",
				"description": ""
			}
		]
	},
	{
		"method": "oschost",
		"aliases": [],
		"description": "The host to send open sound control messages to. Requires running the OSC bridge.",
		"parameters": [
			{
				"name": "oschost",
				"type": "string | Pattern",
				"description": "e.g. 'localhost'"
			}
		]
	},
	{
		"method": "oscport",
		"aliases": [],
		"description": "The port to send open sound control messages to. Requires running the OSC bridge.",
		"parameters": [
			{
				"name": "oscport",
				"type": "number | Pattern",
				"description": "e.g. 57120"
			}
		]
	},
	{
		"method": "overgain",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "overshape",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "pan",
		"aliases": [],
		"description": "Sets position in stereo.",
		"parameters": [
			{
				"name": "pan",
				"type": "number | Pattern",
				"description": "between 0 and 1, from left to right (assuming stereo), once round a circle (assuming multichannel)"
			}
		]
	},
	{
		"method": "panchor",
		"aliases": [],
		"description": "Sets the range anchor of the envelope: - anchor 0: range = [note, note + penv] - anchor 1: range = [note - penv, note] If you don't set an anchor, the value will default to the psustain value.",
		"parameters": [
			{
				"name": "anchor",
				"type": "number | Pattern",
				"description": "anchor offset"
			}
		]
	},
	{
		"method": "panorient",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "panspan",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "pansplay",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "panwidth",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "pattack",
		"aliases": [
			"patt"
		],
		"description": "Attack time of pitch envelope.",
		"parameters": [
			{
				"name": "time",
				"type": "number | Pattern",
				"description": "time in seconds"
			}
		]
	},
	{
		"method": "pcurve",
		"aliases": [],
		"description": "Curve of envelope. Defaults to linear. exponential is good for kicks",
		"parameters": [
			{
				"name": "type",
				"type": "number | Pattern",
				"description": "0 = linear, 1 = exponential"
			}
		]
	},
	{
		"method": "pdecay",
		"aliases": [
			"pdec"
		],
		"description": "Decay time of pitch envelope.",
		"parameters": [
			{
				"name": "time",
				"type": "number | Pattern",
				"description": "time in seconds"
			}
		]
	},
	{
		"method": "penv",
		"aliases": [],
		"description": "Amount of pitch envelope. Negative values will flip the envelope. If you don't set other pitch envelope controls, `pattack:.2` will be the default.",
		"parameters": [
			{
				"name": "semitones",
				"type": "number | Pattern",
				"description": "change in semitones"
			}
		]
	},
	{
		"method": "phaser",
		"aliases": [
			"ph",
			"phaserrate"
		],
		"description": "Phaser audio effect that approximates popular guitar pedals.",
		"parameters": [
			{
				"name": "speed",
				"type": "number | Pattern",
				"description": "speed of modulation"
			}
		]
	},
	{
		"method": "phasercenter",
		"aliases": [
			"phc"
		],
		"description": "The center frequency of the phaser in HZ. Defaults to 1000",
		"parameters": [
			{
				"name": "centerfrequency",
				"type": "number | Pattern",
				"description": "in HZ"
			}
		]
	},
	{
		"method": "phaserdepth",
		"aliases": [
			"phasdp",
			"phd"
		],
		"description": "",
		"parameters": []
	},
	{
		"method": "phasersweep",
		"aliases": [
			"phs"
		],
		"description": "The frequency sweep range of the lfo for the phaser effect. Defaults to 2000",
		"parameters": [
			{
				"name": "phasersweep",
				"type": "number | Pattern",
				"description": "most useful values are between 0 and 4000"
			}
		]
	},
	{
		"method": "pitchJump",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "pitchJumpTime",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "polyTouch",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "postgain",
		"aliases": [],
		"description": "Gain applied after all effects have been processed.",
		"parameters": []
	},
	{
		"method": "prelease",
		"aliases": [
			"prel"
		],
		"description": "Release time of pitch envelope",
		"parameters": [
			{
				"name": "time",
				"type": "number | Pattern",
				"description": "time in seconds"
			}
		]
	},
	{
		"method": "progNum",
		"aliases": [],
		"description": "MIDI program number: Sends a MIDI program change message.",
		"parameters": [
			{
				"name": "program",
				"type": "number | Pattern",
				"description": "MIDI program number (0-127)"
			}
		]
	},
	{
		"method": "psustain",
		"aliases": [
			"psus"
		],
		"description": "",
		"parameters": []
	},
	{
		"method": "pw",
		"aliases": [],
		"description": "Controls the pulsewidth of the pulse oscillator",
		"parameters": [
			{
				"name": "pulsewidth",
				"type": "number | Pattern",
				"description": ""
			}
		]
	},
	{
		"method": "pwrate",
		"aliases": [],
		"description": "Controls the lfo rate for the pulsewidth of the pulse oscillator",
		"parameters": [
			{
				"name": "rate",
				"type": "number | Pattern",
				"description": ""
			}
		]
	},
	{
		"method": "pwsweep",
		"aliases": [],
		"description": "Controls the lfo sweep for the pulsewidth of the pulse oscillator",
		"parameters": [
			{
				"name": "sweep",
				"type": "number | Pattern",
				"description": ""
			}
		]
	},
	{
		"method": "real",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "release",
		"aliases": [
			"rel"
		],
		"description": "Amplitude envelope release time: The time it takes after the offset to go from sustain level to zero.",
		"parameters": [
			{
				"name": "time",
				"type": "number | Pattern",
				"description": "release time in seconds"
			}
		]
	},
	{
		"method": "resonance",
		"aliases": [
			"lpq"
		],
		"description": "",
		"parameters": []
	},
	{
		"method": "ring",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "ringdf",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "ringf",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "room",
		"aliases": [],
		"description": "Sets the level of reverb. When using mininotation, you can also optionally add the 'size' parameter, separated by ':'.",
		"parameters": [
			{
				"name": "level",
				"type": "number | Pattern",
				"description": "between 0 and 1"
			}
		]
	},
	{
		"method": "roomdim",
		"aliases": [
			"rdim"
		],
		"description": "Reverb lowpass frequency at -60dB (in hertz). When this property is changed, the reverb will be recaculated, so only change this sparsely..",
		"parameters": [
			{
				"name": "frequency",
				"type": "number",
				"description": "between 0 and 20000hz"
			}
		]
	},
	{
		"method": "roomfade",
		"aliases": [
			"rfade"
		],
		"description": "Reverb fade time (in seconds). When this property is changed, the reverb will be recaculated, so only change this sparsely..",
		"parameters": [
			{
				"name": "seconds",
				"type": "number",
				"description": "for the reverb to fade"
			}
		]
	},
	{
		"method": "roomlp",
		"aliases": [
			"rlp"
		],
		"description": "Reverb lowpass starting frequency (in hertz). When this property is changed, the reverb will be recaculated, so only change this sparsely..",
		"parameters": [
			{
				"name": "frequency",
				"type": "number",
				"description": "between 0 and 20000hz"
			}
		]
	},
	{
		"method": "roomsize",
		"aliases": [
			"rsize",
			"size",
			"sz"
		],
		"description": "",
		"parameters": []
	},
	{
		"method": "s",
		"aliases": [
			"sound"
		],
		"description": "Select a sound / sample by name. When using mininotation, you can also optionally supply 'n' and 'gain' parameters separated by ':'.",
		"parameters": [
			{
				"name": "sound",
				"type": "string | Pattern",
				"description": "The sound / pattern of sounds to pick"
			}
		]
	},
	{
		"method": "scram",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "seconds",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "semitone",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "shape",
		"aliases": [],
		"description": "(Deprecated) Wave shaping distortion. WARNING: can suddenly get unpredictably loud. Please use distort instead, which has a more predictable response curve second option in optional array syntax (ex: \".9:.5\") applies a postgain to the output",
		"parameters": [
			{
				"name": "distortion",
				"type": "number | Pattern",
				"description": "between 0 and 1"
			}
		]
	},
	{
		"method": "slide",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "smear",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "songPtr",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "source",
		"aliases": [
			"src"
		],
		"description": "Define a custom webaudio node to use as a sound source.",
		"parameters": [
			{
				"name": "getSource",
				"type": "function",
				"description": ""
			}
		]
	},
	{
		"method": "speed",
		"aliases": [],
		"description": "Changes the speed of sample playback, i.e. a cheap way of changing pitch.",
		"parameters": [
			{
				"name": "speed",
				"type": "number | Pattern",
				"description": "-inf to inf, negative numbers play the sample backwards."
			}
		]
	},
	{
		"method": "spread",
		"aliases": [],
		"description": "Set the stereo pan spread for supported oscillators",
		"parameters": [
			{
				"name": "spread",
				"type": "number | Pattern",
				"description": "between 0 and 1"
			}
		]
	},
	{
		"method": "squiz",
		"aliases": [],
		"description": "Made by Calum Gunn. Reminiscent of some weird mixture of filter, ring-modulator and pitch-shifter. The SuperCollider manual defines Squiz as: \"A simplistic pitch-raising algorithm. It's not meant to sound natural; its sound is reminiscent of some weird mixture of filter, ring-modulator and pitch-shifter, depending on the input. The algorithm works by cutting the signal into fragments (delimited by upwards-going zero-crossings) and squeezing those fragments in the time domain (i.e. simply playing them back faster than they came in), leaving silences inbetween. All the parameters apart from memlen can be modulated.\"",
		"parameters": [
			{
				"name": "squiz",
				"type": "number | Pattern",
				"description": "Try passing multiples of 2 to it - 2, 4, 8 etc."
			}
		]
	},
	{
		"method": "stepsPerOctave",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "stretch",
		"aliases": [],
		"description": "Changes the speed of sample playback, i.e. a cheap way of changing pitch.",
		"parameters": [
			{
				"name": "factor",
				"type": "number | Pattern",
				"description": "-inf to inf, negative numbers play the sample backwards."
			}
		]
	},
	{
		"method": "sustain",
		"aliases": [
			"sus"
		],
		"description": "Amplitude envelope sustain level: The level which is reached after attack / decay, being sustained until the offset.",
		"parameters": [
			{
				"name": "gain",
				"type": "number | Pattern",
				"description": "sustain level between 0 and 1"
			}
		]
	},
	{
		"method": "sustainpedal",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "sysexdata",
		"aliases": [],
		"description": "MIDI sysex data: Sends a MIDI sysex message.",
		"parameters": [
			{
				"name": "data",
				"type": "number | Pattern",
				"description": "Sysex data"
			}
		]
	},
	{
		"method": "sysexid",
		"aliases": [],
		"description": "MIDI sysex ID: Sends a MIDI sysex identifier message.",
		"parameters": [
			{
				"name": "id",
				"type": "number | Pattern",
				"description": "Sysex ID"
			}
		]
	},
	{
		"method": "transient",
		"aliases": [],
		"description": "Transient shaper. Gives independent control over the emphasis on transients and sustains",
		"parameters": [
			{
				"name": "attack",
				"type": "number | Pattern",
				"description": "Emphasis on transients; between -1 (deaccentuate) and 1 (accentuate)"
			},
			{
				"name": "sustain",
				"type": "number | Pattern",
				"description": "Emphasis on the sustains; between -1 (deaccentuate) and 1 (accentuate)"
			}
		]
	},
	{
		"method": "tremolo",
		"aliases": [
			"trem"
		],
		"description": "Modulate the amplitude of a sound with a continuous waveform",
		"parameters": [
			{
				"name": "speed",
				"type": "number | Pattern",
				"description": "modulation speed in HZ"
			}
		]
	},
	{
		"method": "tremolodepth",
		"aliases": [
			"tremdepth"
		],
		"description": "Depth of amplitude modulation",
		"parameters": [
			{
				"name": "depth",
				"type": "number | Pattern",
				"description": ""
			}
		]
	},
	{
		"method": "tremolophase",
		"aliases": [
			"tremphase"
		],
		"description": "Alter the phase of the modulation waveform",
		"parameters": [
			{
				"name": "offset",
				"type": "number | Pattern",
				"description": "the offset in cycles of the modulation"
			}
		]
	},
	{
		"method": "tremoloshape",
		"aliases": [
			"tremshape"
		],
		"description": "Shape of amplitude modulation",
		"parameters": [
			{
				"name": "shape",
				"type": "number | Pattern",
				"description": "tri | square | sine | saw | ramp"
			}
		]
	},
	{
		"method": "tremoloskew",
		"aliases": [
			"tremskew"
		],
		"description": "Alter the shape of the modulation waveform",
		"parameters": [
			{
				"name": "amount",
				"type": "number | Pattern",
				"description": "between 0 & 1, the shape of the waveform"
			}
		]
	},
	{
		"method": "tremolosync",
		"aliases": [
			"tremsync"
		],
		"description": "Modulate the amplitude of a sound with a continuous waveform",
		"parameters": [
			{
				"name": "cycles",
				"type": "number | Pattern",
				"description": "modulation speed in cycles"
			}
		]
	},
	{
		"method": "triode",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "tsdelay",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "uid",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "unison",
		"aliases": [],
		"description": "Set number of stacked voices for supported oscillators",
		"parameters": [
			{
				"name": "numvoices",
				"type": "number | Pattern",
				"description": ""
			}
		]
	},
	{
		"method": "unit",
		"aliases": [],
		"description": "Used in conjunction with `speed`, accepts values of \"r\" (rate, default behavior), \"c\" (cycles), or \"s\" (seconds). Using `unit \"c\"` means `speed` will be interpreted in units of cycles, e.g. `speed \"1\"` means samples will be stretched to fill a cycle. Using `unit \"s\"` means the playback speed will be adjusted so that the duration is the number of seconds specified by `speed`.",
		"parameters": [
			{
				"name": "unit",
				"type": "number | string | Pattern",
				"description": "see description above"
			}
		]
	},
	{
		"method": "val",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "velocity",
		"aliases": [
			"vel"
		],
		"description": "Sets the velocity from 0 to 1. Is multiplied together with gain.",
		"parameters": []
	},
	{
		"method": "vib",
		"aliases": [
			"v",
			"vibrato"
		],
		"description": "Applies a vibrato to the frequency of the oscillator.",
		"parameters": [
			{
				"name": "frequency",
				"type": "number | Pattern",
				"description": "of the vibrato in hertz"
			}
		]
	},
	{
		"method": "vibmod",
		"aliases": [
			"vmod"
		],
		"description": "Sets the vibrato depth in semitones. Only has an effect if `vibrato` | `vib` | `v` is is also set",
		"parameters": [
			{
				"name": "depth",
				"type": "number | Pattern",
				"description": "of vibrato (in semitones)"
			}
		]
	},
	{
		"method": "voice",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "vowel",
		"aliases": [],
		"description": "Formant filter to make things sound like vowels.",
		"parameters": [
			{
				"name": "vowel",
				"type": "string | Pattern",
				"description": "You can use a e i o u ae aa oe ue y uh un en an on, corresponding to [a] [e] [i] [o] [u] [æ] [ɑ] [ø] [y] [ɯ] [ʌ] [œ̃] [ɛ̃] [ɑ̃] [ɔ̃]. Aliases: aa = å = ɑ, oe = ø = ö, y = ı, ae = æ."
			}
		]
	},
	{
		"method": "warp",
		"aliases": [
			"wavetableWarp"
		],
		"description": "Amount of warp (alteration of the waveform) to apply to the wavetable oscillator",
		"parameters": [
			{
				"name": "amount",
				"type": "number | Pattern",
				"description": "Warp of the wavetable from 0 to 1"
			}
		]
	},
	{
		"method": "warpattack",
		"aliases": [
			"warpatt"
		],
		"description": "Attack time of the wavetable oscillator's warp envelope",
		"parameters": [
			{
				"name": "time",
				"type": "number | Pattern",
				"description": "attack time in seconds"
			}
		]
	},
	{
		"method": "warpdc",
		"aliases": [],
		"description": "DC offset of the LFO for the wavetable oscillator's warp",
		"parameters": [
			{
				"name": "dcoffset",
				"type": "number | Pattern",
				"description": "dc offset. set to 0 for unipolar"
			}
		]
	},
	{
		"method": "warpdecay",
		"aliases": [
			"warpdec"
		],
		"description": "Decay time of the wavetable oscillator's warp envelope",
		"parameters": [
			{
				"name": "time",
				"type": "number | Pattern",
				"description": "decay time in seconds"
			}
		]
	},
	{
		"method": "warpdepth",
		"aliases": [],
		"description": "Depth of the LFO for the wavetable oscillator's warp",
		"parameters": [
			{
				"name": "depth",
				"type": "number | Pattern",
				"description": "depth of modulation"
			}
		]
	},
	{
		"method": "warpenv",
		"aliases": [],
		"description": "Amount of envelope applied wavetable oscillator's position envelope",
		"parameters": [
			{
				"name": "amount",
				"type": "number | Pattern",
				"description": "between 0 and 1"
			}
		]
	},
	{
		"method": "warpmode",
		"aliases": [
			"wavetableWarpMode"
		],
		"description": "Type of warp (alteration of the waveform) to apply to the wavetable oscillator. The current options are: none, asym, bendp, bendm, bendmp, sync, quant, fold, pwm, orbit, spin, chaos, primes, binary, brownian, reciprocal, wormhole, logistic, sigmoid, fractal, flip",
		"parameters": [
			{
				"name": "mode",
				"type": "number | string | Pattern",
				"description": "Warp mode"
			}
		]
	},
	{
		"method": "warprate",
		"aliases": [],
		"description": "Rate of the LFO for the wavetable oscillator's warp",
		"parameters": [
			{
				"name": "rate",
				"type": "number | Pattern",
				"description": "rate in hertz"
			}
		]
	},
	{
		"method": "warprelease",
		"aliases": [
			"warprel"
		],
		"description": "Release time of the wavetable oscillator's warp envelope",
		"parameters": [
			{
				"name": "time",
				"type": "number | Pattern",
				"description": "release time in seconds"
			}
		]
	},
	{
		"method": "warpshape",
		"aliases": [],
		"description": "Shape of the LFO for the wavetable oscillator's warp",
		"parameters": [
			{
				"name": "shape",
				"type": "number | Pattern",
				"description": "Shape of the lfo (0, 1, 2, ..)"
			}
		]
	},
	{
		"method": "warpskew",
		"aliases": [],
		"description": "Skew of the LFO for the wavetable oscillator's warp",
		"parameters": [
			{
				"name": "skew",
				"type": "number | Pattern",
				"description": "How much to bend the LFO shape"
			}
		]
	},
	{
		"method": "warpsustain",
		"aliases": [
			"warpsus"
		],
		"description": "Sustain time of the wavetable oscillator's warp envelope",
		"parameters": [
			{
				"name": "gain",
				"type": "number | Pattern",
				"description": "sustain level (0 to 1)"
			}
		]
	},
	{
		"method": "warpsync",
		"aliases": [],
		"description": "cycle synced rate of the LFO for the wavetable warp position",
		"parameters": [
			{
				"name": "rate",
				"type": "number | Pattern",
				"description": "rate in cycles"
			}
		]
	},
	{
		"method": "waveloss",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "wt",
		"aliases": [
			"wavetablePosition"
		],
		"description": "Position in the wavetable of the wavetable oscillator",
		"parameters": [
			{
				"name": "position",
				"type": "number | Pattern",
				"description": "Position in the wavetable from 0 to 1"
			}
		]
	},
	{
		"method": "wtattack",
		"aliases": [
			"wtatt"
		],
		"description": "Attack time of the wavetable oscillator's position envelope",
		"parameters": [
			{
				"name": "time",
				"type": "number | Pattern",
				"description": "attack time in seconds"
			}
		]
	},
	{
		"method": "wtdc",
		"aliases": [],
		"description": "DC offset of the LFO for the wavetable oscillator's position",
		"parameters": [
			{
				"name": "dcoffset",
				"type": "number | Pattern",
				"description": "dc offset. set to 0 for unipolar"
			}
		]
	},
	{
		"method": "wtdecay",
		"aliases": [
			"wtdec"
		],
		"description": "Decay time of the wavetable oscillator's position envelope",
		"parameters": [
			{
				"name": "time",
				"type": "number | Pattern",
				"description": "decay time in seconds"
			}
		]
	},
	{
		"method": "wtdepth",
		"aliases": [],
		"description": "Depth of the LFO for the wavetable oscillator's position",
		"parameters": [
			{
				"name": "depth",
				"type": "number | Pattern",
				"description": "depth of modulation"
			}
		]
	},
	{
		"method": "wtenv",
		"aliases": [],
		"description": "Amount of envelope applied wavetable oscillator's position envelope",
		"parameters": [
			{
				"name": "amount",
				"type": "number | Pattern",
				"description": "between 0 and 1"
			}
		]
	},
	{
		"method": "wtphaserand",
		"aliases": [
			"wavetablePhaseRand"
		],
		"description": "Amount of randomness of the initial phase of the wavetable oscillator.",
		"parameters": [
			{
				"name": "amount",
				"type": "number | Pattern",
				"description": "Randomness of the initial phase. Between 0 (not random) and 1 (fully random)"
			}
		]
	},
	{
		"method": "wtrate",
		"aliases": [],
		"description": "Rate of the LFO for the wavetable oscillator's position",
		"parameters": [
			{
				"name": "rate",
				"type": "number | Pattern",
				"description": "rate in hertz"
			}
		]
	},
	{
		"method": "wtrelease",
		"aliases": [
			"wtrel"
		],
		"description": "Release time of the wavetable oscillator's position envelope",
		"parameters": [
			{
				"name": "time",
				"type": "number | Pattern",
				"description": "release time in seconds"
			}
		]
	},
	{
		"method": "wtshape",
		"aliases": [],
		"description": "Shape of the LFO for the wavetable oscillator's position",
		"parameters": [
			{
				"name": "shape",
				"type": "number | Pattern",
				"description": "Shape of the lfo (0, 1, 2, ..)"
			}
		]
	},
	{
		"method": "wtskew",
		"aliases": [],
		"description": "Skew of the LFO for the wavetable oscillator's position",
		"parameters": [
			{
				"name": "skew",
				"type": "number | Pattern",
				"description": "How much to bend the LFO shape"
			}
		]
	},
	{
		"method": "wtsustain",
		"aliases": [
			"wtsus"
		],
		"description": "Sustain time of the wavetable oscillator's position envelope",
		"parameters": [
			{
				"name": "gain",
				"type": "number | Pattern",
				"description": "sustain level (0 to 1)"
			}
		]
	},
	{
		"method": "wtsync",
		"aliases": [],
		"description": "cycle synced rate of the LFO for the wavetable oscillator's position",
		"parameters": [
			{
				"name": "rate",
				"type": "number | Pattern",
				"description": "rate in cycles"
			}
		]
	},
	{
		"method": "xsdelay",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "zcrush",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "zdelay",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "zmod",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "znoise",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "zrand",
		"aliases": [],
		"description": "",
		"parameters": []
	},
	{
		"method": "zzfx",
		"aliases": [],
		"description": "",
		"parameters": []
	}
] as const;

/** Final alias targets after applying registerControl calls in source order. */
export const STRUDEL_SOURCE_ALIAS_TARGETS: Readonly<Record<string, string>> = {
	"accelerate": "accelerate",
	"activeLabel": "activeLabel",
	"amp": "amp",
	"analyze": "analyze",
	"anchor": "anchor",
	"att": "attack",
	"attack": "attack",
	"bandf": "bpf",
	"bandq": "bandq",
	"bank": "bank",
	"bbexpr": "byteBeatExpression",
	"bbst": "byteBeatStartTime",
	"begin": "begin",
	"bgain": "busgain",
	"binshift": "binshift",
	"bp": "bpf",
	"bpa": "bpattack",
	"bpattack": "bpattack",
	"bpd": "bpdecay",
	"bpdc": "bpdc",
	"bpdecay": "bpdecay",
	"bpdepth": "bpdepth",
	"bpdepthfreq": "bpdepthfrequency",
	"bpdepthfrequency": "bpdepthfrequency",
	"bpe": "bpenv",
	"bpenv": "bpenv",
	"bpf": "bpf",
	"bpq": "bandq",
	"bpr": "bprelease",
	"bprate": "bprate",
	"bprelease": "bprelease",
	"bps": "bpsustain",
	"bpshape": "bpshape",
	"bpskew": "bpskew",
	"bpsustain": "bpsustain",
	"bpsync": "bpsync",
	"bus": "bus",
	"busgain": "busgain",
	"byteBeatExpression": "byteBeatExpression",
	"byteBeatStartTime": "byteBeatStartTime",
	"ccn": "ccn",
	"ccv": "ccv",
	"ch": "channels",
	"channel": "channel",
	"channels": "channels",
	"chord": "chord",
	"chorus": "chorus",
	"clip": "clip",
	"coarse": "coarse",
	"color": "color",
	"colour": "color",
	"comb": "comb",
	"compressor": "compressor",
	"compressorAttack": "compressorAttack",
	"compressorKnee": "compressorKnee",
	"compressorRatio": "compressorRatio",
	"compressorRelease": "compressorRelease",
	"cps": "cps",
	"crush": "crush",
	"ctf": "lpf",
	"ctlNum": "ctlNum",
	"ctranspose": "ctranspose",
	"curve": "curve",
	"cut": "cut",
	"cutoff": "lpf",
	"dec": "decay",
	"decay": "decay",
	"degree": "degree",
	"delay": "delay",
	"delayfb": "delayfeedback",
	"delayfeedback": "delayfeedback",
	"delayspeed": "delayspeed",
	"delaysync": "delaysync",
	"delayt": "delaytime",
	"delaytime": "delaytime",
	"deltaSlide": "deltaSlide",
	"density": "density",
	"det": "detune",
	"detune": "detune",
	"dfb": "delayfeedback",
	"dict": "dictionary",
	"dictionary": "dictionary",
	"dist": "distort",
	"distort": "distort",
	"distorttype": "distorttype",
	"distortvol": "distortvol",
	"disttype": "distorttype",
	"distvol": "distortvol",
	"djf": "djf",
	"drive": "drive",
	"dry": "dry",
	"dt": "delaytime",
	"duck": "duckorbit",
	"duckatt": "duckattack",
	"duckattack": "duckattack",
	"duckdepth": "duckdepth",
	"duckons": "duckonset",
	"duckonset": "duckonset",
	"duckorbit": "duckorbit",
	"dur": "duration",
	"duration": "duration",
	"end": "end",
	"enhance": "enhance",
	"expression": "expression",
	"fadeInTime": "fadeInTime",
	"fadeOutTime": "fadeTime",
	"fadeTime": "fadeTime",
	"fanchor": "fanchor",
	"fft": "fft",
	"frameRate": "frameRate",
	"frames": "frames",
	"freeze": "freeze",
	"freq": "freq",
	"fshift": "fshift",
	"fshiftnote": "fshiftnote",
	"fshiftphase": "fshiftphase",
	"ftype": "ftype",
	"fxr": "FXrelease",
	"FXr": "FXrelease",
	"FXrel": "FXrelease",
	"FXrelease": "FXrelease",
	"gain": "gain",
	"gat": "gate",
	"gate": "gate",
	"harmonic": "harmonic",
	"hbrick": "hbrick",
	"hcutoff": "hcutoff",
	"hold": "hold",
	"hours": "hours",
	"hp": "hcutoff",
	"hpa": "hpattack",
	"hpattack": "hpattack",
	"hpd": "hpdecay",
	"hpdc": "hpdc",
	"hpdecay": "hpdecay",
	"hpdepth": "hpdepth",
	"hpdepthfreq": "hpdepthfrequency",
	"hpdepthfrequency": "hpdepthfrequency",
	"hpe": "hpenv",
	"hpenv": "hpenv",
	"hpf": "hcutoff",
	"hpq": "hpq",
	"hpr": "hprelease",
	"hprate": "hprate",
	"hprelease": "hprelease",
	"hps": "hpsustain",
	"hpshape": "hpshape",
	"hpskew": "hpskew",
	"hpsustain": "hpsustain",
	"hpsync": "hpsync",
	"hresonance": "hpq",
	"imag": "imag",
	"ir": "iresponse",
	"irbegin": "irbegin",
	"iresponse": "iresponse",
	"irspeed": "irspeed",
	"kcutoff": "kcutoff",
	"krush": "krush",
	"label": "label",
	"lbrick": "lbrick",
	"legato": "clip",
	"leslie": "leslie",
	"lock": "lock",
	"loop": "loop",
	"loopb": "loopBegin",
	"loopBegin": "loopBegin",
	"loope": "loopEnd",
	"loopEnd": "loopEnd",
	"lp": "lpf",
	"lpa": "lpattack",
	"lpattack": "lpattack",
	"lpd": "lpdecay",
	"lpdc": "lpdc",
	"lpdecay": "lpdecay",
	"lpdepth": "lpdepth",
	"lpdepthfreq": "lpdepthfrequency",
	"lpdepthfrequency": "lpdepthfrequency",
	"lpe": "lpenv",
	"lpenv": "lpenv",
	"lpf": "lpf",
	"lpq": "resonance",
	"lpr": "lprelease",
	"lprate": "lprate",
	"lprelease": "lprelease",
	"lps": "lpsustain",
	"lpshape": "lpshape",
	"lpskew": "lpskew",
	"lpsustain": "lpsustain",
	"lpsync": "lpsync",
	"lrate": "lrate",
	"lsize": "lsize",
	"midibend": "midibend",
	"midichan": "midichan",
	"midicmd": "midicmd",
	"midimap": "midimap",
	"midiport": "midiport",
	"miditouch": "miditouch",
	"minutes": "minutes",
	"mode": "mode",
	"mtranspose": "mtranspose",
	"n": "n",
	"noise": "noise",
	"note": "note",
	"nrpnn": "nrpnn",
	"nrpv": "nrpv",
	"nudge": "nudge",
	"o": "orbit",
	"oct": "octave",
	"octave": "octave",
	"octaveR": "octaveR",
	"octaves": "octaves",
	"octer": "octer",
	"octersub": "octersub",
	"octersubsub": "octersubsub",
	"offset": "offset",
	"orbit": "orbit",
	"oschost": "oschost",
	"oscport": "oscport",
	"overgain": "overgain",
	"overshape": "overshape",
	"pan": "pan",
	"panchor": "panchor",
	"panorient": "panorient",
	"panspan": "panspan",
	"pansplay": "pansplay",
	"panwidth": "panwidth",
	"patt": "pattack",
	"pattack": "pattack",
	"pcurve": "pcurve",
	"pdec": "pdecay",
	"pdecay": "pdecay",
	"penv": "penv",
	"ph": "phaser",
	"phasdp": "phaserdepth",
	"phaser": "phaser",
	"phasercenter": "phasercenter",
	"phaserdepth": "phaserdepth",
	"phaserrate": "phaser",
	"phasersweep": "phasersweep",
	"phc": "phasercenter",
	"phd": "phaserdepth",
	"phs": "phasersweep",
	"pitchJump": "pitchJump",
	"pitchJumpTime": "pitchJumpTime",
	"polyTouch": "polyTouch",
	"postgain": "postgain",
	"prel": "prelease",
	"prelease": "prelease",
	"progNum": "progNum",
	"psus": "psustain",
	"psustain": "psustain",
	"pw": "pw",
	"pwrate": "pwrate",
	"pwsweep": "pwsweep",
	"rdim": "roomdim",
	"real": "real",
	"rel": "release",
	"release": "release",
	"resonance": "resonance",
	"rfade": "roomfade",
	"ring": "ring",
	"ringdf": "ringdf",
	"ringf": "ringf",
	"rlp": "roomlp",
	"room": "room",
	"roomdim": "roomdim",
	"roomfade": "roomfade",
	"roomlp": "roomlp",
	"roomsize": "roomsize",
	"rsize": "roomsize",
	"s": "s",
	"scram": "scram",
	"seconds": "seconds",
	"semitone": "semitone",
	"shape": "shape",
	"size": "roomsize",
	"slide": "slide",
	"smear": "smear",
	"songPtr": "songPtr",
	"sound": "s",
	"source": "source",
	"speed": "speed",
	"spread": "spread",
	"squiz": "squiz",
	"src": "source",
	"stepsPerOctave": "stepsPerOctave",
	"stretch": "stretch",
	"sus": "sustain",
	"sustain": "sustain",
	"sustainpedal": "sustainpedal",
	"sysexdata": "sysexdata",
	"sysexid": "sysexid",
	"sz": "roomsize",
	"transient": "transient",
	"trem": "tremolo",
	"tremdepth": "tremolodepth",
	"tremolo": "tremolo",
	"tremolodepth": "tremolodepth",
	"tremolophase": "tremolophase",
	"tremoloshape": "tremoloshape",
	"tremoloskew": "tremoloskew",
	"tremolosync": "tremolosync",
	"tremphase": "tremolophase",
	"tremshape": "tremoloshape",
	"tremskew": "tremoloskew",
	"tremsync": "tremolosync",
	"triode": "triode",
	"tsdelay": "tsdelay",
	"uid": "uid",
	"unison": "unison",
	"unit": "unit",
	"v": "vib",
	"val": "val",
	"vel": "velocity",
	"velocity": "velocity",
	"vib": "vib",
	"vibmod": "vibmod",
	"vibrato": "vib",
	"vmod": "vibmod",
	"voice": "voice",
	"vowel": "vowel",
	"warp": "warp",
	"warpatt": "warpattack",
	"warpattack": "warpattack",
	"warpdc": "warpdc",
	"warpdec": "warpdecay",
	"warpdecay": "warpdecay",
	"warpdepth": "warpdepth",
	"warpenv": "warpenv",
	"warpmode": "warpmode",
	"warprate": "warprate",
	"warprel": "warprelease",
	"warprelease": "warprelease",
	"warpshape": "warpshape",
	"warpskew": "warpskew",
	"warpsus": "warpsustain",
	"warpsustain": "warpsustain",
	"warpsync": "warpsync",
	"waveloss": "waveloss",
	"wavetablePhaseRand": "wtphaserand",
	"wavetablePosition": "wt",
	"wavetableWarp": "warp",
	"wavetableWarpMode": "warpmode",
	"wt": "wt",
	"wtatt": "wtattack",
	"wtattack": "wtattack",
	"wtdc": "wtdc",
	"wtdec": "wtdecay",
	"wtdecay": "wtdecay",
	"wtdepth": "wtdepth",
	"wtenv": "wtenv",
	"wtphaserand": "wtphaserand",
	"wtrate": "wtrate",
	"wtrel": "wtrelease",
	"wtrelease": "wtrelease",
	"wtshape": "wtshape",
	"wtskew": "wtskew",
	"wtsus": "wtsustain",
	"wtsustain": "wtsustain",
	"wtsync": "wtsync",
	"xsdelay": "xsdelay",
	"zcrush": "zcrush",
	"zdelay": "zdelay",
	"zmod": "zmod",
	"znoise": "znoise",
	"zrand": "zrand",
	"zzfx": "zzfx"
} as const;
