# Flanders on iPad and Safari: audit

Audit of `master` at `414520c` (25 November 2026), read file by file. The game could not be run during the audit (no browser or iPad in the audit environment), so memory and draw-call figures are worked out from the code, not measured. Line numbers refer to `414520c`.

Flanders is already well optimised at the code level: adaptive resolution, a frame-rate cap and lighter presets for touch devices, frame skipping when nothing moves, instanced crowds and trees, throttled shadow redraws, DOM labels moved with transforms only, a tap-then-Build placement on touch, and a performance panel with "Copy report". What is left for iPad is mostly about defaults, the terrain's memory, and gestures that only exist for mouse and keyboard.

The **PR** column says what the pull request that added this file does about each item.

## Performance on Safari and iPad

Safari gives no GPU timing, so the adaptive resolution has to guess there (`main.ts:3957`). Starting lighter matters more on iPad than anywhere else.

| # | Finding | Where | Fix | PR |
| --- | --- | --- | --- | --- |
| P1 | The tablet default is Medium, which keeps glossy water on. The water is a `MeshPhysicalMaterial` with clearcoat. The sea is transparent and its grid is 6 km wide, so it covers much of the screen along a coast. | `device.ts:46`, `settings.ts:27`, `render/terrain.ts:143` | `waterFx: false` in the tablet defaults. | Done |
| P2 | The fog leaves 1.3% of a surface's colour at 1,300 m (`FogExp2` 0.0016), but the camera still draws out to 4 km. Far terrain chunks, rivers and sea are drawn under solid fog. | `render/sky.ts:62`, `render/camera.ts:28` | Camera `far` = 1,600 (0.14% left there). The sky is drawn on the far plane, so it is unaffected. | Done. **Check the horizon at maximum zoom-out with a low tilt.** |
| P3 | The terrain is one 961 × 961 grid (923k vertices) for the whole 2.4 km map. Estimated cost: ~71 MB on the GPU and ~105 MB of JavaScript memory. That includes a 22 MB index on the master `PlaneGeometry` that is never drawn. iPad Safari takes WebGL away under memory pressure ("The graphics were reset", `boot.ts:52`). | `render/terrain.ts:88-117` | (a) Drop the master index: −22 MB. (b) Give each chunk its own vertex range so it can use `Uint16` indices: about −14 MB. (c) Smaller vertex colours. | (a) done. (b) not yet: it touches every terrain edit path, so it should be done with the game running. (c) not done: colours are stored ×1.18 (above 1.0), so `Uint8` would clamp and change the ground colour. |
| P4 | The ground is 225 chunk meshes plus a river mesh per chunk with water. Each visible chunk is one draw call, and draw calls cost more in Safari. | `render/terrain.ts:102`, `:128` | P2 removes the far ones. Then check draw calls in the performance panel; merge far chunks if still high. | Measure first |
| P5 | iPads have 2 device pixels per CSS pixel, and the tablet pixel cap was 1.5: ~3.1 million pixels per frame on a 12.9″ iPad Pro. | `device.ts:46` | Tablet `pixelCap: 1.25` (~2.2 million). | Done |
| P6 | Villagers, soldiers and animals all cast shadows. While they move, the shadow map is redrawn every 140–275 ms, a regular spike on a tablet GPU. | `render/crowd.ts:165`, `render/sky.ts:21` | On touch devices: villagers, soldiers, carts, animals and travellers cast no shadow, and the redraw interval for movers is doubled. Buildings and trees keep their shadows. | Done |
| P7 | At night, 4 lamp lights plus the fire light are added. Every lit pixel pays for each one. | `main.ts:3986` | 2 lamps on touch devices. | Done |

## Touch: camera and world

The basics already worked: one finger pans; two fingers pinch, twist and pan; drawing tools move panning to two fingers. What was missing is everything that is a right-drag, Shift-click or box-drag on a computer.

| # | Finding | Where | Fix | PR |
| --- | --- | --- | --- | --- |
| T1 | There was no way to tilt the camera on touch. | `render/camera.ts:80-85` | Two fingers slid up or down together tilt (as in Apple Maps and Google Maps). | Done |
| T2 | Every pinch also rotated: any change in angle between the fingers turned the camera. | `render/camera.ts:82-83` | Twists below ~10° are ignored, then the camera turns freely. | Done |
| T3 | The action menu needed a 500 ms hold, fired only on lift-off, with no feedback while holding. | `main.ts:3702` | A ring fills under the finger, and the menu opens at 500 ms while the finger is still down (a short vibration on Android). | Done |
| T4 | Buildings and roads were picked by an exact ray, so small buildings were hard to hit when zoomed out. | `main.ts:3230-3234` | On touch, a tap that misses picks the nearest building drawn within 28 px. | Done |
| T5 | Touch could not select more than one item (box-select is mouse-only; adding needs Shift or Ctrl). | `main.ts:3721-3738` | A **Select more** toggle in the tool dock: taps add or remove buildings and armies. | Done |
| T6 | Panning stopped dead on lift-off. | `render/camera.ts:108-113` | A quick swipe glides on for ~300 ms; a pause before lifting does not. | Done |
| T7 | Every touch move read `getBoundingClientRect()`, which can force a layout between frames. | `render/camera.ts:31-34`, `main.ts:3236`, `:3558` | The canvas rectangle is cached and re-read after a resize. | Done |
| T8 | Rotate cycles one way through 8 steps. | `main.ts:3593-3602` | Holding Rotate turns back one step. | Done |

## iPad interface

| # | Finding | Where | Fix | PR |
| --- | --- | --- | --- | --- |
| G1 | The viewport meta tag lacked `viewport-fit=cover`, so iOS reported every `env(safe-area-inset-*)` as 0 and all the safe-area padding in `mobile.css` did nothing. | `index.html:9` | Added. | Done. **Check an iPhone in landscape (notch side).** |
| G2 | No web app manifest: the game could not be added to the Home Screen full screen. In a Safari tab the toolbars take space, and a swipe in from the left edge probably goes back a page. | `index.html`, `public/` | `manifest.webmanifest`, icons and Apple meta tags. A Home Screen app on iOS keeps its own storage, so on first start there a notice explains how to bring a village over with Backup/Restore. | Done |
| G3 | An iPad in portrait got the phone bottom sheet (52% of the screen). | `ui/mobile.css:47-77` | The bottom sheet is now phone-only; tablets keep the side panel in both orientations, with the minimap shown. | Done |
| G4 | Phone, tablet or desktop was decided once, at load. | `device.ts:31-40` | A touch device is classified again on resize (Split View, Stage Manager). | Done |
| G5 | Many controls were under 44 points (`.btn`, `.pbtn`, `.chip` 40 px; speed buttons 36 × 40 px; `#build-clear` 36 px). | `ui/mobile.css:40`, `:108-125` | 44 px on tablets. Phones keep their tighter rows. | Done |
| G6 | Hover states stuck on iPad after a tap, and Safari's `mouseover` on every tap played the hover sound. | `ui/style.css`, `main.ts:160` | Hover rules wrapped in `@media (hover: hover)`. The hover sound plays for a mouse pointer only. | Done |
| G7 | Some texts say "click", "right-click", "Shift+click" or "double-click", and some information only appears on hover. | `main.ts` | Hints and notices on touch devices use touch words ("tap", "hold", "with Select more on"). Tooltip-only information is unchanged. | Partly done |
| G8 | `touch-action: manipulation` still allows pinch-zoom of the page, so a pinch on a panel could zoom the whole page. | `ui/mobile.css:15` | Safari's `gesturestart` is prevented on touch devices. An iPad trackpad pinch on the map now zooms the camera. | Done |

## Measuring on a real iPad

No Mac is needed: the game's own performance panel works on an iPad. Take a report before and after.

1. Settings → Display → turn on **Show frame rate**.
2. Tap the frame counter to open the panel, then **Find the biggest cost**.
3. **Copy report** and paste it somewhere. It includes the GPU name, resolution scale, draw calls and frame times.
4. Use the same three views each time: zoomed in on the village, zoomed all the way out, and at night during a battle.
