# Stitched-Photo Benchmark Set

This file defines the stitched-photo reference set for `Sprint B`.

The goal is to stop tuning stitched-photo mode image by image and instead evaluate every major change against the same fixed examples.

## How To Use This Set

For any meaningful stitched-photo change:

1. Run the same general settings range against each benchmark.
2. Compare before/after behavior on:
   - text readability
   - border preservation
   - distinct-color emergence
   - background/canvas suppression
   - redundant-shade reduction
3. Do not accept a change that clearly improves one example while regressing multiple others.

## Success Criteria Across The Set

- Bright canvas/background should not consume unnecessary color budget.
- Real design colors should appear before filler tan/gray shades.
- Text should read cleanly at practical sizes.
- Borders should survive without requiring immediate manual rescue.
- Small accent colors should appear earlier when they are structurally important.
- Stitched-photo mode should stay closer to real thread families than to photo-style shading.

## Benchmark 1: Green Horseshoe

Primary concern:
- distinct-color preservation inside one dominant family

Original stitched size:
- `5" x 5"` on `18 mesh`
- approximately `90 x 90` stitches

What this image tests:
- dark green outline vs lighter green motifs
- whether white background stays out of the palette
- whether one dominant green family collapses into noise or stays organized

Target behavior:
- preserve the dark outline as its own readable family
- preserve lighter motif details without inventing extra green shades
- background should stay effectively white

Regression signs:
- multiple muddy greens appear before motif details
- white background starts spending palette budget
- horseshoe edge loses structure

## Benchmark 2: "kisses if you do the dishes"

Primary concern:
- stitched text readability plus border separation

Original stitched size:
- `9" x 5"` on `13 mesh`
- approximately `117 x 65` stitches

What this image tests:
- green text should consolidate cleanly
- pale blue border should survive
- canvas should not compete with text/border colors

Target behavior:
- text should read as one main green family, not several fake shades
- pale blue border should remain distinct from white background and green text
- canvas should not introduce extra beige/gray colors

Regression signs:
- multiple close greens survive in the lettering
- pale blue border disappears into white
- text breaks or becomes patchy

## Benchmark 3: Purple Boot

Primary concern:
- accent emergence inside a dominant fill color

Original stitched size:
- `6.5" x 5.25"` on `13 mesh`
- approximately `85 x 68` stitches

What this image tests:
- lavender body vs darker purple outline
- yellow and pink accents
- whether accent colors appear before redundant lavender variants

Target behavior:
- outer structure remains readable
- dominant purples stay simplified
- yellow/pink accents appear earlier than low-value filler shades

Regression signs:
- several similar lavenders survive before yellow or pink
- outline and fill collapse together
- accents disappear unless color count gets too high

## Benchmark 4: Astronaut

Primary concern:
- low-color graphic recovery from a stitched-looking screenshot

Original stitched size:
- `4.5" x 5.5"` on `18 mesh`
- approximately `81 x 99` stitches

What this image tests:
- near-3-color behavior
- white background suppression
- red outline preservation
- gray fill preservation without extra shades

Target behavior:
- result should stay very close to the real low-color source
- red should unify strongly
- gray should not split into several fake shades
- background should not create extra colors

Regression signs:
- palette rises well beyond the true design colors
- red splits across multiple close shades
- bottom/background noise introduces colors that are not actually in the design

## Benchmark 5: "THE BAR IS ALWAYS OPEN"

Primary concern:
- high-contrast stitched sign readability

Original stitched size:
- `8" x 2.5"` on `13 mesh`
- approximately `104 x 33` stitches

What this image tests:
- white text on dark green
- clean border structure
- block-letter legibility

Target behavior:
- text should stay crisp and readable
- white should remain clean
- dark green field should not fragment into multiple shades
- border geometry should hold together

Regression signs:
- white lettering breaks apart
- dark green field gains extra shades
- border corners lose their shape

## Evaluation Notes

Each benchmark should be reviewed at a few practical settings, especially:
- modest color counts
- both 13 mesh and 18 mesh when relevant
- `Clean background` on/off when applicable

Important:
- not every image needs the same “best” setting
- the benchmark is about the quality of the mode and the defaults, not forcing one setting to win every case

## Current Sprint B Focus

1. Better canvas/background suppression.
2. Better stitched text readability.
3. Better distinct-color emergence.
4. Less redundant neutral or same-family shading.

## Future Extension

Later, if local source files are added to the repo, this benchmark can become a reproducible comparison workflow with:
- fixed input files
- fixed setting presets
- saved output snapshots
- a lightweight manual scoring rubric
