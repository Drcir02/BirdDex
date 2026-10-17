# Live camera: full screen and zoom

Added after the first phone test: the live camera picture sat in a small card of the green LCD (about 250 px high on an iPhone),
and there was no zoom, so a bird that is not very close could not be seen, let alone recognised.

## What the person gets

- While the camera is on, the picture fills the whole phone (`src/features/scan/LiveOverlay.tsx`, `live.css`): a layer in
  `<body>` above the device frame, with the cross (switch off) at the top left, the zoom readout at the top right, and at the
  bottom the status and top guess, the zoom buttons (1x 2x 3x 5x, 8x when the camera reaches that far), and the Catch button.
  With the camera off the screen is the normal one with a start button. The video element is always in the layer (hidden while
  off) so the hook has it when the camera question is answered.
- Zoom: two fingers pinch, a drag with one finger moves the zoomed picture, the buttons jump to a step, the mouse wheel zooms on a
  computer. The hint under the buttons shows until the first zoom.
- Safe areas (`env(safe-area-inset-*)`) keep the controls clear of the notch and the home bar in the installed app.

## How it works

- `zoomMath.ts`: pure arithmetic. The view is a zoom factor plus a pan (where the middle of the view sits, from the middle of the
  box, in fractions of the box, so a turn of the phone does not break it). `cssTransform` gives the transform for the video,
  `viewOfFrame` gives the part of the camera picture (fractions of the frame) that the view shows, using the `object-fit: cover`
  scale. Digital zoom goes up to 6x.
- `zoomController.ts`: holds the state and drives one of two ways. Hardware: when `track.getCapabilities().zoom` has a range
  (Chromium on Android), `applyConstraints({ advanced: [{ zoom }] })`, one request at a time with the newest wish; the picture
  needs no cutting. Digital (iPhones: Safari has no zoom for web pages): the video gets a CSS transform and `getView()` tells the
  scanner which part is on the screen. If the camera refuses its own zoom, it falls back to digital.
- `zoomGestures.ts`: pointer events on a transparent touch layer under the buttons (so taps on buttons never reach it), with
  `touch-action: none`.
- `useLiveScan.ts` owns the controller: `attach(track)` after the camera opens, `detach()` in teardown (back to 1x), `getView`
  handed to the scanner, and `viewChanged` (reducer action) drops a lock on a bird at once, also for the Catch button.
- The scanner (`src/ml/vision/live.ts`) takes the optional `getView` of `LiveScanner.start` (`src/domain/engines.ts`): every frame
  and every snapshot is cut to that part (`cropRect`, `grabFrame`, `copyToCanvas` in `frame.ts`), the tracker is reset when the
  view changes (`sameView` in `liveLogic.ts`), and the answer of a frame that was being analysed while the view changed is dropped.
  So the model looks at exactly what the person sees, and the picture saved with a catch is the zoomed part.
- The camera is asked for 1920x1080 (was 1280x720): a digital zoom cuts a part out, and a bird far away needs the pixels.

## Tests

- Unit: `scan-zoom-math`, `scan-zoom-controller` (digital, hardware, fallback, gestures), `vision-frame-crop`, `vision-live-view`,
  and the zoom part of `scan-live-page`.
- Browser (`tests/e2e/live-zoom.spec.ts`): the layer fills 390 x 844 and covers the device frame; buttons, a two-finger pinch
  (CDP touch events), a drag and the wheel; and with the real model a bird pasted small into a pretend camera picture is not
  recognised at 1x (guess "Čírka obecná 21 %") and is locked as the Mallard at 5x, and the saved picture is 177 x 384 (the
  zoomed part) instead of the whole frame.

## Not verified (no phone here)

- iPhone: how smooth the pinch is, how sharp the picture is at 5x with a 1080p camera, behaviour in the home-screen app.
- Android: whether the zoom range shows up without extra permissions in Chrome (the code falls back to digital zoom if not), and
  how the zoom of the main camera lens behaves on phones with several lenses.
- The multiplication sign of the pixel font is small in the zoom buttons ("1x" looks like a raised x).
