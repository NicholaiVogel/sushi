// A compact 23-cycle arrangement built around a moving bassline and layered piano motifs.
export const D_MINOR_PULSE_SOURCE = `setcpm(90 / 4)

const key = "D:minor"

register('acidenv', (x, pat) => pat
  .lpf(100)
  .lpenv(x * 9)
  .lps(.2)
  .lpd(.12)
)


// INTRO / LOW END

// Sub pulse
S$: seqPLoop([0, 8,
  n("<0 2>/2")
    .scale(key)
    .octave(-1)
    .sound("supersaw")
    .lpf(slider(1200, 200, 3000))
    .gain(0.09)
    .room(1.2)
    .sustain(1.4)
    .color("#01bcc3")
    ._pianoroll()
])

// Moving bassline
S$: seqPLoop([0, 8,
  n("<<0 0 -2 -2> 4 7 0 4 0 2 5 4 2>*16")
    .scale(key)
    .detune(rand)
    .octave(0)
    .lpenv(1)
    .sound("sawtooth")
    .lpf(slider(1850, 200, 4000))
    .gain(0.07)
    .room(1.2)
    .sustain(1.3)
    .color("#ff7a68")
    ._pianoroll()
])


// MAIN MOTIF

S$: seqPLoop([4, 11,
  n("<<0 0 -2 -2> 4 7>*16"
    .add("<4 7 5 4 0 1 5 4 <-2 3>>"))
    .scale(key)
    .detune(rand)
    .octave(0)
    .sound("bytebeat")
    .lpenv(1)
    .lpf(slider(1450, 200, 4000))
    .gain(0.045)
    .room(1.5)
    .color("#ff4d00")
    ._pianoroll()
])

// Brief piano answer
S$: seqPLoop([7, 9,
  n("<<0 0 -2 -2> 0 4 5 8 9 11 8 5 3>*8")
    .scale(key)
    .detune(rand)
    .octave(0)
    .sound("piano")
    .lpenv(1)
    .lpf(2200)
    .gain(0.025)
    .room(1.4)
    .sustain(1.2)
    .color("#b8c0c6")
    ._pianoroll()
])


// LIFT

// Rising piano figure
S$: seqPLoop([9, 13,
  n("<0 2 4 7>*16"
    .add("<0 2 -1 <-2 3>>"))
    .scale(key)
    .detune(rand)
    .octave(1)
    .sound("piano")
    .lpenv(1)
    .lpf(slider(2100, 500, 4000))
    .gain(0.055)
    .room(.9)
    .sustain(1.1)
    .color("#ff9a00")
    ._pianoroll()
])


// MAIN SECTION

// Harmony / pad
S$: seqPLoop([13, 23,
  n("<0 3 4 7>*8"
    .add("<1 2 3 4>"))
    .scale(key)
    .octave(0)
    .sound("piano")
    .lpf(2600)
    .gain(0.09)
    .room(1.8)
    .sustain(1.8)
    .color("#f6d32d")
    ._pianoroll()
])

// Upper shimmer
S$: seqPLoop([13, 23,
  n("<0 2 4 7>*16"
    .add("<0 2 -1 <-2 3>>"))
    .scale(key)
    .detune(rand)
    .octave(1)
    .sound("piano")
    .lpf(3000)
    .gain(0.028)
    .room(1.4)
    .sustain(.8)
    .color("#ff9a00")
    ._pianoroll()
])

// Soft melody
S$: seqPLoop([12, 20,
  n("<0 2 4 5 4 2 0 -1>*8")
    .scale(key)
    .octave(1)
    .sound("piano")
    .lpf(1800)
    .gain(0.022)
    .room(1.9)
    .sustain(1.25)
    .color("#b8c0c6")
    ._pianoroll()
])

// Sustained bass foundation
S$: seqPLoop([8, 23,
  n("<0 2 -1 <3 -2>>")
    .scale(key)
    .detune(rand)
    .octave(-1)
    .sound("sawtooth")
    .lpf(360)
    .gain(0.18)
    .sustain(1.5)
    .color("#01bcc3")
    ._pianoroll()
])


// DRUMS

// Restrained kick initially
S$: seqPLoop([8, 13,
  s("bd ~ bd ~")
    .gain(.16)
    .lpf(1100)
])

// Full pulse once the harmony opens
S$: seqPLoop([13, 23,
  s("bd*4")
    .gain(.19)
    .lpf(1300)
])

// A little motion without turning it into a drum track
S$: seqPLoop([13, 23,
  s("~ hh ~ hh")
    .gain(.035)
    .room(.4)
    .lpf(5000)
])
`;
