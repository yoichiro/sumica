# Lightbox Info Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggle button to the lightbox that reveals a bottom overlay panel showing generation-parameter details (dimensions, model, seed, sampler, steps, CFG, hires, LoRA, refiner, VAE) without displaying prompt text.

**Architecture:** Pure client-side UI addition inside `client/src/App.tsx`. One new React state (`showLightboxInfo`), one derived value (`lightboxMeta`), one new toolbar button, one new bottom overlay panel. Panel is always mounted (visibility controlled by `transform` + `opacity` + `pointer-events`) so the slide-in/out transition fires reliably. Server, Firebase schema, CSS files, and CLAUDE.md are untouched.

**Tech Stack:** React 19, TypeScript, `lucide-react` icons, inline styles (existing pattern in this file).

## Global Constraints

- Modify `client/src/App.tsx` only — no other source file, no CSS, no server changes.
- Do not introduce keyboard shortcuts; toggle is button-only.
- Do not display any prompt (`originalPrompt` / `enhancedPrompt` / `negativePrompt`) or scheduler / timestamp / createdAt in the panel.
- Existing lightbox behaviors (Escape, ← / →, Space to select, F for favorite, background click to close, view-transition morph, OS fullscreen) must be unchanged.
- Existing top-toolbar buttons keep their current `right` offsets: close 20px, fullscreen 72px, next 124px, prev 176px, selection 228px, favorite 280px. The new Info button occupies `right: 332px` (leftmost of the row).
- Panel must survive OS fullscreen — no special code required because it lives inside `lightboxRef`.
- Comments in code stay in English. Commit messages are one-line English.
- **Commit gate:** each task ends with a commit step, but per project CLAUDE.md the executor MUST get explicit user approval before running the commit command. If the user prefers batching, defer commits and note the pending work.

---

## File Structure

**Modified file (only file touched):**
- `client/src/App.tsx` — Add `Info` icon import, add state and derived value, mutate `closeLightbox` to reset state, add Info toggle button JSX, add bottom overlay panel JSX.

No new files. No file splits.

---

## Task 1: State plumbing + Info toggle button

**Files:**
- Modify: `client/src/App.tsx:2` (lucide-react import list)
- Modify: `client/src/App.tsx:563-576` (`closeLightbox` — reset the new state on close)
- Modify: `client/src/App.tsx:620` (state block — add `showLightboxInfo`)
- Modify: `client/src/App.tsx:626` (below `lightboxIndex` — add `lightboxMeta` derived value)
- Modify: `client/src/App.tsx:2878` (inside the lightbox JSX — insert the Info button just before the existing selection-toggle block)

**Interfaces:**
- Consumes: existing `lightboxIndex: number`, `displayedHistory: GenerationRecord[]`, `morphSourceKey: string | null`, `currentGeneration: GenerationData | null` (all already in scope).
- Produces:
  - `showLightboxInfo: boolean` — state; drives the panel visibility in Task 2.
  - `setShowLightboxInfo(next: boolean): void` — setter; called by the Info button and by `closeLightbox`.
  - `lightboxMeta: GenerationData | GenerationRecord | null` — the metadata source object for whichever image the lightbox is showing (gallery item or preview-tab current generation); consumed by Task 2 when it renders the panel rows.

- [ ] **Step 1: Add `Info` to the lucide-react import**

Edit `client/src/App.tsx`. In the import block that ends at line 21 (`} from 'lucide-react';`), add `Info,` alongside the other imports. Alphabetical is not enforced in that block; append it in the group near `Layers, Star`.

Before:
```tsx
  LogIn,
  Layers,
  Star,
} from 'lucide-react';
```

After:
```tsx
  LogIn,
  Layers,
  Star,
  Info,
} from 'lucide-react';
```

- [ ] **Step 2: Add the `showLightboxInfo` state next to the other lightbox state**

Edit `client/src/App.tsx`. Directly after the existing `isFullscreen` state at line 620, insert:

```tsx
  // Bottom overlay panel of image detail info. Hidden by default each time
  // the lightbox opens; toggled by the Info button in the top toolbar; kept
  // across left/right navigation within the same open lightbox session.
  const [showLightboxInfo, setShowLightboxInfo] = useState(false);
```

The block should read:
```tsx
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [morphSourceKey, setMorphSourceKey] = useState<string | null>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Bottom overlay panel of image detail info. Hidden by default each time
  // the lightbox opens; toggled by the Info button in the top toolbar; kept
  // across left/right navigation within the same open lightbox session.
  const [showLightboxInfo, setShowLightboxInfo] = useState(false);
```

- [ ] **Step 3: Reset `showLightboxInfo` in `closeLightbox`**

Edit `client/src/App.tsx`. The `closeLightbox` function has two code paths (no-transition fallback and view-transition path). Add `setShowLightboxInfo(false)` in each.

Before (lines 563–576):
```tsx
  const closeLightbox = () => {
    if (document.fullscreenElement) { document.exitFullscreen(); } // leave OS fullscreen before closing
    const start = (document as DocumentWithViewTransition).startViewTransition;
    if (!start) {
      setLightboxUrl(null);
      setMorphSourceKey(null);
      return;
    }
    const transition = start.call(document, () => {
      flushSync(() => setLightboxUrl(null)); // new snapshot: source regains the name
    });
    transition.ready.catch(() => {}); // a skipped transition (e.g. rapid toggle) is harmless
    transition.finished.finally(() => setMorphSourceKey(null)); // cleanup temporary name
  };
```

After:
```tsx
  const closeLightbox = () => {
    if (document.fullscreenElement) { document.exitFullscreen(); } // leave OS fullscreen before closing
    setShowLightboxInfo(false); // next open always starts with info hidden
    const start = (document as DocumentWithViewTransition).startViewTransition;
    if (!start) {
      setLightboxUrl(null);
      setMorphSourceKey(null);
      return;
    }
    const transition = start.call(document, () => {
      flushSync(() => setLightboxUrl(null)); // new snapshot: source regains the name
    });
    transition.ready.catch(() => {}); // a skipped transition (e.g. rapid toggle) is harmless
    transition.finished.finally(() => setMorphSourceKey(null)); // cleanup temporary name
  };
```

- [ ] **Step 4: Add the `lightboxMeta` derived value directly after `lightboxIndex`**

Edit `client/src/App.tsx`. Right after the `lightboxIndex` declaration (which spans lines 624–626), add:

```tsx
  // Metadata source for whichever image the lightbox currently shows. Gallery
  // images resolve via displayedHistory[lightboxIndex]; the preview tab's
  // current image (lightboxIndex === -1 with morphSourceKey === '__preview__')
  // resolves via currentGeneration. Null in any other unexpected case, which
  // hides the Info button and panel defensively.
  const lightboxMeta = lightboxIndex >= 0
    ? displayedHistory[lightboxIndex]
    : (morphSourceKey === '__preview__' ? currentGeneration : null);
```

Resulting block:
```tsx
  // Index of the lightbox image within the displayed gallery order (-1 if not listed),
  // used to disable the prev/next buttons at the ends.
  const lightboxIndex = lightboxUrl
    ? displayedHistory.findIndex((it) => itemKey(it) === morphSourceKey || it.imageUrl === lightboxUrl)
    : -1;

  // Metadata source for whichever image the lightbox currently shows. Gallery
  // images resolve via displayedHistory[lightboxIndex]; the preview tab's
  // current image (lightboxIndex === -1 with morphSourceKey === '__preview__')
  // resolves via currentGeneration. Null in any other unexpected case, which
  // hides the Info button and panel defensively.
  const lightboxMeta = lightboxIndex >= 0
    ? displayedHistory[lightboxIndex]
    : (morphSourceKey === '__preview__' ? currentGeneration : null);
```

- [ ] **Step 5: Add the Info toggle button JSX inside the lightbox**

Edit `client/src/App.tsx`. Directly before the existing selection-toggle IIFE that starts at line 2878 (`{lightboxIndex >= 0 && (() => { const k = itemKey(...`), insert a new Info button block. The new button uses `right: 332px` and renders only when `lightboxMeta` exists.

Insert:
```tsx
          {lightboxMeta && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowLightboxInfo((v) => !v); }}
              title={showLightboxInfo ? '詳細情報を隠す' : '詳細情報を表示'}
              aria-pressed={showLightboxInfo}
              className="scale-hover"
              style={{
                position: 'absolute',
                top: '20px',
                right: '332px',
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                border: 'none',
                background: showLightboxInfo ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.15)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: showLightboxInfo ? '0 0 0 2px rgba(255, 255, 255, 0.35)' : 'none'
              }}
            >
              <Info size={22} />
            </button>
          )}
```

Place the new block between the `<img>` element and the existing selection-toggle IIFE — concretely, after line 2872 (the `/>` closing the `<img>` tag) and before line 2873 (the `/* Selection toggle: ... */` comment that precedes the selection button).

The resulting neighborhood:
```tsx
          <img
            src={lightboxUrl}
            alt="拡大表示"
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', height: '100%', objectFit: 'contain', viewTransitionName: 'lightbox-morph' }}
          />
          {lightboxMeta && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowLightboxInfo((v) => !v); }}
              title={showLightboxInfo ? '詳細情報を隠す' : '詳細情報を表示'}
              aria-pressed={showLightboxInfo}
              className="scale-hover"
              style={{
                position: 'absolute',
                top: '20px',
                right: '332px',
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                border: 'none',
                background: showLightboxInfo ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.15)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: showLightboxInfo ? '0 0 0 2px rgba(255, 255, 255, 0.35)' : 'none'
              }}
            >
              <Info size={22} />
            </button>
          )}
          {/* Selection toggle: only available when the lightbox shows a gallery item
```

- [ ] **Step 6: Type-check and lint**

Run:
```bash
npm run lint --prefix client
npm run build --prefix client
```

Expected: both commands succeed with no warnings or errors related to the new code. The `build` command runs `tsc -b && vite build`; any unused-import or type mismatch will fail here.

- [ ] **Step 7: Manual browser verification for Task 1**

Start the dev server (`npm run dev` in one terminal if not already running) and visit `http://localhost:5173/` in a browser. Verify:

1. Open any gallery image → lightbox opens → the leftmost button in the top-right row shows the Info (ⓘ) icon.
2. Click Info → background lightens to `rgba(255,255,255,0.28)` with a white ring shadow. Click again → returns to `rgba(255,255,255,0.15)`.
3. Open the current-generation image from the preview tab (`__preview__` case) → Info button still appears (thanks to `lightboxMeta` covering both cases).
4. Close and re-open the lightbox → button state resets to OFF (background back to `0.15`).
5. Existing behaviors still work: Escape closes, ← / → navigate, background click closes, Space toggles selection, F toggles favorite, Maximize / Minimize toggles OS fullscreen.

Note: at this task's end the button does not yet reveal any content — that arrives in Task 2. The visual toggle proves state wiring is correct.

- [ ] **Step 8: Commit**

```bash
git add client/src/App.tsx docs/superpowers/plans/2026-07-04-lightbox-info-panel.md docs/superpowers/specs/2026-07-04-lightbox-info-panel-design.md
git commit -m "feat: add lightbox Info toggle button and metadata source"
```

Note: this commit also brings the design and plan docs into git for the first time. If those files were already committed before starting Task 1, drop them from the `git add` line.

---

## Task 2: Bottom details panel

**Files:**
- Modify: `client/src/App.tsx:3035` — insert the panel JSX inside the lightbox root `<div>`, right before its closing `</div>` at line 3035.

**Interfaces:**
- Consumes: `showLightboxInfo`, `setShowLightboxInfo`, `lightboxMeta` from Task 1.
- Produces: no exports; this task only adds rendered JSX.

- [ ] **Step 1: Add the bottom overlay panel JSX**

Edit `client/src/App.tsx`. Add the panel as the last child of the lightbox root `<div>`, directly before its closing `</div>` at line 3035 (the closing of the block that opens at line 2852 with `<div ref={lightboxRef} ...>`).

The panel is rendered conditionally on `lightboxMeta` (so it never mounts for a lightbox with no metadata source), but its show/hide state uses `transform` + `opacity` so the CSS transition fires.

Insert:
```tsx
          {lightboxMeta && (() => {
            const m = lightboxMeta;
            const hasHr = m.enableHr === true;
            const hasLoras = Array.isArray(m.loras) && m.loras.length > 0;
            const hasRefiner = typeof m.refiner === 'string' && m.refiner.length > 0;
            const hasVae = typeof m.vae === 'string' && m.vae.length > 0 && m.vae !== 'Automatic';
            return (
              <div
                role="region"
                aria-label="画像の詳細情報"
                aria-hidden={!showLightboxInfo}
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  padding: '16px 24px',
                  background: 'rgba(0, 0, 0, 0.55)',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                  color: '#f1f3f5',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  maxHeight: '40vh',
                  overflowY: 'auto',
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px 20px',
                  fontSize: '13px',
                  lineHeight: 1.5,
                  transform: showLightboxInfo ? 'translateY(0)' : 'translateY(100%)',
                  opacity: showLightboxInfo ? 1 : 0,
                  pointerEvents: showLightboxInfo ? 'auto' : 'none',
                  transition: 'transform 0.2s ease, opacity 0.2s ease'
                }}
              >
                <span><span style={{ opacity: 0.7 }}>寸法:</span> <strong>{m.width}×{m.height}</strong></span>
                {m.model && <span><span style={{ opacity: 0.7 }}>モデル:</span> <strong>{m.model}</strong></span>}
                {m.seed !== undefined && <span><span style={{ opacity: 0.7 }}>Seed:</span> <strong style={{ fontFamily: 'monospace' }}>{m.seed}</strong></span>}
                {m.sampler && <span><span style={{ opacity: 0.7 }}>Sampler:</span> <strong>{m.sampler}</strong></span>}
                <span><span style={{ opacity: 0.7 }}>Steps:</span> <strong>{m.steps}</strong></span>
                <span><span style={{ opacity: 0.7 }}>CFG:</span> <strong>{m.cfgScale}</strong></span>
                {hasHr && (
                  <span>
                    <span style={{ opacity: 0.7 }}>ハイレス:</span>{' '}
                    <strong>ON ({(m.hrScale ?? 2).toFixed(1)}×{m.hrUpscaler ? `, ${m.hrUpscaler}` : ''})</strong>
                  </span>
                )}
                {hasLoras && (
                  <span>
                    <span style={{ opacity: 0.7 }}>LoRA:</span>{' '}
                    <strong>{m.loras!.map((l) => `${l.name} (${l.weight})`).join(', ')}</strong>
                  </span>
                )}
                {hasRefiner && (
                  <span>
                    <span style={{ opacity: 0.7 }}>Refiner:</span>{' '}
                    <strong>{m.refiner} (switch @ {(m.refinerSwitchAt ?? 0.8).toFixed(2)})</strong>
                  </span>
                )}
                {hasVae && <span><span style={{ opacity: 0.7 }}>VAE:</span> <strong>{m.vae}</strong></span>}
              </div>
            );
          })()}
```

Placement: this block goes directly before the closing `</div>` of the lightbox root at line 3035. Concretely, after the close-button JSX (`<X size={22} /></button>` at line 3033–3034):

```tsx
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
            title="閉じる (Esc)"
            className="scale-hover"
            style={{ /* ... */ }}
          >
            <X size={22} />
          </button>
          {lightboxMeta && (() => {
            /* ... panel from above ... */
          })()}
        </div>
      )}
```

- [ ] **Step 2: Type-check and lint**

Run:
```bash
npm run lint --prefix client
npm run build --prefix client
```

Expected: both commands succeed with no warnings or errors. Type errors most likely to surface here are around the non-null assertion on `m.loras!` — this is safe because `hasLoras` guarantees non-empty array. If `oxlint` flags the `!`, replace `m.loras!` with `m.loras || []` (same runtime behavior since we've already checked).

- [ ] **Step 3: Manual browser verification for Task 2**

Reload `http://localhost:5173/` (dev server auto-HMRs but a hard reload is safest). Verify each item from the design spec's "Manual testing" section:

**Basic flow**
1. Open a gallery image → Info button OFF, no panel visible.
2. Click Info → panel slides up from the bottom with a 0.2s ease transition, background is blurred, at least 寸法 / Steps / CFG rows are visible (always-rendered fields).
3. Click Info again → panel slides back down and vanishes.
4. With panel visible, press ← / → → the panel content updates to the new image's params, panel stays visible.
5. Close (Esc or background click) then open a different image → panel is hidden (state reset in `closeLightbox`).

**Conditional fields**
6. A LoRA-using image shows a LoRA row like `LoRA: myLora (0.8)`. A non-LoRA image omits the row.
7. A Hires.fix-enabled image shows a row like `ハイレス: ON (2.0×, R-ESRGAN 4x+)`. A non-HR image omits it.
8. An SDXL image with a Refiner shows a row like `Refiner: sd_xl_refiner_1.0 (switch @ 0.80)`. Non-refiner images omit it.
9. An image with a non-Automatic VAE shows a `VAE: <name>` row. An Automatic-VAE (or unset) image omits it.
10. A very old image lacking `seed` / `sampler` / `model` cleanly omits those individual rows and shows the rest.

**Preview tab and fullscreen**
11. Open the current-generation image from the preview tab → Info button + panel work the same way, reading from `currentGeneration`.
12. Enter OS fullscreen via the Maximize button → Info button and panel remain functional (the panel is inside `lightboxRef`, which is the fullscreen element).
13. In fullscreen, toggle Info → panel appears/disappears with the same transition.
14. Exit fullscreen (Minimize or Esc) → lightbox still behaves normally.

**Interaction and layout**
15. Click on the panel body itself → the lightbox does NOT close (panel's `onClick` stopPropagation).
16. Click on the transparent area where the panel would be (Info OFF) → lightbox DOES close (thanks to `pointer-events: none` on the hidden panel).
17. Resize the window to ~600px wide → the row of fields wraps via `flex-wrap: wrap`; no horizontal overflow.
18. On an image with lots of LoRAs / all optional fields set → panel scrolls internally past `40vh`; page under lightbox does not scroll.

**Cross-host**
19. From a Windows Chrome pointed at `http://<wsl-host>:5173/`, all of the above still work (basic sanity, since the change is client-only).

- [ ] **Step 4: Commit**

```bash
git add client/src/App.tsx
git commit -m "feat: add lightbox bottom detail info panel"
```

---

## Post-implementation

No follow-up tasks. `CLAUDE.md` does not require an update: the new state / button / panel are visible in the code and consistent with the "Lightbox" description already present. No ADR is warranted — this is a UI-only feature with no cross-cutting architectural implication.

If a code review turns up nits (e.g., extracting the panel into a small subcomponent within `App.tsx`), address them inline; do not proactively refactor.
