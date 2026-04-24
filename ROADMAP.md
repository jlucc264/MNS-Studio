# MNS Studio Roadmap

This roadmap is meant to keep the base product focused and strong before we layer on any paid AI features.

## Product Split

### Base
- Upload an image or source artwork
- Generate a stitch preview
- Adjust size, mesh, colors, and source mode
- Clean up the preview with palette, paint, selection, and merge tools
- Use a robust non-LLM chat assistant for search, editing commands, and guidance
- Finalize and export a trustworthy PDF

### Pro
- Generate source images from prompts
- Use natural-language editing and semantic commands
- Get AI suggestions for cleanup, palette consolidation, and region edits
- Use inference to speed up repetitive editing workflows

## Guiding Principle

The base product should be complete enough that a user can finish a project without AI. Pro should feel like acceleration and intelligence, not like a rescue layer for a weak core workflow.

## Current State

### Working Well
- Deployed web app on Vercel + Render
- Core upload -> generate -> edit -> finalize workflow exists
- Canvas-based preview is in place
- Palette editing, subsection replacement, merge flows, and eyedropper exist
- Source modes for `Photo` and `Stitched photo` exist
- Export flow is live and PDFs are being saved

### Still Fragile
- Import quality is still inconsistent for stitched-photo and text-heavy sources
- Some state transitions around regeneration and settings changes are still easy to break
- Color-count behavior is still not intuitive enough
- Mobile is not a target experience yet
- The stitched-photo pipeline still needs more predictable distinct-color behavior

## Phase 1: Must-Fix Before Pro

### 1. Import Reliability
- Make upload, URL import, and live generation consistently stable
- Eliminate remaining disappearing-preview and reset bugs
- Make source-mode switching fully predictable

### 2. Preview Trust
- Make `Photo` and `Stitched photo` behavior easier to understand
- Make color-count changes feel intuitive and visually consistent
- Preserve edits through safe regenerations whenever geometry does not change
- Keep preview/export parity tight

### 3. Editing Reliability
- Keep paint, highlight, subsection replace, and merge flows fast
- Make undo/redo dependable in every major edit path
- Keep palette behavior aligned with what is actually on the canvas

### 4. Output Reliability
- Finalized PDF should feel boring and dependable
- Margin/buffer behavior should match preview expectations
- Saved output should be easy to trust and easy to locate

### 5. UX Clarity
- Keep the main workflow obvious:
  - import
  - generate
  - clean up
  - finalize
- Reduce any controls that feel ambiguous or overloaded
- Start a user guide so the product is easier to learn without hand-holding
- Make the non-LLM chat feel reliable enough to act as a built-in guide and command surface

## Phase 2: Strengthen The Base Product

### 1. Better Stitched-Photo Handling
- Improve canvas/background suppression
- Preserve text and distinct thread colors better
- Reduce redundant neutral shading
- Improve distinct-color selection for stitched sources

### 2. Better Graphic/Text Art Handling
- Add a dedicated mode or heuristic path for signs, logos, vector-like art, and black-on-white typography
- Prioritize stroke continuity and text readability over photo fidelity

### 3. Preprocessing Controls
- Add lightweight image cleanup before preview generation
- Possible controls:
  - Clean background
  - Sharpen text
  - Simplify shades
  - Preserve dark details

### 4. Project Continuity
- Save and reload project state
- Preserve more edit history across non-destructive regenerations
- Make long sessions safer and easier to resume

### 5. Production Polish
- Stronger error handling
- Better loading and empty states
- Clearer export feedback
- Basic analytics and failure logging

### 6. Better Non-LLM Assistant
- Improve the non-LLM chat so it can reliably support the base product
- Upgrade image/photo search quality and relevance
- Make command handling more robust for editing and cleanup actions
- Let the chat double as a lightweight guide/assistant for common tasks

### 7. User Education
- Build a lightweight user guide for the core workflow
- Document when to use `Photo` vs `Stitched photo`
- Document cleanup/editing tools so users can recover from imperfect imports faster

### 8. Output Experience
- Email finalized PDFs to the dedicated delivery inbox/workflow
- Build a finalized report for the user that includes:
  - preview image
  - colors used
  - stitch count per color
  - a cleaner summary of the finished piece

### 9. UI Refresh
- Make the site feel less like a raw tool and more like a destination/product
- Clean up the visual design, spacing, and hierarchy
- Improve responsiveness for smaller screens
- Decide what “mobile friendly” means:
  - full editing on tablet/desktop
  - lighter review/edit flow on phone if needed

## Phase 3: AI Readiness

This phase should happen only after the base workflow feels trustworthy.

### 1. Structured Action Layer
- Represent major operations as clean app actions:
  - import image
  - change settings
  - generate preview
  - toggle colors
  - merge colors
  - replace selection
  - recolor region
  - finalize export

### 2. Chat/UI Separation
- Keep chat as an interface layer
- Keep deterministic product logic underneath
- Do not let text parsing become the source of truth

### 3. Auth + Billing Foundations
- Accounts
- Free vs Pro gating
- Usage tracking
- Cost control and logging for premium operations

### 4. AI-Safe Backend Surface
- Dedicated AI endpoints
- Clear rate limits
- Audit/logging around expensive or destructive operations

## Phase 4: First Pro Features

### 1. Natural-Language Editing
- Interpret commands like:
  - make the border sage green
  - clean up the lettering
  - merge the duplicate greens

### 2. AI Image Generation
- Prompt -> generated source image -> stitch pipeline

### 3. AI Recommendations
- Suggest merges
- Suggest source modes
- Suggest cleanup actions when a preview looks noisy or over-shaded

### 4. Semantic Region Edits
- Border/text/background/motif targeting
- Region-aware commands without forcing the user to paint everything manually

## Suggested Versioning

### v1.0
- Reliable base workflow
- Stable preview generation
- Strong edit and export trust

### v1.1
- Better stitched-photo results
- Better text and graphic-art import handling
- More predictable color behavior

### v1.2
- Preprocessing controls
- Save/load project state
- Better polish and analytics
- Stronger non-LLM chat/search assistant
- User guide
- Better finalized report/output flow
- UI refresh pass

### Pro Beta
- Auth and plan gating
- Natural-language command layer
- AI recommendations
- Limited prompt-to-image generation

## Immediate Priorities

1. Stabilize any remaining state-reset and regeneration bugs
2. Improve stitched-photo and text-heavy import quality
3. Make color-count behavior more intuitive
4. Add preprocessing controls before preview generation
5. Strengthen project continuity and trust in long edit sessions
6. Build a stronger non-LLM chat/search assistant
7. Build a user guide and clearer help surfaces
8. Improve finalized output delivery and reporting
9. Refresh the UI so the site feels more welcoming and polished

## Ready-For-Pro Checklist

We should feel good about starting the Pro layer when:
- A user can complete a full project without AI
- Export is trusted
- Edit history is stable
- Source modes are understandable
- The remaining value gap is convenience and intelligence, not correctness
