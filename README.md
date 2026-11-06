# Depth Twin

A volumetric reflection of you, drawn entirely in the browser.

The webcam (or a clearly labeled synthetic preview) is turned into a depth field by **Depth Anything V2 Small**, then into a particle sculpture or a soft veil in Three.js. **Air UI** reads one hand with MediaPipe and lets an open palm point, a pinch confirm, and a fist hold the twin still. A lite pose model can lean the sculpture with your head.

**On-device. Camera pixels never leave this browser.**
No dispositivo. Os píxeis da câmara nunca saem deste browser.

There is no video backend, no account, and no API key.

## Run locally

```bash
npm install
npm run dev
```

Open the printed localhost URL in **desktop Chrome or Edge**. Choose **Open camera**, or **Synthetic preview** if this machine has no webcam. `?preview=1` starts the synthetic mirror immediately.

```bash
npm test          # vitest, pure helpers only
npm run build     # typecheck + static build to dist/
npm run preview   # serve dist/
```

The first session downloads the depth weights (fp16, about **50 MB**) and the gesture models. After that they stay in the browser cache. The page also ships the ONNX Runtime and MediaPipe wasm that match this install (about 40 MB, cached as static assets). See [ARCHITECTURE.md](ARCHITECTURE.md) for the full table.

## Browser

- Desktop Chrome or Edge with WebGPU is the intended stage. The badge in the corner tells you whether the live backend is **WebGPU fp16**, **WebGPU q4f16**, or **WASM q8**.
- WASM still runs the same model family when WebGPU is missing or refuses fp16. It is slower, and the cadence backs off instead of queuing frames.
- A phone shows a short “desktop recommended” note. The pipeline is not tuned for mobile cameras.
- Firefox and Safari can open the page. Treat them as best-effort: WebGPU there is incomplete, and the WASM fallback is the honest path.
- The ONNX Runtime build needs shared Wasm memory, so the dev server, `vite preview`, and Vercel send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Keep those headers if you host `dist/` somewhere else.

## Gestures

| Pose | What it does |
| --- | --- |
| Open palm or point | Moves the cursor. The control under it takes focus. |
| Pinch | Confirms the focused control. |
| Fist | Holds the twin (stops depth inference) or releases it. |

Keys, if your hands are off camera: **F** hold, **V** form, **H** head parallax, **S** save a still, **G** rehearse. **Rehearse** plays a scripted hand through the same classifier and cursor, and the telemetry says so.

The telemetry line is measured, not decorative: render fps, depth fps and milliseconds, backend, model state, gesture, live vs idle cadence, hand time, and whether the source is the camera or the synthetic preview. If pose or hands are slow (software GL, no WebGPU adapter), the page lengthens the gap between samples and will pause head parallax so the sculpture keeps drawing.

## Privacy

`getUserMedia` runs only after you press **Open camera**. Frames are drawn to a canvas, sent to a worker in the same page, and discarded. Depth weights are fetched from Hugging Face. Hand and pose task files are fetched from Google storage once and then read from the Cache API. Neither of those requests includes the camera.

The synthetic preview is a canvas drawing. It is labeled in the UI and in the telemetry (`source synthetic`).

## Deploy on Vercel

The repo is a static Vite site. [`vercel.json`](vercel.json) rewrites SPA routes and caches hashed assets plus the MediaPipe wasm.

1. Import the GitHub repository in the Vercel dashboard.
2. Framework preset: **Vite**. Output directory: `dist`. Build command: `npm run build`.
3. No environment variables are required.

Or from a machine that is logged in:

```bash
npx vercel
```

The depth model is not bundled. The first visitor of a fresh browser profile still downloads it from Hugging Face and caches it locally.

## Layout

```
src/depth/depth.worker.ts   model load, WebGPU → WASM, one frame at a time
src/twin/                     Three.js particles + veil, shader crossfade
src/vision/                   MediaPipe hand + pose
src/lib/                      gesture math, cadence, depth packing (unit-tested)
```

The pipeline diagram lives in [ARCHITECTURE.md](ARCHITECTURE.md).

## License

[MIT](LICENSE). Depth Anything V2 weights are Apache-2.0 and are downloaded at runtime, not vendored here.
