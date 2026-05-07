## What I verified

I opened `/paper-set/new` in a clean automated browser and clicked "Pick subject" — the menu opened and showed Humanities / Sciences. Same for Level and Syllabus document. So the current code works; what you are seeing is the **old broken bundle still cached in your browser** from when the page used Radix `Select` (which the `bb-customSelect` extension hijacks).

## Fix

### 1. Bust the cached bundle for everyone
- Bump the route component so the client chunk gets a new hash and old service-worker / disk caches are invalidated:
  - Add a no-op version constant in `src/routes/paper-set.new.tsx` (e.g. `const BUILD = "ps-new-v3";`) and reference it once in the JSX as a hidden `data-build` attribute on the root `<div>`. This guarantees the chunk filename changes.
- Add `<meta http-equiv="Cache-Control" content="no-cache" />` to `src/routes/__root.tsx` head so the preview shell stops serving stale HTML on this domain.

### 2. Harden `PlainSelect` so no extension can ever break it
File: `src/components/PlainSelect.tsx`
- Render the menu in a `createPortal` to `document.body` with absolute positioning anchored to the trigger (measured via `getBoundingClientRect`). This removes any chance a parent stacking-context / overflow hides it.
- Add `data-lov-plain-select` and `data-no-bb` attributes (the BetterBrowse extension skips elements with `data-no-bb`).
- Use `onPointerDown` instead of `onMouseDown` for the outside-click handler so it works under touch + the click-outside doesn't race with the button's click.
- Close on `scroll` and `resize` to keep the menu glued to the trigger.

### 3. Quick user-side step
After I redeploy, do a one-time hard refresh in the preview pane:
- Mac: ⌘ + Shift + R
- Windows / Linux: Ctrl + Shift + R
Or open the preview URL in an incognito window. After this the new bundle will load and the dropdowns will work even with extensions enabled.

## Files touched
- `src/components/PlainSelect.tsx` — portal + hardening
- `src/routes/paper-set.new.tsx` — version bump constant
- `src/routes/__root.tsx` — no-cache meta

No database, no new dependencies.
