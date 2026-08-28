// A cinematic 24-cycle witch-house arrangement with a gradual lift into a layered climax.
export const WITCH_HOUSE_SOURCE = `setcpm(84 / 4)

const key = "F:minor"
const eighth = 60 / 84 / 2
const dottedEighth = eighth * 1.5
const WITCH_ARP_GAIN = .085
const SCREAM_GAIN = .08

const witchArpVoice = (
  chord,
  order,
  cutoff,
  bits,
  gain = WITCH_ARP_GAIN
) => n(chord)
  .arp(order)
  .scale(key)
  .transpose(12)

  // A focused center voice plus a slightly detuned blade around it.
  .layer(
    x => x
      .sound("supersaw")
      .gain(gain),

    x => x
      .add(note(.035))
      .sound("sawtooth")
      .gain(gain * .34)
  )

  // Reverse the right side so the stereo field feels like it is
  // folding inward and outward simultaneously.
  .juxBy(.68, rev)

  .hpf(780)
  .lpf(cutoff)
  .lpq(1.7)
  .ftype("ladder")

  // Increasingly degraded as the pattern accelerates.
  .crush(bits)
  .distort("2.6:.42:diode")

  // Short enough to articulate the arpeggio, long enough to smear
  // into a continuous wall at the highest rate.
  .attack(.001)
  .decay(.045)
  .sustain(.12)
  .release(.16)

  .compressor("-22:5:4:.002:.05")

  .room(.36)
  .roomsize(7)
  .roomlp(7600)

  .delay(.24)
  .delaytime(eighth / 2)
  .delayfeedback(.27)

  .orbit(12)


// Filter-envelope macro; unlike the original, this does not force lpf(100).
register('acidenv', (depth, pat) => pat
  .lpenv(depth).lpa(.005).lpd(.12).lps(.2).lpr(.2)
)

// Everything below shares one 24-cycle form:
// 0–14 build, 14–16 breath/lift, 16–24 climax.

// @sushi-track {"id":"trk_source_02","name":"Melody","type":"synth","schema":1}
$: seqPLoop(
  [0, 16, n("<<0 0 -2 -2> 4 7 0 4 0 2 5 4 2>*16")
    .scale(key)
    .layer(
      x => x.sound("sawtooth").pan(.43).gain(.18),
      x => x.add(note(.025)).sound("sawtooth").pan(.57).gain(.12)
    )
    .lpf(slider(1500, 500, 4200)).lpq(1.2).acidenv(1.05)
    .attack(.004).decay(.10).sustain(.42).release(.55)
    .room(.42).roomsize(5).roomlp(6000)
    .delay(.10).delaytime(dottedEighth).delayfeedback(.22)
    .orbit(2).color("#ff4d00")._pianoroll()
  ],
  [16, 24, silence]
)

// @sushi-track {"id":"trk_source_03","name":"Bass 01","type":"synth","schema":1}
$: seqPLoop(
  [4, 14, n("<0 2 -1 -2>/2")
    .scale(key)
    .layer(
      x => x.transpose(-12).sound("supersaw").gain(.22),
      x => x.transpose(-24).sound("sine").gain(.15)
    )
    .lpf(slider(1050, 300, 2400)).lpq(1.2).acidenv(.7)
    .attack(.01).decay(.14).sustain(.58).release(.40)
    .room(.08).roomsize(2).roomlp(3500)
    .orbit(3).late(4).color("#f9844a")._pianoroll()
  ],
  [14, 24, silence]
)

// @sushi-track {"id":"trk_source_01-2","name":"Countermelody","type":"synth","schema":1}
$: seqPLoop(
  [10, 16, n("<<0 0 -2 -2> 0 4 5 8 9 11 8 5 3>*8")
    .scale(key)
    .layer(
      x => x.sound("triangle").gain(.16),
      x => x.add(note(.03)).sound("sawtooth").gain(.045)
    )
    .lpf(slider(2400, 800, 5000)).acidenv(.55)
    .attack(.01).decay(.12).sustain(.38).release(.80)
    .room(.50).roomsize(6).roomlp(6500)
    .delay(.14).delaytime(eighth).delayfeedback(.24)
    .orbit(4).late(10).color("#f8961e")._pianoroll()
  ],
)


$: seqPLoop([16, 24, n("<<0 0 -2 -2> 4 7>*16".add("<4 7 5 4 0 1 5 4 <-2 3>>"))
  .scale(key)
  .detune(rand)
  .lpenv(1)
  .octave(0)
  .s("bytebeat")
  .gain(0.33)
  .lpf(slider(1735.2, 200, 4000))
  .room(1.7)
  .lpf(saw.range(1600, 4800).slow(4)).acidenv(.75)
  .attack(.004).decay(.10).sustain(.24).release(.70)
  .room(.58).roomsize(7).roomlp(7500)
  .delay(.18).delaytime(dottedEighth).delayfeedback(.27)
  .orbit(6).late(12)
  .color("#ff4d00")
  ._pianoroll()])


// @sushi-track {"id":"trk_source_01","name":"Bridge","type":"sample","schema":1}
$: seqPLoop(
  [14, 16, n("<<0 0 -2 -2> 4 7>*16")
    .add("<4 7 5 4 0 1 5 4 <-2 3>>")
    .scale(key)
    .sound("bytebeat")
    .hpf(280).lpf(saw.range(1400, 5200).slow(2))
    .attack(.002).decay(.09).sustain(.20).release(.35)
    .gain(.16)
    .room(.28).roomsize(4).roomlp(6500)
    .delay(.12).delaytime(eighth).delayfeedback(.20)
    .orbit(5).late(14).color("#f9c74f")._pianoroll()
  ],
)

// The first part is the lift; the second blooms into the climax harmony.
// @sushi-track {"id":"trk_climax_bloom","name":"Climax Bloom","type":"synth","schema":1}
$: seqPLoop(
  [12, 16, n("<0 2 4 7 9 7 4 2>*8")
    .scale(key).transpose(12)
    .layer(
      x => x.sound("triangle").gain(.10),
      x => x.transpose(12).sound("sine").gain(.025)
    )
    .lpf(saw.range(1600, 4800).slow(4)).acidenv(.75)
    .attack(.004).decay(.10).sustain(.24).release(.70)
    .room(.58).roomsize(7).roomlp(7500)
    .delay(.18).delaytime(dottedEighth).delayfeedback(.27)
    .orbit(6).late(12).color("#ffd166")._pianoroll()
  ],

  [16, 23, n("<0 2 4 7 9 7 4 2>*8")
    .add("<0 -2 2 -1>/2")
    .scale(key).transpose(12)
    .layer(
      x => x.sound("supersaw").pan(.35).gain(.055),
      x => x.add(note(.025)).sound("supersaw").pan(.65).gain(.045)
    )
    .velocity("<.72 .78 .84 .90 .96 1 .86>")
    .lpf(1700).lpq(1.4).acidenv(1.35)
    .attack(.002).decay(.08).sustain(.18).release(.35)
    .room(.42).roomsize(6).roomlp(7000)
    .delay(.16).delaytime(eighth).delayfeedback(.26)
    .orbit(8).late(16).color("#ffd166")._pianoroll()
  ]
)

// The last F screams against the Eb harmony as its ninth, then remains
// psychologically present when the rhythm section disappears.
//
// @sushi-track {"id":"trk_scream_choir","name":"Scream Choir","type":"synth","schema":1}
$: seqPLoop(
  [19, 23, n("<9 11 13 14>")
    .scale(key)

    .layer(
      x => x
        .sound("supersaw")
        .pan(.34)
        .gain(SCREAM_GAIN),

      x => x
        .add(note(.045))
        .sound("supersaw")
        .pan(.66)
        .gain(SCREAM_GAIN * .72),

      x => x
        .transpose(12)
        .sound("sawtooth")
        .pan(.5)
        .gain(SCREAM_GAIN * .20)
    )

    // Moves from an open throat toward a narrower, harsher formant.
    .vowel("<aa ae i aa>")

    .hpf(650)
    .lpf("<3800 5200 7000 9200>")
    .lpq("<1.2 1.5 1.8 2.2>")
    .ftype("ladder")

    // Each successive note strains farther upward.
    .penv("<0 1 2 3>")
    .pattack("<.65 .5 .35 .2>")
    .pdecay(1.05)
    .panchor(0)

    // Vibrato becomes progressively less human and more desperate.
    .vib("<5:.06 5.5:.09 6:.13 7:.18>")

    .attack(.07)
    .decay(.26)
    .sustain(.82)
    .release(1.3)

    .crush("<12 11 9 8>")
    .distort("4:.32:diode")

    .compressor("-22:8:6:.003:.10")

    .phaser("<1.8 2.4 3.2 4.5>")
    .phaserdepth(.88)
    .phasercenter(2600)
    .phasersweep(3800)

    .room(.74)
    .roomsize(9)
    .roomlp(8000)

    .delay(.30)
    .delaytime(dottedEighth)
    .delayfeedback(.35)

    .orbit(13)
  ],

  [23, 24, silence]
)
  .color("#ff2d95")
  ._pianoroll()

// The harmony is explicitly synchronized to the existing climax pad:
//
// cycle 19:       Db
// cycles 20–21:  Ab
// cycle 22:       Eb(add9)
//
// @sushi-track {"id":"trk_climax_pad","name":"Climax Pad","type":"synth","schema":1}
$: seqPLoop(
  [16, 24, n("<[0,2,4,7] [0,2,5,14] [-1,2,4,13] [-1,1,3,6]>/2")
    .scale(key)
    .layer(
      x => x.sound("supersaw").gain(.12),
      x => x.transpose(12).sound("sine").gain(.025)
    )
    .velocity("<.76 .86 .96 .84>/2")
    .hpf(120).lpf(slider(2800, 900, 6000))
    .attack(.65).decay(.25).sustain(.72).release(2.30)
    .compressor("-18:3:5:.02:.18")
    .room(.54).roomsize(8).roomlp(5200)
    .delay(.08).delaytime(dottedEighth).delayfeedback(.20)
    .orbit(7).late(16).color("#c77dff").octave(0)._pianoroll()
  ]
)

// Peaks over Ab, then holds F over the final Eb chord.
// @sushi-track {"id":"trk_climax_lead","name":"Climax Lead","type":"synth","schema":1}
$: seqPLoop(
  [16, 24, n(\`<
    [~ 7@2 11 9]
    [4 5 7@2 9]
    [~ 5@2 9 7]
    [9 12 11@2 9]
    [9 11 13 16@2]
    [14@2 13 11 9]
    [8 10 12 15@2]
    [12 10 8 7@3]
  >\`)
    .scale(key)
    .layer(
      x => x.sound("triangle").gain(.24),
      x => x.add(note(.03)).sound("sawtooth").gain(.045)
    )
    .velocity("<.78 .82 .86 .90 1 .96 .90 .82>")
    .hpf(180).lpf(slider(4300, 1200, 8000)).vib("5:.055")
    .attack(.03).decay(.14).sustain(.70).release(1.20)
    .room(.58).roomsize(7).roomlp(6500)
    .delay(.20).delaytime(dottedEighth).delayfeedback(.30)
    .orbit(9).late(16).color("#ffcad4")._pianoroll()
  ]
)

// @sushi-track {"id":"trk_climax_bass","name":"Climax Bass","type":"synth","schema":1}
$: seqPLoop(
  [16, 23, n("<0 -2 2 -1>/2")
    .scale(key)
    .layer(
      x => x.transpose(-12).sound("sawtooth").gain(0.29),
      x => x.transpose(-24).sound("sine").gain(.18)
    )
    .velocity("<.84 .90 1 .88>/2")
    .lpf(700).lpq(.8)
    .attack(.01).decay(.12).sustain(.68).release(.50)
    .compressor("-17:4:4:.006:.12")
    .room(.025).roomsize(1).roomlp(2500)
    .orbit(10).late(16).color("#7209b7")._pianoroll()
  ],

  [23, 24, silence]
)

// @sushi-track {"id":"trk_climax_kick","name":"Climax Kick","type":"drum","schema":1}
$: seqPLoop(
  [14, 16, s("<[bd:1 ~ ~ ~] [bd:1 ~ bd:1 ~]>")
    .gain(.52).lpf(160)
    .room(.035).roomsize(3).roomlp(7000)
    .orbit(1).late(14).color("#ef476f")
  ],

  [16, 17, s("white")
    .gain(.12).hpf(1800).lpf(12000)
    .attack(.001).decay(.75).sustain(0).release(1.50)
    .room(.55).roomsize(8).roomlp(9000)
    .orbit(11).late(16).color("#ffffff")
  ],

  [16, 23, s("bd:1 ~ bd:1 [~ bd:1]")
    .gain(.78).lpf(180)
    .compressor("-15:5:4:.003:.08")
    .duckorbit("7:8:12").duckattack(".28:.16:.10").duckdepth(".14:.24:.18")
    .room(.035).roomsize(3).roomlp(7000)
    .orbit(1).late(16).color("#ef476f")
  ],

  [23, 24, silence]
)

// @sushi-track {"id":"trk_climax_snare","name":"Climax Snare","type":"drum","schema":1}
$: seqPLoop(
  // Pre-climax fill.
  [14, 16, s("<~ [~ ~ sd [sd sd]]>")
    .gain(0.25)
    .hpf(240)
    .lpf(9000)
    .room(.24)
    .roomsize(4)
    .roomlp(7200)
    .orbit(15)
    .color("#118ab2")
  ],

  // Familiar backbeat during the initial climax reveal.
  [16, 19, s("~ sd ~ sd")
    .gain(.44)
    .hpf(240)
    .lpf(9000)
    .room(.26)
    .roomsize(4)
    .roomlp(7200)
    .orbit(15)
    .color("#118ab2")
  ],

  // Cycle 19 pivots into the witch-house half-time feel.
  [19, 22, s("~ ~ sd ~")
    .gain(.56)
    .hpf(260)
    .lpf(8500)
    .crush(11)
    .distort("1.7:.58:diode")
    .room(.38)
    .roomsize(5)
    .roomlp(6800)
    .orbit(15)
    .color("#118ab2")
  ],

  // Final half-time hit followed by a late ratchet.
  [22, 23, s("~ ~ sd [~ sd*4]")
    .gain(.40)
    .hpf(280)
    .lpf(9000)
    .crush(10)
    .distort("1.9:.54:diode")
    .room(.40)
    .roomsize(5)
    .roomlp(7000)
    .orbit(15)
    .color("#118ab2")
  ],

  [23, 24, silence]
)

// @sushi-track {"id":"trk_climax_hats","name":"Climax Hats","type":"drum","schema":1}
$: seqPLoop(
  // Existing noise lift into the first impact.
  [14, 16, s("white*16")
    .gain(saw.range(0, .055).slow(2))
    .hpf(saw.range(1200, 7600).slow(2))
    .lpf(11000)
    .attack(.001)
    .decay(.08)
    .sustain(0)
    .release(.18)
    .room(.45)
    .roomsize(8)
    .roomlp(9000)
    .orbit(11)
    .color("#e9ecef")
  ],

  // Establish the pulse before the second eruption.
  [18, 19, s("hh*8")
    .gain(.12)
    .velocity("[.45 .72 .55 1]*2")
    .hpf(4700)
    .lpf(11000)
    .decay(.04)
    .sustain(0)
    .release(.025)
    .crush(13)
    .juxBy(.45, rev)
    .room(.10)
    .roomsize(4)
    .roomlp(8500)
    .delay(.07)
    .delaytime(eighth / 2)
    .delayfeedback(.14)
    .orbit(14)
    .color("#06d6a0")
  ],

  // Cycle 19: triplet-derived ratchet.
  [19, 21, s("hh*12")
    .gain(.115)
    .velocity("[.40 .72 .52 1]*3")
    .hpf(5200)
    .lpf(11500)
    .decay(.035)
    .sustain(0)
    .release(.022)
    .crush(11)
    .juxBy(.58, rev)
    .room(.10)
    .roomsize(4)
    .roomlp(8500)
    .delay(.07)
    .delaytime(eighth / 2)
    .delayfeedback(.14)
    .orbit(14)
    .color("#06d6a0")
  ],

  // Cycle 21: straight sixteenth pressure.
  [21, 22.5, s("hh*16")
    .gain(.105)
    .velocity("[.35 .70 .48 1]*4")
    .hpf(5900)
    .lpf(12000)
    .decay(.028)
    .sustain(0)
    .release(.018)
    .crush(9)
    .juxBy(.66, rev)
    .room(.10)
    .roomsize(4)
    .roomlp(8500)
    .delay(.07)
    .delaytime(eighth / 2)
    .delayfeedback(.16)
    .orbit(14)
    .color("#06d6a0")
  ],

  // Last half-cycle: a controlled burst rather than a louder one.
  [22.5, 23, s("hh*32")
    .gain(.072)
    .velocity("[.25 .55 .35 1]*8")
    .hpf(6800)
    .lpf(13000)
    .decay(.016)
    .sustain(0)
    .release(.012)
    .crush(7)
    .distort("1.3:.55:diode")
    .juxBy(.74, rev)
    .room(.08)
    .roomsize(4)
    .roomlp(9000)
    .delay(.06)
    .delaytime(eighth / 2)
    .delayfeedback(.12)
    .orbit(14)
    .color("#06d6a0")
  ],

  [23, 24, silence]
)


$: seqPLoop([14, 16, s("bd:1!4")
  .gain(0.1)
  .lpf(180)
  .room(.25)
  .color("#ef476f")])


$: seqPLoop([14, 16, s("~ sd ~ sd")
  .gain(0.22)
  .room(.45)
  .color("#118ab2")])


$: seqPLoop([14, 16, s("hh*8")
  .gain(0.2)
  .decay(.05)
  .lpf(9000)
  .room(.2)
  .color("#06d6a0")])
`;

