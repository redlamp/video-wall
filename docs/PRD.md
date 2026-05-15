# Video Wall PRD

## Overview

Video Wall is an app for playing one to many videos at once in a tiled layout. The MVP should focus on local files in a web app, with online video sources deferred to the backlog. Users can control selected videos, control all videos through explicit global actions, adjust the row-based wall layout, crop letterboxing, and persist video metadata so repeated playback is faster and cleaner.

The initial product should prioritize a reliable local-video wall with strong layout, playback, selection, keyboard control, and crop metadata. Online video support should be designed in, but treated as backlog because sites such as YouTube impose API, embedding, DRM, CORS, and rate-limit constraints.

## Goals

- Play multiple videos simultaneously in a responsive wall layout.
- Support user control over row count, with columns filling automatically.
- Detect and crop letterboxed or pillarboxed content to reduce black gaps.
- Handle mixed landscape, portrait, square, and unusual aspect ratios.
- Provide explicit global playback controls: play, pause, seek, speed, and volume.
- Provide selected-video controls: play, pause, seek, speed, volume, crop, and focus.
- Support keyboard shortcuts scoped to the current selection.
- Store metadata for previously loaded videos, including detected crop regions and source details.
- Keep the app practical for local libraries first, with a path toward online sources later.
- Allow users to zoom in on or emphasize a specific video without leaving the wall workflow.
- Provide light and dark themes, with dark as the default viewing mode.

## Non-Goals For MVP

- Circumventing DRM, paid streaming restrictions, or platform terms of service.
- Downloading videos from online services without explicit user-provided rights or supported APIs.
- Frame-perfect synchronization across all videos.
- YouTube or streaming-site playback.
- Professional NLE-style editing features.
- Multi-machine video wall synchronization.
- Subtitles, captions, and multiple audio-track management.
- Remote storage or cloud processing.

## Target Users

- Creators or researchers comparing many videos at once.
- Editors reviewing shot libraries, social clips, or reference footage.
- Users building ambient video walls from local footage.
- Analysts who need to scan multiple video feeds side by side.

## Recommended Technical Direction

### MVP Stack

- Web app: Next.js, React, TypeScript.
- UI: Tailwind CSS and shadcn/ui. Use shadcn components where possible for controls, menus, dialogs, sheets, sliders, toggles, tabs, tooltips, and command-style interactions.
- Playback: native HTML `<video>` elements for local files and supported direct media URLs.
- Animation: GSAP for UI transitions, wall layout movement, zoom transitions, selection affordances, and catalog interactions.
- Local storage: IndexedDB for metadata and recent libraries.
- File access: browser file picker for MVP; File System Access API as an enhanced path for Chromium-based browsers.

This route is the fastest way to build the core experience and is a good fit for tiled playback, UI controls, keyboard shortcuts, and metadata. Modern browsers use hardware-accelerated video decode where available, so the web approach is viable for the MVP, though practical limits will still depend on codec, resolution, GPU, and browser behavior.

The MVP should avoid remote storage and cloud processing. Private local videos should remain local to the user's browser session and local browser storage.

### Desktop Wrapper Option

If persistent local-library access, file watching, native dialogs, background analysis, or packaged Windows distribution become important, wrap the app with Tauri or Electron.

Tauri is attractive for a lighter Windows desktop app. Electron may be easier if we need mature media tooling, Node integrations, or a more flexible desktop runtime.

### Video Analysis Option

Letterbox detection can start in-browser with canvas sampling from video frames. For more accurate or batch analysis, add a local worker process using FFmpeg or a native sidecar in a desktop build.

### Effects And Future 3D Option

The core MVP should render videos as native HTML `<video>` elements because this gives the browser the best chance of using optimized video decode, accessibility primitives, and straightforward controls. GSAP should handle most motion, including zooming, layout transitions, sidebar reveal/hide, selection feedback, and hover or focus polish.

Three.js should be postponed to backlog/future planning. It is feasible for special effects: a video can be used as a texture on a plane with `VideoTexture`, which would allow 3D wall effects such as perspective tilts, carousel motion, depth layers, animated clustering, or a cinematic zoom path. This should not be part of the MVP renderer.

Tradeoffs for rendering videos on Three.js planes:

- It can enable richer visual effects than DOM video tiles.
- It may complicate per-video controls, hit testing, keyboard focus, and accessibility.
- It may increase GPU memory pressure when many videos are active.
- It can make crop, layout, and pixel-perfect UI overlays harder.
- It may be harder to preserve browser-native video optimizations at high video counts.

Recommended approach: build the MVP wall with DOM video tiles and GSAP. Keep the rendering architecture modular enough that a later "3D mode" can render selected videos or the whole wall into a Three.js scene for effects experiments, but do not spend MVP implementation time on Three.js.

## Source Support

### Local Files And Folders

MVP should support local video files and folder selection. Users should be able to drag files or folders onto the app window, and the app should scan supported video files from those dropped sources. A folder picker should also be available where browser support allows it.

Supported formats should focus on content the browser can play. The default scan list should include `.mp4`, `.mov`, `.webm`, `.m4v`, `.mkv`, and `.avi`, with unsupported files skipped or marked as unsupported after load failure.

Metadata should be keyed by a stable identifier. In a browser MVP this may be approximate, using file path when available, file name, size, duration, and modified date. In a desktop build, a hash or partial hash can improve reliability.

### Direct Media URLs

Direct video URL support is optional for the MVP. The product should not depend on it for the first milestone.

### YouTube And Streaming Sites

Online platform support belongs in the backlog and should be treated per-provider:

- YouTube embeds can be supported with the YouTube iframe API, but per-video control, synchronization, crop detection, and canvas analysis are limited.
- Arbitrary streaming sites may not be feasible due to DRM, embedding restrictions, CORS, and terms of service.
- Direct, user-owned, or API-supported sources are the safest long-term path.

## Core UX

### Wall Layout

Users can choose:

- Fixed row count, with columns expanding to fit all active videos.
- Auto row count based on viewport size and video count.

The leading MVP layout mode should be fixed rows, because it matches the desired "anchor on rows, fill columns" behavior. Users may load anywhere from one video to roughly 36 videos, with a common upper target of 12 to 36 videos and layouts such as 6 columns by 2 rows.

The wall should preserve a set number of rows and use as many columns as needed. Content should fit into those rows without visual gaps. The layout should allow mixed aspect ratios to use space efficiently; for example, portrait videos may occupy narrower columns or fill available openings when landscape videos complete or are removed. The MVP can start with uniform tile slots plus strong fit/fill/crop behavior, but the layout model should leave room for a smarter gap-filling algorithm.

Rows should fit inside the browser viewport height. Increasing row count should make each row, and therefore each video tile, smaller. Row height should be measured from the available wall viewport, not allowed to expand content vertically. Tile width should be based on the video's effective aspect ratio so normal 16:9 videos remain landscape and take their full proportional space.

The wall is not a CSS grid. It is a vertical stack of row containers. Each row independently packs videos left-to-right until the row is full, then the next row begins. Row content should be horizontally centered when underfilled or slightly overfilled, with only a small amount of permitted edge overflow.

The wall should expose a horizontal scrollbar at the bottom when packed rows are wider than the viewport. Vertical mouse-wheel scrolling over the wall should move the wall left/right horizontally.

The packed wall column should stay centered in the viewport by default. Rows should also center their contents, and automatic fills/replacements should avoid growing rows far wider than the window; a small amount of overflow is acceptable, but whole videos should not be hidden off-screen by normal replacement behavior.

Each tile should support:

- Fit inside tile.
- Fill tile with center crop.
- Fill tile with smart crop based on detected content bounds.
- Zoom or isolate a selected video.

Double-clicking a video should zoom it to roughly 95% of the available screen. This should keep the user in the wall context rather than opening a separate player. Clicking outside the zoomed video returns it to its previous wall location and size.

Only one zoomed video can be displayed at a time. Opening a different video returns the previous zoomed video to the wall. While a video is zoomed, left/right arrow keys should cycle through displayed videos in packed row order, moving left-to-right through one row, then to the next row, and looping from the end of the last row to the start of the first row.

Manual crop controls are backlog. MVP crop controls should focus on fit, fill, and automatic detected crop.

Automatic detected crop should only remove detected letterboxing/pillarboxing, such as a vertical phone video saved inside a 16:9 frame. It should not crop normal 16:9 video content just to force a uniform tile shape.

Wall transitions should use GSAP so adding, removing, zooming, pinning, and replacing videos feels spatially coherent. Motion should be fast and functional, not decorative.

### Library And Catalog Proposal

The MVP should include a lightweight library/catalog panel alongside the wall. The catalog is not a full media manager; it is a staging area for videos discovered from files and folders.

Catalog input:

- Drag and drop one or more video files onto the window.
- Drag and drop one or more folders onto the window where browser support allows folder traversal.
- Use an "Add Folder" action where browser support allows directory picking.
- Use an "Add Files" action as a universal fallback.

Catalog behavior:

- Adding a folder automatically scans supported videos and populates the catalog.
- Newly discovered videos can auto-populate the wall until the current wall capacity or user preference is reached.
- When a video ends, it should disappear from the wall and make room for a replacement video from the catalog.
- End-of-video replacement should prefer a video with a similar effective aspect ratio so rows do not jump. If a landscape slot has no good landscape replacement, the app may replace it with multiple portrait videos inserted at the same wall position to preserve the occupied row width.
- The app should prefer showing videos that have not yet appeared in the current session.
- When the full catalog has been shown, the app should loop the library and continue filling completed tiles.
- Users can manually add catalog items to the wall.
- Users can remove videos from the wall without removing them from the catalog.
- Users can pin videos so they remain in place and are not replaced when they end.
- Users can clear the catalog for the current session.
- Adding a folder should automatically populate the catalog, fill the wall, and begin playback.
- The "new videos first" queue should be tracked per session only.

Catalog sorting and selection:

- Sort by file name.
- Sort by modified date.
- Sort by video duration after metadata is available.
- Shuffle/randomize catalog order.
- Shuffle should be on by default for automatic wall fill and end-of-video replacement.
- Fill wall from current sort order by adding enough videos to fill the packed width of every row.
- Fill wall with random videos by rebuilding the wall from a shuffled catalog.

Recommended first layout:

- A collapsible left sidebar for the catalog that overlays the video wall instead of taking layout space.
- A hover/hotkey control panel at the bottom of the app for global playback, row count, mute all, scroll mode, aspect filtering, crop mode, fill, randomize, shuffle, theme, and pinning. It should overlay the video wall instead of taking layout space.
- The video wall as the primary full-height workspace.
- Default row count: 2.
- The catalog sidebar and control panel should use translucent backgrounds with backdrop blur so the video wall remains visually present behind controls.

Browser constraint:

- Folder drag-and-drop and persistent directory handles are strongest in Chromium-based browsers. Other browsers may fall back to selecting files manually.

### Control Panel

The app should have a bottom control panel that is open on first launch, then can stay hidden during normal wall viewing and reappear when the user hovers near the bottom edge of the app or presses a hotkey. The panel should be draggable so users can reposition it around the screen. When not pinned or actively hovered, it should fade out after a short delay rather than sliding out of the layout.

Recommended hotkeys:

- `` ` `` / `~`: show or hide the control panel.
- `Escape`: close the control panel if open; otherwise clear current video selection.

Avoid using `P` as the primary panel shortcut because it is easy to confuse with play/pause behavior and may conflict with text input or future commands.

The control panel should use shadcn components where possible and include:

- Fill wall from catalog.
- Random wall refresh.
- Shuffle toggle.
- Scroll mode toggle: scroll all rows together or scroll one hovered row independently.
- Aspect ratio filter: mixed, landscape, portrait.
- Crop mode: detected, fill, fit.
- Global play / pause.
- Global seek backward / forward.
- Master volume and mute all.
- Playback speed.
- Row count.
- Theme toggle: dark and light, with dark as the default.
- Performance mode or quality preference later if needed.

The panel should not permanently consume vertical wall space. A pin option can keep it visible for setup-heavy workflows. The theme toggle should sit next to the panel pin button. Speed and row steppers should expose brief icon tooltips.

### Selection Model

The app should support selected-video control rather than a single focus-only model.

Selection behavior:

- Click an unselected video to select only that video.
- Click a selected video to unselect it.
- `Ctrl+Click` toggles a video in or out of the current selection.
- `Shift+Drag` draws a rectangle and selects all videos intersecting that rectangle.
- `Escape` clears the current selection.

Keyboard shortcuts apply to the current selection. If no videos are selected, shortcuts control all videos.

Selected videos should have a clear but unobtrusive visual state.

### Global Controls

Global controls should include:

- Play / pause all.
- Seek all backward / forward.
- Volume all up / down.
- Master volume.
- Mute all.
- Playback speed all.
- Reset all to start.
- Fill wall from catalog.
- Shuffle wall from catalog.

Global controls should be explicit UI controls, not the default target of normal keyboard shortcuts while videos are selected.

The main control panel play/pause should always control all displayed videos, regardless of current selection. Keyboard shortcuts may continue to scope to selected videos.

### Per-Video Controls

Each video tile should provide controls for:

- Play / pause.
- Seek backward / forward.
- Hover timeline for scrubbing within that video.
- Previous / next video buttons next to the timeline.
- Volume.
- Mute.
- Playback speed.
- Crop mode.
- Remove from wall.
- Pin / unpin.
- Open metadata or crop editor.

Per-video controls should be compact so they do not dominate the wall. Hovering over or moving within a video tile should reveal its timeline and tile controls. Moving the cursor off a video should fade the tile timeline and buttons out immediately. If the cursor remains over a video without interaction, the tile timeline/controls and cursor should hide after 4 seconds. For multi-selection, the control surface should expose operations that apply to every selected video.

Pinned, zoom, and remove actions should live on the same horizontal control row as the per-video timeline. When multiple videos are selected, actions triggered from one selected tile should apply to the selected group. Timeline scrubbing in a multi-selection should seek each selected video by the same percent of its duration, not by the same absolute timestamp.

Short videos under 30 seconds should loop in place until they have played for at least 30 seconds, then become eligible for normal end-of-video replacement.

## Keyboard Shortcuts

Default shortcuts:

- `Space`: play / pause selected videos.
- `ArrowUp`: volume up selected videos.
- `ArrowDown`: volume down selected videos.
- `ArrowLeft`: skip selected videos backward 5 seconds.
- `ArrowRight`: skip selected videos forward 5 seconds.
- `Ctrl+ArrowLeft`: previous video, when a playlist/source sequence exists.
- `Ctrl+ArrowRight`: next video, when a playlist/source sequence exists.
- `Escape`: clear selected videos.
- `` ` `` / `~`: show or hide the control panel.

Shortcut scope:

- One selected tile: shortcuts affect that video.
- Multiple selected tiles: shortcuts affect all selected videos.
- No selected tiles: shortcuts affect all videos.

Explicit global toolbar buttons should remain available for controlling all videos regardless of selection.

## Letterbox And Crop Detection

The app should detect black bars by sampling frames and estimating the active content rectangle. Detection should run automatically when a video is added.

Detected crop must only clip away detected black bars. It must never scale video width and height disproportionately, stretch content, or squash content to fit a tile. The rendered video should preserve its natural aspect ratio, with the tile frame clipping the detected black-bar area.

Suggested MVP algorithm:

1. Sample several frames across the video duration.
2. Downscale each frame to a small canvas.
3. Detect near-black rows and columns at the edges using luminance thresholds.
4. Ignore brief transitions, fades, and credits by taking a median or consensus crop box.
5. Store the crop box and confidence score in metadata.
6. Store automatic crop data for future sessions.

Detection should handle:

- Letterboxing: black bars top and bottom.
- Pillarboxing: black bars left and right.
- Windowboxing: bars on all sides.
- Non-black bars where possible in later versions.

Risks:

- Dark scenes may be mistaken for bars.
- Logos or subtitles in black bars may affect detection.
- Online embedded videos may not allow canvas sampling.
- Manual crop correction is a backlog feature, so MVP should expose crop confidence and allow users to disable detected crop for a tile.

## Metadata

Metadata should include:

- Source type: local file, direct URL, provider embed.
- Source identifier.
- Display name.
- Duration.
- Native width and height.
- Detected crop rectangle.
- Manual crop rectangle.
- Crop confidence.
- Last playback speed.
- Last volume.
- Last opened timestamp.
- Tags or notes in later versions.
- Catalog sort preference.
- Session membership for optional resume.

Browser MVP storage:

- IndexedDB for structured metadata.
- Optional export/import JSON for portability.
- Optional "resume previous session" menu item that restores the last saved wall when requested by the user.

Desktop later:

- SQLite database.
- Stable media hashes.
- Background analysis queue.

## Performance Requirements

The app should remain responsive while playing many videos, but practical limits depend heavily on codec, resolution, hardware acceleration, and browser/runtime.

MVP target:

- Smooth playback for 12 simultaneous videos on a modern desktop when source codecs and resolutions are reasonable.
- Best-effort support up to roughly 36 videos.
- Graceful degradation for larger walls by allowing muted playback, reduced resolution source files, paused videos, or lower-quality preview modes.

Potential optimizations:

- Use native video decoding wherever possible.
- Avoid drawing video to canvas continuously.
- Run crop detection as a one-time analysis job.
- Use virtualization only for non-visible library panels, not active wall tiles.
- Mute videos by default and start master volume at a low level, while making mute-all and master volume easy to reach.

## MVP Scope

1. Create a Next.js app with a video wall route.
2. Add local file and folder input through drag-and-drop, file picker, and folder picker where supported.
3. Add a lightweight catalog/sidebar populated from dropped files and folders.
4. Add catalog sorting by name, modified date, and duration.
5. Add shuffle/random fill from catalog.
6. Render videos in a fixed-row responsive grid, with columns filled automatically.
7. Add explicit global play, pause, seek, speed, master volume, and mute-all controls.
8. Add a bottom-edge hover, draggable, and hotkey control panel using shadcn components where possible.
9. Add selection behavior: click, click-to-unselect, `Ctrl+Click`, `Shift+Drag`, and `Escape`.
10. Add compact per-tile controls and selected-video bulk controls.
11. Implement keyboard shortcuts scoped to selected videos, falling back to all videos when nothing is selected.
12. Add basic crop modes: fit, fill, and detected crop.
13. Implement automatic in-browser letterbox detection for local videos when added.
14. Persist metadata in IndexedDB.
15. Add a menu option to resume the previous saved session.
16. Add double-click zoom to roughly 95% of available screen, with click-outside restore.
17. Add end-of-video refill from catalog, preferring unseen videos before looping.
18. Add pinning so selected videos can stay in place and avoid automatic replacement.

## Later Phases

### Phase 2

- Playlist support per tile.
- Layout presets.
- Metadata import/export.
- Better source identity via hashing where possible.
- Manual crop editor.
- Smarter mixed-aspect gap-filling layout.
- Direct media URL support.
- Per-folder include/exclude filters.
- Duplicate detection.
- Save named wall presets.
- Session history, such as "recently shown" and "never shown in this session".
- Lightweight health indicators for unsupported, failed, or very slow-loading videos.
- Experimental Three.js wall mode using videos as textures on plane panels.
- Optional special effects for zoom, shuffle, or wall rearrangement.

### Phase 3

- Desktop packaging with Tauri or Electron.
- FFmpeg-based metadata and crop analysis.
- Persistent folder libraries.
- Background analysis queue.
- Provider-specific integrations such as YouTube iframe support.

### Phase 4

- Multi-monitor support.
- Saved wall sessions.
- Timeline synchronization tools.
- Remote control surface.
- Plugin-style source providers.

## Open Questions

No major MVP product questions remain. Remaining choices should be handled during implementation as defaults, UI details, or backlog prioritization.

## Initial Recommendation

Start with a local-first web MVP using Next.js, React, shadcn/ui, Tailwind CSS, GSAP, IndexedDB, and native video elements. Build the catalog/sidebar, drag-and-drop folder ingestion, row-based wall layout, selection model, selected-video keyboard shortcuts, explicit global controls, automatic crop detection, double-click zoom, catalog refill behavior, and crop metadata first. Keep online providers and Three.js rendering behind future/backlog architecture considerations so they can be added later without compromising the local-video experience.

If the product quickly depends on folder libraries, reliable persistent file access, FFmpeg analysis, or Windows packaging, move to Tauri or Electron after the browser MVP proves the interaction model.
