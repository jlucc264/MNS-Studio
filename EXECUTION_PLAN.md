# MNS Studio Execution Plan

This turns the product roadmap into a concrete working sequence.

## How To Use This Document

- `Now` = what we should actively work through next
- `Next` = the batch right after that
- `Later` = important, but not worth interrupting the current base-product push

## Now

### 1. Stabilize The Core Workflow
Goal: make the base app feel dependable in everyday use.

Definition of done:
- changing settings does not unexpectedly blank or reset the preview
- color-count changes feel predictable
- edits survive safe regenerations
- preview and export stay aligned

Work:
- audit regeneration/state-reset bugs
- tighten color-count behavior and palette-state handling
- keep edit persistence solid for same-geometry changes
- test the upload -> generate -> edit -> finalize path end to end

### 2. Improve Stitched-Photo Output
Goal: make stitched-photo mode worth trusting for real cleanup work.

Definition of done:
- background/canvas colors stop wasting too much palette budget
- text reads more cleanly
- distinct colors appear earlier
- redundant shading gets reduced

Work:
- keep tuning stitched-photo background suppression
- improve text preservation without dulling the whole palette too much
- keep improving distinct-color and neutral-shade handling
- compare against a small set of reference images instead of tuning blind
- use [STITCHED_BENCHMARKS.md](/Users/johnlucciola/MNS/STITCHED_BENCHMARKS.md) as the stitched-photo regression set

### 3. Clarify Source Modes
Goal: make it obvious when to use each path.

Definition of done:
- users understand `Photo` vs `Stitched photo`
- the app gives better cues about which mode is appropriate
- text/sign/logo cases have a clearer story

Work:
- add lightweight explanatory copy in the UI
- decide whether graphic/text-art handling belongs in `v1.1`
- collect examples that break the current two-mode split

## Next

### 4. Add Preprocessing Controls
Goal: give users a little more control before preview generation.

Definition of done:
- users can clean up common problem inputs before conversion
- controls are simple and understandable
- preprocessing helps without overwhelming the workflow

Likely controls:
- Clean background
- Sharpen text
- Simplify shades
- Preserve dark details

### 5. Strengthen The Non-LLM Assistant
Goal: make the built-in chat useful even without AI.

Definition of done:
- editing commands are more robust
- upload/import guidance is clearer
- chat can guide users through common workflows
- the free/base product has a strong assistant layer without inference costs

Deliverables:
- stronger command parsing for deterministic editing actions
- stronger import-by-URL and upload guidance
- guide/help responses for common tasks and mode choices
- clearer boundaries between deterministic assistant behavior and future Pro AI behavior

### 6. Build The User Guide
Goal: make the product easier to learn and easier to trust.

Definition of done:
- there is a lightweight guide for the core workflow
- users can understand when to use `Photo` vs `Stitched photo`
- cleanup/edit tools are documented in plain language

Likely sections:
- getting started
- source modes
- cleaning up a preview
- export/finalize
- common troubleshooting

### 7. Improve Final Output Delivery
Goal: make finishing a project feel more complete and professional.

Definition of done:
- finalized outputs are easy to locate and trust
- PDF delivery flow is clear
- the user gets a finished summary, not just a file

Deliverables:
- finalized report
- preview image in the report
- colors used
- stitch count per color
- email delivery flow to the dedicated inbox/workflow

## Later

### 7. Save / Reload Project State
Goal: support longer sessions and repeat work.

### 8. UI Refresh
Goal: make the product feel less like a raw internal tool and more like a polished site.

Focus:
- layout cleanup
- stronger visual hierarchy
- warmer product feel
- responsive behavior

### 9. Basic Analytics And Logging
Goal: know where the app breaks and what users struggle with.

### 10. AI Readiness
Goal: prepare the app so Pro features can be layered on cleanly later.

Focus:
- structured action model
- chat/UI separation
- auth and billing foundation
- premium feature boundaries

## Suggested Working Order

### Sprint A
- stabilize regeneration/state behavior
- tighten color-count behavior
- validate preview/export trust

### Sprint B
- improve stitched-photo distinct-color behavior
- improve stitched-photo text readability
- clarify source-mode guidance

### Sprint C
- preprocessing controls
- strengthen the non-LLM assistant
- user guide
- finalized report/output experience

### Sprint D
- save/load
- UI refresh
- analytics

## Success Markers

We are in a strong base-product place when:
- a user can finish a full project without AI help
- import/generate/edit/finalize feels stable
- the output is trusted
- the app teaches the workflow instead of requiring live explanation
- remaining requests are about speed and intelligence, not correctness
