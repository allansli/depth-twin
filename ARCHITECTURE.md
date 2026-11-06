# Architecture

Depth Twin is a static site. The webcam stream is a `MediaStream` inside the page. No frame, depth map, or landmark is uploaded.

```
getUserMedia (or a labeled synthetic canvas stream)
        │
        ▼
   <video>  ─────────────────────────────────────────────┐
        │                                                │
        │  draw 320px long side                          │ VideoTexture
        ▼                                                ▼
   ImageBitmap ──postMessage──► depth.worker            Three.js
        │                         │                      shader
        │                         │  Transformers.js     crossfade
        │                         │  Depth Anything V2   (depth A → B)
        │                         │  Small ONNX
        │                         │
        │                         ├─ WebGPU · fp16   (~50 MB, preferred)
        │                         ├─ WebGPU · q4f16  (if fp16 is refused)
        │                         └─ WASM  · q8      (if WebGPU is missing)
        │                         │
        │                         ▼
        │                    uint8 depth grid (160 cols)
        │                         │
        └─────────────────────────┴──► particles, holo, metal, wire, or ember
                                      x is mirrored so the stage is a mirror
                                      paint + presence modulate the material

<video> ──recognizeForVideo──► MediaPipe Gesture Recognizer (GPU, else CPU)
                         └─► Pose Landmarker Lite, about twice a second, optional
                                  │
                                  ▼
                    category + score → hold → gesture edge
                    point on a control for ~0.4s → dwell click
                                  │
                    open / point → mirrored cursor
                    fist         → hold / release the twin
                    victory      → next material
                    thumb up     → branded still
                    pinch        → only if the recognizer failed to load
```

## Why the split

Depth Anything V2 Small is the heavy model. It runs in a module worker so the render loop keeps painting the last depth field while the next one is computed. Only one inference is in flight. The worker returns a small uint8 grid, not the full float tensor.

The shader keeps two depth textures and mixes them. The mix time follows the cadence, so a 15 fps depth clock still reads as continuous motion.

MediaPipe’s GPU delegate needs a canvas and a WebGL context. Gesture Recognizer replaces the hand landmarker: one model returns the canned gesture and the landmarks, so the page does not run both. If that model fails to construct, the hand landmarker is the fallback and a strict geometric pinch can still confirm. When a sample is only a few milliseconds, the next one is scheduled on the next frame or two. When it is slow, the next sample waits several times that long so the sculpture keeps drawing. If hands are already over budget, the optional pose pass is paused. The depth worker never shares that GL context. Pose is optional, lite, and throttled; if it fails the twin still runs. Head parallax has no dock toggle. It runs until that budget check pauses it.

## Cadence

When a hand is visible, or when enough of the depth map is near, the next frame is requested on a ~56 ms period (about 18 fps), but never overlapped with an inference that is still running. If the model takes 90 ms, depth simply runs at that pace. When the frame looks empty, the period drops to ~520 ms. A hidden tab sends nothing. Freezing the twin (fist, or F) stops inference entirely.

Presence uses three agreeing samples so the clock does not flicker.

## Caching

- Depth weights: Transformers.js Cache API (`env.useBrowserCache`).
- Hand and pose `.task` files: the page Cache API (`depth-twin-v1`).
- ONNX Runtime’s asyncify wasm and MediaPipe’s vision wasm ship with the static build, so the runtime matches the installed packages. The dev ORT build this app uses is not published on a CDN under a stable version.
- That ORT binary allocates a shared `WebAssembly.Memory`, so the site sends `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Depth and gesture downloads are CORS requests, which COEP allows. Inference stays single-threaded anyway.

## First-load weight

| Piece | Approx. size | Where |
| --- | --- | --- |
| Depth Anything V2 Small fp16 | 49.6 MB | Hugging Face, first visit |
| WebGPU q4f16 fallback | 19.1 MB | only if fp16 cannot load |
| WASM q8 fallback | 27.3 MB | only if WebGPU cannot load |
| Gesture recognizer float16 | 8.4 MB | Google storage, then Cache API |
| Hand landmarker float16 | 7.8 MB | fallback only, if the gesture model fails |
| Pose landmarker lite float16 | 5.8 MB | same |
| ORT asyncify wasm | 26 MB | this site |
| MediaPipe vision wasm | 14 MB | this site |

Camera pixels are not part of any of those downloads.
