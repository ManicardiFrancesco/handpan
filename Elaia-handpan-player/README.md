# Elaia — Handpan Player

A standalone 3D handpan player with a minimal performance view and a direct
instrument editor. Served from `/Elaia-handpan-player/`; no build step,
framework, external texture downloads, or runtime package installation.

From the repository root:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/Elaia-handpan-player/`. Audio requires a user
gesture and HTTPS or localhost. Static hosting, including GitHub Pages, works.

## Publishing

Live URL: <https://manicardifrancesco.github.io/handpan/Elaia-handpan-player/>.

The repository's [Pages workflow](../.github/workflows/pages.yml) publishes
every push to `master`, with a manual rerun available in GitHub Actions.
It uploads the static repository root without a build step, retaining the
existing synthesizer and singing trainer routes. Deploy the root rather than
this folder alone: Elaia imports `../src/` modules, and the audio engine loads
`src/dsp/handpan-processor.js`.

HTML, ES modules, fonts, and geometry use relative paths, so they resolve under
the `/handpan/` project prefix. Share links retain the current URL and encode
the layout in its fragment; no server routing is needed. Temporary Ayasa audio
previews remain external, with local synthesis as fallback.

The fallback synth uses exact fundamental, octave, and twelfth frequencies,
including at 432 Hz. The shared model's optional `idealPartials` setting is
included in the published site; other instruments retain their existing tuning.

## Playing

- Tap a 3D tone field or note button; multiple fingers can play together.
- Tap bare steel for a finger slap. Force, position, and shell affect its sound.
- Drag to orbit, scroll or pinch to zoom; choose Top or Bottom to
  flip the instrument. Exposed fields from either shell remain playable
  in angled views; the nearest visible surface determines the hit.
- Choose one of 15 Ayasa instruments with measured field positions,
  varied sizes, convex/concave caps, and 13–22 notes across both shells.
  D Aegean 18 is the default. The earlier generated presets are removed.
- Each chord offers its available root octaves. For example, D Aegean 18
  offers B minor at B2, B3, and B4. Actual notes appear after playing;
  a high root with lower accompaniment is labeled with its inversion.
- A note struck on the hidden shell produces a soft blue pulse through the
  visible steel. It follows camera rotation and fades with the strike; damping
  clears it. Visible fields retain their warm strike highlight.
- Listen → Top notes, Bottom notes, or All notes plays every chosen field
  from lowest to highest, one note every 600 ms. Stop, tapping the active
  demo again, manual playing, or entering Customize ends the sequence.
  Switching demos starts the new sequence from its lowest note.
  Required recordings finish loading before the sequence begins.
- Adjust volume and room ambience or damp all notes.
- Switch among ember bronze, brushed steel, and rose copper finishes.
- Keyboard: Space, A–;, Q–P, then Z–N and punctuation. Shift softens strikes,
  Alt increases force, and M damps. The keyboard button shows assignments.

## Editing

Customize is the advanced mode. Layout contains direct field editing;
Sound & tuning contains 440/432 Hz, whole-instrument semitone transposition,
volume, ambience, and finish. The instrument remains
playable in Sound & tuning so changes can be auditioned immediately.

Select a field on the model or note list to set its pitch, step by a semitone,
audition it, move it to the other shell, or remove it. Field geometry discloses
convex/concave shape, size, and rotation. The desktop inspector scrolls
independently; on phones a single editor sheet sits below the instrument.
The header's + button opens Add notes; undo, redo, and Save remain in that header.
In Play, the phone note palette follows the viewed shell; Chords has its own tab.
Drag any field directly in Layout; no tool change is needed. Right or middle
mouse dragging always orbits the camera. Add notes stays open after every
addition. Follow scale suggests missing published notes first, then continues
upward through the selected scale. Tap Add repeatedly without reopening the
panel or choosing each pitch; Done opens the last field's editor. Turn off
Follow scale to repeat a chosen pitch. Unassigned places silent fields whose
pitches can be chosen later; it is also the default when a custom document
has no identifiable scale.

Vacant published top positions are filled with their original geometry.
Once those positions are occupied, the inner mutant cluster grows from one
centred field to a symmetric pair, then three-, four-, and five-field wedges.
The cluster rearranges when fields are added or removed; outer fields retain
their measured positions. Inner sizes retain their proportions and reduce
only as needed to fit. A manual drag, resize, rotation, or shell change
takes over the layout: subsequent additions use free space and leave existing
fields untouched. Undo restores automatic placement. Placement mode and
automatic slot metadata survive saving, sharing, and reloading.

Drag a newly added field to adjust it. Placement
reserves room around other fields, the rolled rim, and the bottom sound port.
The added field stays selected. Layouts can contain 1–48 fields; assigned
pitches use the F♯0–C7 range. Unassigned fields are excluded from recorded
audio, chords, and demos.

Original appears beside the instrument heading after customization or
transposition. It restores the selected factory instrument's notes, positions,
sizes, and shapes, retaining reference tuning and finish. The reset is one
undoable action. Reset layout in the editor has the same behavior.

Edits, tuning, removal, preset changes, and dragging support 50 levels of
undo/redo; one slider or drag gesture creates one history entry. Ctrl/Cmd+Z
undoes, Ctrl/Cmd+Shift+Z redoes, and Escape leaves editing.

Dragging and size/rotation changes retain the full mesh and normal-map
resolution. Only the old/new field regions are resampled and uploaded.
Stationary regions keep their baked detail, and the updated normal map is
reused on release. Local cap tessellation is refreshed when the gesture ends.

## Saving and sharing

The current instrument is remembered locally. Named instruments are stored in
the browser on the current device. Save & get link immediately opens a
recreation URL for that named version. Saved collection entries also have a
Share button. Export/import uses validated JSON.

Share links encode the entire layout in the URL fragment: pitches, shell
membership, XY positions, size, aspect ratio, rotation, cap shape, source
geometry references, concert pitch, and finish. They need
no server storage or account. Link length depends on field count; JSON export
is available for messaging services that limit URL length. Opening a link
loads its instrument; editing it replaces the fragment and saves the current
layout locally.

The app's host must be reachable by the recipient. Localhost links recreate
layouts on the same machine; the share dialog explains this when running
locally. Serve the app on a public static host to share with other people.

Device storage and clipboard restrictions are reported in the interface.
Clearing browser storage clears saved instruments; exported files and shared
links remain usable.

## Published geometry and preview sound

The library contains only Ayasa D Aegean 18/20, D Kurd 13/19,
F♯ Low Pygmy 21, E Amara 20, D Ashakiran 19, B2 Aavartan 17,
F♯2 Nordlys 16, C Ashakiran 17, B3 Pygmy 20, F♯ Kurd 22, and
three Elements instruments.

`layouts.mjs` records the primary source URL for each model. The geometry
was retrieved 10 November 2026 from the manufacturer's publicly served
model definitions:

- [Ayasa collection](https://ayasainstruments.com/collections/handpans)
- [D Aegean 18 definition](https://ayasainstruments.com/cdn/shop/t/4/assets/d-aegean-18.model.json)
- [F♯ Low Pygmy 21 definition](https://ayasainstruments.com/cdn/shop/t/4/assets/fis-low-pygmy-21.model.json)

The 265 fields retain pitches, shell membership, centres, outer/inner contours,
axes, type/drawn metadata, field planes and frames, convex tier radii/heights,
and concave dimple radii/depths. Source shell profiles determine the body.
Elaia narrows the gu mouth to 18% of the shell radius (a 95.4 mm opening on a
530 mm body), with a rounded collar joining the original underside profile.
D Aegean 18 has convex D3/F♯3 on top and B2/E3/G♯3
underneath; the renderer does not assume that only the central ding is convex.

Geometry is normalized by the source rim radius. Source `[X,Y,Z]` becomes
`[z,x,y]` in the app; the bottom stays in the same coordinate system when
flipped. Contours are packed at 0.01 mm precision; shell profiles retain
float32 precision. Rounded caps, blending, lighting and materials use Elaia's
own rendering implementation. This is measured procedural geometry, not a
photographic scan or an exact reproduction of Ayasa's lighting shader.
Ellipses remain convenient handles for editing and collision checks; the
visible field shoulders follow the actual source contours. The arbitrary
6% reduction in field size has been removed.

Unedited obsolete factory sessions reopen as the corrected Ayasa preset.
Custom layouts, renamed instruments, saved collection entries and shared links
keep their documents. Factory refresh does not overwrite a changed field or
renamed saved instrument.

`samples.mjs` maps every preset note to the recording used by Ayasa's player,
including its attack offset. D Aegean and several others use a generic note
bank; E Amara, D Kurd 19, F♯ Low Pygmy and F♯ Kurd also have dedicated samples.
These remote MP3s are temporary preview sound. No audio files are bundled.
Replace the manifest URLs and note mappings with your own recordings when
ready. Public availability is not a grant of a redistribution license.

Only the selected instrument preloads, with three concurrent requests.
Offline decoding prepares recordings before the first gesture; playback still
requires a gesture. The current bank stays resident. Older banks are evicted
to keep decoded memory within 32 MB where the current bank permits.
Loaded previews play
polyphonically, follow 432/440 Hz and transposition, pan with their fields, and
respond to damping. A strike during loading waits for its recording rather
than changing timbre; damping or changing the layout cancels waiting strikes.
Recordings are used automatically; if one fails, the physical model fills that
gap. Older layouts with a saved sound preference also follow this default.
Remote previews require an internet connection; geometry
and the physical model are self-contained.

## Implementation

- `model.mjs`: presets, layout schema, placement, transposition, audio ordering,
  and Unicode-safe URL serialization.
- `layouts.mjs`, `geometry-data.mjs`, `geometry.mjs`: source-attributed
  manufacturer layout and complete physical geometry, with compact decoding.
- `surface.mjs`: measured shell profiles, contour shoulders, tilted field
  planes, two-tier domes, and dimples. Caps displace along their field normal.
- `renderer.js`: native WebGL, both shells, rolled rim, sound port,
  original studio reflections, picking, orbit and strike lighting.
  Fine normals are baked locally into a 16-bit normal atlas, independently
  of mesh density. Cap regions receive local mesh refinement; dragging keeps
  full detail and updates only the affected surface regions. Mobile uses a 768-pixel
  normal map per shell, desktop 1024. Pixel density is capped at 2, hidden
  faces are culled, and GPU drawing stops when idle.
- `audio.js`, `sample-player.mjs`, `samples.mjs`: recorded preview playback
  with bounded caching and a physical-model fallback. The repository's
  AudioWorklet supplies tuned modal synthesis, shell/cavity percussion,
  sympathetic resonance, stereo placement and convolution reverb.
- `playback.mjs`: physical chord voicings in each root register and ordered
  shell demo sequences.
- `arrangement.mjs`: scale-following additions, default slots, symmetric
  inner clusters, manual-placement recognition, and factory restoration.
- `shell-tap.mjs`: original finger-slap synthesis with filtered contact noise,
  a low pitched body, and a short fingertip transient. One small noise buffer
  is reused; voices are bounded and disconnect after playback.
- `app.js`: performance controls, editor, accessible dialogs, local collection,
  importing/exporting, sharing, keyboard, and multi-touch input.
- `fonts/`: self-hosted DM Sans, with its SIL Open Font License.

Tab hiding silences the instrument and suspends audio. The next playing
gesture resumes it. Browsers without WebGL retain the note buttons and audio.
The visual surface is procedural, not a scan of a manufactured instrument.
Real phone GPU, touch latency, and Safari behavior should be checked on the
target devices before production release.

## Validation

```sh
node tests/elaia.test.mjs
node tests/elaia-browser.test.cjs http://127.0.0.1:8080
node tests/elaia-samples-browser.test.cjs http://127.0.0.1:8080
node tests/elaia-arrangement-browser.test.cjs http://127.0.0.1:8080
```

The browser test requires Playwright. Set `PW` to an installed Playwright
package path if it is not available through Node's module resolution.
`SHOTS` selects a screenshot output directory.

The model test checks every preset, both shells, chord octaves, demo ordering,
tuned partials, automatic clusters, silent fields, manual-placement persistence, custom
ordering, placement restrictions, Unicode serialization, and malformed input.
The browser test uses real Chromium WebGL and AudioWorklet output, measures a
432 Hz note, and exercises editing, storage, links, importing/exporting,
touch chords, responsive layouts, exposed notes across both shells, and the
no-WebGL fallback. The sample test decodes a real Ayasa D3 MP3, verifies its
playback frequency, retuning and damping, and simulates a failed download.
It caches that one source recording in `/tmp`; `SAMPLE_FIXTURE` can point to
an existing copy for an offline run.
