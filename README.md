# Handpan

Live apps on GitHub Pages:
- [Singing trainer](https://manicardifrancesco.github.io/handpan/trainer.html)
- [Handpan synthesizer](https://manicardifrancesco.github.io/handpan/)
- [Elaia 3D handpan player](https://manicardifrancesco.github.io/handpan/Elaia-handpan-player/)

## Elaia 3D handpan player

Open `http://localhost:8080/Elaia-handpan-player/` using the server below, or
follow **Elaia 3D player** from the synthesizer. Elaia adds a dedicated,
responsive performance view, procedural WebGL metal lighting, 15 Ayasa presets
with measured shell and field geometry, playable notes/chords, and an advanced
editor for both shells. Change concert
pitch (440/432 Hz), transpose, edit pitches, move/resize/rotate/add/remove fields,
undo/redo, place notes automatically and drag them directly, save instruments
locally with recreation URLs, share self-contained layout links, and
import/export JSON. Published Ayasa preview recordings provide temporary sound;
the physical-modeling engine fills in when previews are unavailable. There is
no build step or runtime package installation.

See [Elaia documentation](Elaia-handpan-player/README.md) for controls,
implementation, and validation.

Publishing is handled by [Deploy GitHub Pages](.github/workflows/pages.yml).
Every push to `master` publishes the static repository root, preserving the
synthesizer, `trainer.html`, and Elaia's shared `src/` modules and AudioWorklet.
There is no build step. The workflow can also be run manually from the Actions
tab on `master`. GitHub Pages uses **GitHub Actions** as its publishing source.
The deployment result appears in the `github-pages` environment.

```sh
node tests/elaia.test.mjs
node tests/elaia-browser.test.cjs http://127.0.0.1:8080
```

## Handpan tuning studio

This is a checkpoint of a separate tuning-tool task, unrelated to the Elaia 3D
player work. The tuner shares the original synthesizer's audio engine and scale
modules, but its Lombardo preset and microphone analysis belong to this tool.

Open `http://localhost:8080/tuner.html` using the server below, or follow
**Tuning studio** from the synthesizer. Pan / Tune is a standalone, responsive
handpan tuner with no build step or runtime dependencies.

The default instrument is the owner's confirmed Lombardo D Aegean 18 at A4 = 440 Hz:

- Top: D3, F#3, A3, C#4, D4, F#4, G#4, A4, C#5, D5, F#5.
- Bottom, in the supplied field order: E3, G#3, B3, E4, E5, B4, B2.

Select a field and enable the microphone. The three independent measurements
compare the fundamental, octave and compound fifth with ideal 1:2:3 frequencies.
Each has a moving strobe, cents deviation, measured frequency and tolerance
indicator. For overtones, **interval error** compares the actual measured partial
against 2× or 3× the actual measured fundamental, distinguishing overall note
detuning from a mistuned overtone. The compound fifth is the third harmonic,
an octave plus a pure fifth above the fundamental, not the 1.5× simple fifth.

**Play modeled handpan** uses the original AudioWorklet modal physical-modeling
synthesizer: steel resonators, independent decays, split mode pairs, shell/cavity
resonance, sympathetic coupling and room reverb. The tuner calibrates the three
principal modes to exact 1:2:3 while retaining the model's timbre; a gentle
reference strike avoids hard-strike pitch bending. Isolated 1×/2×/3× buttons
remain pure tones for checking individual partials. **Play on tap** auditions
any of the 18 fields when the microphone is off, and the playground link opens
the same Lombardo layout in the original 3D synthesizer.

**Capture strike**
records up to five seconds locally, then **Your handpan** plays it for A/B
comparison. Selecting another note discards the capture. Use headphones to keep
reference playback out of microphone measurements. Recording is explicit;
there is no server upload, and recordings are not persisted.

Pitch history displays the last 12 seconds with silence gaps, and Spectrum shows
the live FFT with ideal partial markers. **Try a demo** sends intentionally
detuned oscillators through the same analyser and detector; demo readings are
clearly labeled. The settings dialog allows A4 calibration and all 18 note names
to be edited; only instrument settings are saved to localStorage.

Microphone access requires HTTPS or localhost. Echo cancellation, noise
suppression and automatic gain control are requested off. Hiding the page
stops microphone and demo input. Tone-field positions are schematic, not an
exact geometric map of the physical handpan.

Detection uses a 32768-point browser Blackman FFT, zero temporal FFT smoothing,
and logarithmic parabolic peak interpolation around each expected partial
(±85 cents). Analysis updates approximately every 85 ms, after an initial
900 ms settling period. Three consecutive coherent observations are required
before displaying a partial, suppressing startup transients without averaging
the measured pitch. Low levels, missing peaks and broad noise are rejected.
The FFT window spans approximately 0.68–0.74 seconds at common sample rates:
let a gently struck field ring for about a second. Transient pitch bends,
neighboring resonances and closely spaced split modes can influence a reading;
this is a diagnostic aid rather than certified tuning equipment.

Validation:

```sh
node tests/tuner.test.mjs
node tests/tuner-browser.test.cjs http://127.0.0.1:8080
node tests/tuner-reference.test.cjs
node tests/tuner-reference-browser.test.cjs http://127.0.0.1:8080
```

The browser test measures all 54 principal partials through real Chromium
audio analysis, and covers missing fundamentals, silence, mobile layouts,
local A/B recording, microphone lifecycle, demo and saved concert pitch.
The reference tests check all 54 calibrated modal frequencies and real
AudioWorklet output for all 18 fields, pure partial playback, shared audio
context, volume, stop, calibration, and the 3D synthesizer preset.

## Singing trainer

Open `http://localhost:8080/trainer.html` after starting the server below.
Handpan Voice offers microphone pitch detection, visual higher/lower guidance,
reference tones, 15 classic/exotic handpan layouts (including D and F Aegean 18), and
octave adjustment. Audio is processed locally and is not recorded or uploaded.
Use headphones to prevent reference-tone pickup. Microphone access requires
localhost or HTTPS; allow permission when prompted. The detector supports
approximately 40–2400 Hz.

Reference notes use the original handpan synthesizer's physical model, with its
default strike, sustain, sympathetic coupling, and reverb settings.

A fading three-second pitch trail shows how your voice approaches the target,
with gaps during silence and a fresh trail for each target note.

The rolling two-second score uses
`100 × exp(-RMS pitch error in cents / 50)`. Target deviation (RMS) measures
accuracy; standard deviation (σ) measures steadiness around your average pitch.
Silence is excluded, samples expire after two seconds, and selecting a new note
resets the window.

### Holding a note

Progress towards a note is a bank, not a switch, and three zones decide what each
frame does to it. Inside the tolerance it fills at real time; between the
tolerance and the **drift edge** — three times the tolerance, never closer in
than ±50 cents nor further out than ±150 — it eases back at 0.5× real time just
outside the tolerance, rising to 2× at the far edge; past the drift edge you are
singing a different note and the bank empties. Silence costs the gentlest drift
rate, so you can take a breath.

Both bands are drawn in the pitch space from the current level, so what you see
is what is being measured, and the ring around the marker turns amber while the
bank is easing back. A wrong note has to persist for 360 ms before the bank
empties: that outlasts the coaching line's own hysteresis, so an octave-jump
detection glitch costs nothing and you are always told you have gone wrong before
anything is taken away. The **hold progress** tile reads the bank as a
percentage, with the zone it is in.

The practical effect: a slip of one analysis frame costs about 3% of a *Balanced*
hold instead of all of it, and an ordinary wobbly two-second hold lands in about
two and a half seconds of singing.

### Practice modes

- **Guided scale** — hold each note in tune, then it advances on its own.
- **Stay on one note** — the same note until you choose another.
- **Speedrun** — the whole scale against the clock. The timer starts on your
  first sung note and stops on the last note found, the hold shortens to 0.8 s,
  and notes may be found in any order. Stopping the microphone or hiding the tab
  voids the run. Your best time is kept per scale, register and difficulty.
- **Arpeggio** — the handpan plays a short phrase (three or four notes from six
  patterns), then the phrase scrolls right to left across the pitch space,
  guitar-hero style. Sing each note while its block crosses the centre line; a
  block turns green when held long enough and amber when missed. Rounds run
  continuously, walking the starting degree up the scale, and clean rounds
  streak. In this mode the vertical axis is absolute pitch across the phrase
  rather than ±150 cents around one target, so the blocks, the marker and the
  trail read as one melodic contour.

### Difficulty

One ladder sets both how close you must be and how long you must hold, from
*Very gentle* (±40 cents, 1.0 s) to *Exacting* (±5 cents, 3.0 s), starting at
*Balanced* (±15 cents, 2.0 s). **Make it easier** / **Make it harder** move one
rung; the choice is remembered. If a note takes a long time despite steady
singing, or several notes land quickly and well inside the target, a single
inline suggestion offers the next rung — one at a time, gone after 15 s, quiet
for 45 s afterwards (3 minutes if dismissed), and never during a speedrun.

### Progress graph

Every note you find is stored with the RMS distance from the target across the
whole time you sang it, so the graph measures accuracy rather than the one lucky
moment that completed the hold. Moments more than 150 cents off — a wrong note,
or an octave-jump detection glitch — are discarded, and a note needs at least six
kept samples to be recorded at all. The panel shows the last 20, 50 or all
points with a least-squares trend line, the in-tune band for your current
difficulty, hairlines where practice stopped for half an hour or more, average /
closest / count / speedrun-best tiles, a hover tooltip, and a table view of the
same numbers. History lives in `localStorage` (last 400 notes) and survives
reloads; **Clear history** erases it after a confirming second tap. The
scale-completion counter still resets when you change scale or register.

## Synthesizer

A handpan synthesizer that builds its sound from a physical model rather than
samples: one two-pole resonator per vibrational mode, driven by a compliant
contact force pulse. Runs entirely in the browser, no build step, no
dependencies.

```sh
python3 -m http.server 8080 --bind 127.0.0.1
# then open http://127.0.0.1:8080/
```

Click once to start audio (browsers require a gesture). Drag to orbit the shell,
scroll to zoom, tap a tone field to play it, tap bare shell for a *tak*. The
keyboard rows `space a s d f g h j k l ;` then `q w e r t y u i o p` map to the
layout in playing order; `shift` softens, `alt` hits harder, `m` damps.

## Why it sounds like a handpan

The details that matter most, in rough order of audibility:

- **Just 1:2:3 principal modes.** Each tone field is tuned so its octave and
  twelfth are exact integer ratios, not equal-tempered (an ET twelfth is 2.9966
  — flat enough to beat audibly against a true 3.0).
- **Independent per-mode decay.** Every mode has its own T60, so the timbre
  evolves as the note rings: about 5.5 s for the fundamental, 4.2 s for the
  octave, 2.6 s for the twelfth on a D3 ding, scaled by pitch.
- **Beating from near-degenerate pairs.** Each principal mode is a *pair* of
  modes 1–3 Hz apart, the way a real tone field's two orthogonal modes never
  land on exactly the same frequency. This is what produces the slow shimmer.
  It is not random detuning.
- **Sympathetic resonance.** Notes are coupled where their mode frequencies
  coincide, so striking one note excites its octave partners at −25…−35 dB.
  The coupling pattern is emergent, not hand-authored.
- **Resonator state is never reset.** A new strike adds energy to modes that are
  already ringing, so fast playing accumulates and interacts.
- **Compliant contact excitation.** A unit impulse through two cascaded
  one-poles, `h(t) = (t/T²)e^(−t/T)`: monotone −12 dB/oct with no spectral
  nulls, so harder strikes get brighter smoothly. (A Hann-window pulse has
  nulls that make individual partials vanish at particular velocities.)
- **Velocity and position matter.** Strike position morphs the partial balance
  (−18 dB fundamental / +6 dB octave / +8 dB twelfth at the shoulder versus the
  dimple); hard strikes gate in an inharmonic cluster at 5.9/7.4/8.2·f₀ and
  bend pitch up about 7 cents, settling over 80 ms.
- **Shared body.** A Helmholtz cavity mode and two shell modes are excited by
  every strike, tying the notes into one instrument.

## Scales

24 layouts in four families:

- **Classic** (6) — D Kurd, D Celtic Minor, D Amara/Ysha, F Low Pygmy,
  C# Annaziska, E La Sirena
- **Exotic** (9) — D Aegean 18 (Lombardo), D Hijaz, F Aegean 18, D Sabye, C# Raga Desi, F Blues,
  G Oxalis, E Equinox, B Shang Diao
- **Mutant** (5) — 14- to 21-note layouts that use the bottom shell:
  F Low Pygmy 18, D Kurd 14, D Kurd 21, E Integral 21, C Harmonic Minor 21
- **Impossible** (4) — sub-bass dings no real shell could hold: D1 Abyss 12,
  C1 Leviathan 16, A0 Tectonic 14, and F#0 Gravity Well 18 at 23.12 Hz. A
  physical handpan's ding is bounded by shell size and steel thickness; a model
  is not.

## Chord visualiser

For any layout, the right-hand panel lists every chord playable on it, checked
against 25 chord types from standard Western theory. Chords are grouped by root
with Roman-numeral degrees relative to the ding, ranked so common types and
compact voicings come first, and filterable by triad / seventh / extension.
Clicking one highlights its notes on the shell and strums it. Whatever you play
is identified live, tolerating one missing or one extra note.

## Layout

```
index.html                    markup only
src/model/notes.js            note names, MIDI/frequency, seeded RNG
src/model/scales.js           the 24 scale layouts
src/model/instrument.js       mode table -> resonator bank + coupling matrix
src/dsp/handpan-processor.js  the AudioWorklet: resonators, excitation, limiter
src/audio/engine.js           Web Audio graph, worklet lifecycle, strike dispatch
src/theory/chords.js          chord finding, voicing, identification, modes
src/ui/renderer3d.js          software 3D shell on Canvas2D
src/ui/chordpanel.js          chord visualiser
src/ui/app.js                 wiring, input, animation
handpan.html                  the original single-file version, kept for reference
```

The model layer computes *what* to synthesize (frequencies, T60s, amplitudes,
coupling) on the main thread; the worklet only runs filters. That split keeps
the audio thread allocation-free and makes the model testable offline.

## Tests

```sh
node tests/theory.test.mjs     # 208 assertions: chord theory, no browser needed
node tests/dsp.test.cjs        # 163 assertions: numeric DSP measurement
node tests/browser.test.cjs    # 105 assertions: real Chromium, needs a server
```

The singing trainer keeps its logic in `.mjs` modules with no DOM, so each piece
runs under plain node:

```sh
node tests/trainer.test.mjs             # pitch detection on synthetic signals
node tests/trainer-score.test.mjs       # rolling accuracy and stability
node tests/trainer-feedback.test.mjs    # higher/lower hysteresis
node tests/trainer-hold.test.mjs        # the three hold zones and the glitch grace
node tests/trainer-progress.test.mjs    # outlier gating, trend, history, records
node tests/trainer-difficulty.test.mjs  # the ladder and the struggle nudge
node tests/trainer-arpeggio.test.mjs    # round timing, phases, lane geometry
node tests/trainer-browser.test.cjs http://127.0.0.1:8080  # the whole trainer
```

`tests/trainer-browser.test.cjs` drives real Chromium: it compares every tone
field against the synthesizer's own layout, then feeds an oscillator through
`getUserMedia` to sing the targets, so the hold and its three zones, the
completion, the graph, the speedrun clock and a full arpeggio round are exercised
end to end.

`tests/dsp-harness.cjs` loads the real worklet and model code in a `vm` context
and renders blocks by hand, so the numbers are exactly what the browser
produces. It measures partial levels, per-mode T60 by narrowband envelope
fitting, tuning in cents, beating depth, coupling levels from resonator state,
and stability under abuse. `tests/browser.test.cjs` covers what the harness
cannot reach: worklet module loading, the 3D view, picking, and the UI.

The browser test needs Playwright and a running server:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 &
node tests/browser.test.cjs http://127.0.0.1:8080
```

## Sources

Measured values come from the acoustics literature on the handpan and its
ancestors: Rossing, Morrison & Hansen (ISMA 2007) on steelpan mode structure
and tuning; Wessel et al. (2008); Alon, *Modal Analysis of the Handpan* (MSc,
University of York, 2016).
