# MNS Studio Roadmap

This roadmap is meant to keep the base product focused and strong before we layer on any paid AI features.

## Product Split

### Base
- Upload an image or source artwork
- Import an image by URL when needed
- Generate a stitch preview
- Adjust size, mesh, colors, and source mode
- Clean up the preview with palette, paint, selection, and merge tools
- Save and reopen drafts once accounts exist
- Use a robust non-LLM chat assistant for editing commands, import guidance, and workflow help
- Finalize and export a trustworthy PDF

### Pro
- Generate source images from prompts
- Use natural-language editing and semantic commands
- Get AI suggestions for cleanup, palette consolidation, and region edits
- Use inference to speed up repetitive editing workflows
- Offer paid plan features through a third-party payment platform instead of custom billing infrastructure

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
- **Undo/redo refactor** — current implementation snapshots the entire cells grid on every change (expensive for large canvases); refactor to delta-based snapshots (store only changed cells + previous values) using a `useRef` stack instead of React state, making operations instant and memory-efficient
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
- Tune against a fixed stitched-photo benchmark set instead of isolated one-off examples

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
- Save and reload project state as drafts
- Let logged-in users access their saved drafts across sessions/devices
- Decide whether anonymous local drafts are useful before full account support
- Preserve more edit history across non-destructive regenerations
- Make long sessions safer and easier to resume

### 5. Preview Quality & Speed
- **Stitch render improvement** — replace solid-color squares in the grid preview with a per-cell basketweave or diagonal texture that looks like actual needlepoint; purely a GridEditor rendering change, no backend needed
- **Bold/tapestry source mode** — new deterministic pipeline: bilateral filter (flatten areas, preserve edges) + edge boosting + aggressive quantization to 6–10 colors; maps to a new `tapestry` source type alongside the existing Photo/Graphic/Stitched options
- Show previous preview immediately while a new one generates — never flash a blank/loading state
- Debounce settings changes so rapid adjustments don't fire redundant backend requests
- Client-side input hashing to skip requests when nothing meaningful changed

### 6. Production Polish
- Stronger error handling
- Better loading and empty states
- Clearer export feedback
- Basic analytics and failure logging

### 6. Better Non-LLM Assistant
- Improve the non-LLM chat so it can reliably support the base product
- Make upload/import guidance clearer and more helpful
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
- **Skein estimator** — stitch counts per color already exist; add the formula to convert to DMC skeins needed (capability already in place, just needs the calculation and PDF display)
- **Symbol legend** — assign a unique printable symbol per color for black-and-white legibility and accessibility; add to the PDF palette table
- **Center mark + inch tick marks** — add a center crosshair and inch-interval tick marks to the true-size canvas page; more intuitive for needlepointers who work outward from center than alphanumeric grid coordinates
- **Center crosshair alignment** — the current crosshair in the stitch preview (and future PDF center mark) uses `cols / 2` which lands on a mesh hole for even stitch counts and a mesh intersection for odd counts; fix is `Math.floor(cols / 2) + 0.5` to always snap to a cell center (mesh intersection); also consider guiding users toward odd stitch counts for symmetric designs, and carry the same logic into the PDF center mark when built

### 9. UI Refresh
- Make the site feel less like a raw tool and more like a destination/product
- Clean up the visual design, spacing, and hierarchy
- Carry formatting and visual-system improvements through the app consistently
- Improve responsiveness for smaller screens
- Decide what “mobile friendly” means:
  - full editing on tablet/desktop
  - lighter review/edit flow on phone if needed
- **Source type as prominent first choice** — surface source type (Photo / Graphic / Tapestry) as a large labeled selection immediately after import, before the user hits generate; this is the highest-impact setting and should feel like choosing a preset, not adjusting a control
- **Color substitution UI** — `nearest_dmc()` already runs in the backend; expose it in PalettePanel as a visual picker: click any color → see a grid of nearest DMC neighbor swatches sorted by similarity → tap to swap. No backend work needed, purely a UI surface.
- **Progressive disclosure** — show source type, size, and color count up front; move contrast fine-tuning and advanced toggles (simplify colors, strengthen dark detail, preserve accents) into a collapsible “Fine tune” section to reduce first-load overwhelm without hiding anything

### 10. Website Shell
- Add a real home/about page outside the editor experience
- Explain what MNS Studio is, who it is for, and how the workflow works
- Keep the editor as the primary product surface, but give new users a clearer entry point
- Make room for future pricing, Pro, examples, and support content

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
- Add login/accounts, primarily to support saved drafts and future Pro access
- Choose an established payment platform instead of building payments from scratch
- Free vs Pro gating
- Usage tracking
- Cost control and logging for premium operations
- Account-level access to saved drafts, exports, and paid features

### 4. AI-Safe Backend Surface
- Dedicated AI endpoints
- Clear rate limits
- Audit/logging around expensive or destructive operations

## Creator Marketplace & Revenue Sharing

The template marketplace is a structural advantage over competitors like Stitchly, which are tools with no marketplace layer. The core flywheel:

- Designers publish finished patterns as purchasable templates
- Buyers get a ready-to-stitch canvas — not just a PDF they still have to act on
- Creators earn a revenue share on every sale, which incentivizes more publishing
- Each published template becomes a storefront that drives new buyer acquisition
- Buyers who connect with a designer's style return for future templates

This is durable because the template is tied to a physical canvas. A buyer isn't comparing it to a free PDF — they're comparing it to sourcing canvas, painting a grid, and doing the color matching themselves. That moat is hard for Etsy sellers or Stitchly users to replicate.

### Creator Experience (Future)
- **Creator profile full nav** — `/gallery/[slug]` currently has a minimal nav (← Gallery + Open Studio only); bring it in line with the full site nav (logo, Gallery | Your Studio | Active Canvas links, account controls)
- Earnings dashboard — transparent view of sales, revenue, and payout history
- Featured creator spots — surface top designers to drive discovery
- Tiered commission rates — reward high-volume or high-quality creators
- Template analytics — help creators understand which designs perform and why
- Creator profiles — public-facing pages that build designer identity within the platform

### Pricing Context
At $15/design, MNS is roughly the cost of 3 Stitchly uses — but includes a physical canvas delivered ready to stitch. For repeat buyers who find designers they trust, the template marketplace turns one-time transactions into recurring business for both the creator and the platform.

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

### 5. Pro Plan Packaging
- Decide what belongs in Pro vs the free/base product
- Gate expensive AI features behind paid access
- Keep base drafting/export useful enough that Pro feels optional but valuable

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
- Stronger non-LLM chat assistant
- User guide
- Better finalized report/output flow
- UI refresh pass
- Home/about page

### Pro Beta
- Auth and plan gating
- Saved drafts tied to accounts
- Payment-platform integration
- Natural-language command layer
- AI recommendations
- Limited prompt-to-image generation

## Immediate Priorities

1. Stabilize any remaining state-reset and regeneration bugs
2. Improve stitched-photo and text-heavy import quality
3. Make color-count behavior more intuitive
4. Add preprocessing controls before preview generation
5. Strengthen project continuity and trust in long edit sessions
6. Build a stronger non-LLM chat assistant
7. Build a user guide and clearer help surfaces
8. Improve finalized output delivery and reporting
9. Refresh the UI so the site feels more welcoming and polished
10. Plan login, saved drafts, Pro packaging, and payment-platform integration
11. Add a home/about page for new visitors

## Ready-For-Pro Checklist

We should feel good about starting the Pro layer when:
- A user can complete a full project without AI
- Export is trusted
- Edit history is stable
- Draft saving/reopening has a clear account-backed path
- Source modes are understandable
- The payment-platform choice is made
- The remaining value gap is convenience and intelligence, not correctness
