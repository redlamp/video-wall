# Video Wall Improvement Plan

## Current Baseline

- Branch: `master`
- Deploy target: GitHub Pages at `https://redlamp.github.io/video-wall/`
- Package manager: npm
- Required checks before commits that touch app code:
  - `npm.cmd run lint`
  - `npm.cmd run build`
  - `npm.cmd run smoke` for interaction-sensitive changes when local browsers and `ffmpeg` are available
- Local dev server:
  - `http://127.0.0.1:3014/`

## Recovery Notes

This document is intended to make work recoverable if an implementation session stops because of usage limits or interruption.

Before resuming:

1. Run `git status --short`.
2. Read the most recent commits with `git log --oneline -8`.
3. Check this file for the next incomplete topic.
4. Run lint/build before committing app-code topics.
5. Commit each completed topic separately.

Avoid mixing broad refactors with behavior changes. If a topic grows beyond one focused commit, split it.

## Topic Queue

### 1. Visible Status And Media Errors - Completed

Goal: make app messages visible and make failed/unsupported media obvious.

Planned changes:

- Render current status/error text in a small unobtrusive surface near the bottom control panel or catalog.
- Add clear feedback for duplicate files, unsupported files, blocked autoplay, catalog clears, and failed video loads.
- Replace silent `video.onError` behavior with catalog/tile error state.

Validation:

- Add a non-video file and confirm a visible status appears.
- Trigger a video load error where practical and confirm the tile/catalog communicates failure.
- Run lint/build.

### 2. Object URL Lifecycle - Completed

Goal: avoid leaking `blob:` URLs during duplicate adds, catalog clears, and unmount.

Planned changes:

- Revoke duplicate object URLs created during file ingestion.
- Revoke removed catalog item URLs when items are discarded.
- Add unmount cleanup for remaining catalog object URLs.

Validation:

- Add duplicate files and confirm the catalog count does not grow.
- Clear catalog and confirm the wall resets.
- Run lint/build.

### 3. Timeline Render Pressure - Completed

Goal: reduce React work caused by every playing video updating timeline state.

Planned changes:

- Stop updating `currentTime` React state for every `timeupdate` when controls are hidden.
- Update timeline state only while tile controls are visible, while zoomed, or while scrubbing.
- Consider using refs plus a throttled `requestAnimationFrame` loop for the active/hovered tile only.

Validation:

- Load 12+ videos and confirm playback still works.
- Hover a tile and confirm timeline updates.
- Scrub a tile and confirm seek behavior.
- Run lint/build.

### 4. Crop And Metadata Analysis Queue - Completed

Goal: prevent local folder adds from launching too many metadata/crop jobs at once.

Planned changes:

- Add bounded concurrency for metadata hydration.
- Run crop detection through a small queue.
- Prefer analyzing visible wall videos first, then catalog-only videos later.

Validation:

- Add a folder with many files and confirm the app stays responsive.
- Confirm aspect filtering still works after metadata arrives.
- Run lint/build.

### 5. Regression Smoke Tests - Completed Initial Coverage

Goal: make fragile interactions easy to verify.

Planned checks:

- Detected crop preserves natural aspect ratio.
- Fullscreen overlay escapes row bounds and returns to its slot.
- Theme hydration does not produce mismatch warnings.
- Internal video dragging does not trigger the file-drop scrim.
- Row count changes fit rows into viewport height.

Validation:

- Run `npm.cmd run smoke`.
- Keep generated fixtures outside the repo or create tiny deterministic fixtures only if necessary.

### 6. Component And Hook Decomposition

Goal: split `src/components/video-wall-app.tsx` into maintainable pieces.

Suggested extraction order:

- Pure wall layout/replacement helpers into `src/lib/wall-layout.ts`. Completed.
- `VideoTile` into `src/components/video-tile.tsx`. Completed.
- `ControlPanel` into `src/components/control-panel.tsx`.
- `CatalogSidebar` into `src/components/catalog-sidebar.tsx`.
- Catalog ingestion/persistence into a hook.
- Playback controls into a hook.

Validation:

- Preserve behavior with lint/build after each extraction.
- Add focused tests for pure helper extraction.

## Recently Completed

- PRD updated to match current bottom-panel, theme, muted-default, and detected-crop direction.
- User-visible status and media error states now surface failed/unsupported files.
- Catalog object URLs are tracked, deduped, and revoked on cleanup.
- Tile timeline React updates are throttled and gated to visible/zoomed/scrub states.
- `npm.cmd run smoke` now generates temporary videos and checks theme hydration, local video add, muted/default volume, timeline hover/scrub, and zoom behavior.
- Metadata reads are capped at four concurrent jobs and crop detection is capped at two concurrent jobs.
- Wall packing, row fill, replacement, and reorder helpers were extracted to `src/lib/wall-layout.ts`.
- `VideoTile` was extracted to `src/components/video-tile.tsx`.
