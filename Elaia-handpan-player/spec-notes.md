# Elaia specification decisions

Implemented from **appunti handpan player virtuale elaia.odt** and
**dimensioni note x virtual handpan player elaia.odt**, supplied 12 November 2026.

## Note dimensions and limits

The table in `tonefields.mjs` uses millimetres, with minor × major axes for
both tonefields and dimples. Dimensions are normalized to the actual selected
shell diameter. Newly added fields, including replacements in vacant preset
slots, and individually retuned fields use these dimensions. Existing oval
Ayasa factory fields retain their measured geometry.

Assigned pitches range from F2 through E6, excluding B♭4. Bottom notes start
at G♯2, inclusive. Additions, note selectors, scale suggestions, pitch
steppers, transposition, imports, and shared layouts enforce these limits.
Unassigned fields remain supported.

The prose specifies circular pure tones **above E5**, so E5 uses the
60 × 90 tonefield and 25 × 30 dimple row. F5–G5 use 70 × 70 / 25 × 25.
All factory fields above E5 also become circular pure fields. Their measured
recording references remain attached.

Two supplied rows are missing; the user authorized reusing existing Ayasa
data until Elaia provides the measurements:

| Pitch | Provisional tonefield | Provisional dimple | Existing source |
| --- | --- | --- | --- |
| C3 | approximately 164.5 × 184 mm | 80 × 97.6 mm | C Ashakiran 17, top C3 |
| G♯5 | approximately 69.6 × 69.6 mm | 20 × 20 mm | B3 Pygmy 20, top G♯5 |

The fallback uses the existing geometry records directly, rather than
duplicating their measurements in a second table. The inspector labels these
two rows as provisional. G♯5 is circularized using the measured major diameter.
“B♯5” in the supplied list is enharmonic C6 and does not introduce another
selectable pitch.

Horizontal/vertical insertion refers to the rim: G♯2–B♭3 fields have
tangential major axes; B3–E5 fields have radial major axes. Boundary pitches
are included. During dragging, an ellipse's axis snaps to the nearest
parallel/perpendicular orientation and follows the rim as its centre moves.

Real dimensions are never reduced to force an addition into an occupied
area. An addition or pitch change requiring more room is rejected without
changing the document. The rim, neighbouring fields, and bottom sound port
remain protected.

Whole-instrument transpose retains existing physical geometry, with circular
pure geometry applied when an oval field crosses above E5. The earlier oval
geometry is kept in the document and restored on crossing back. Arrows skip
keys containing B♭4 or unsupported pitches; they may advance multiple semitones.
Undo restores the complete previous document.

## Playing positions and mutant placement

The reference behavior was verified against Mudra's publicly served
[player markup](https://player.mudrahandpan.com/) and
[position-switch code](https://player.mudrahandpan.com/js/app.js).
The `handpan-custom-9` and `handpan-custom-9-pos2` diagrams place one note
in front of the player versus a front pair, respectively. The ding and inner
mutants retain their orientation toward the player; this is not a 90°/180°
rotation of the whole layout.

Elaia adapts that convention to its measured presets by turning the outer
ring and underside by half the interval between the first two outer fields.
The ding and inner group remain facing the player. If the shifted outer ring
requires it, an automatic inner cluster is repositioned at its original full
size. Manual layouts that cannot fit the alternate position receive an
explanation. Position is undoable and included in storage, JSON, and links.

The existing one-to-five symmetric mutant insertion pattern remains in use.
The user requested to inspect its current appearance before deciding on a
replacement pattern. Real screenshots of all five original arrangements were
captured before changing their geometry.

## View and playback

Top, Bottom, and their Listen sequences use exact zenith views. The camera
basis remains defined at both poles. Orbit remains available.

The bottom-visibility requirement is met within the 3D view: the eye toggle
projects the actual underside outlines and note names through the upper
shell. The overlay follows camera rotation, zoom, and field edits, and hides
when viewing from below. A separate 2D player is therefore unnecessary for
this visibility requirement.

One chord button plays every physical matching field in ascending pitch
order, including equal-pitch fields on different shells. There are no octave
submenus. The sequence uses 180 ms spacing. The repeated D4 in the supplied
example is treated as a transcription error: fields are played once each;
the later octave is D5 on the D Kurd 19 preset.

Customize is an on/off toggle. Transpose is accessible beside the instrument
in both modes. Shell-transfer and field-size controls are removed.

## Pending Elaia input

- Final C3 and G♯5 tonefield/dimple dimensions.
- Confirmation of the chosen E5 boundary and the “B♯5” table entry.
- Feedback on the existing mutant pattern shown to the user.
