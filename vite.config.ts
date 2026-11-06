import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

function copyRuntime(src: string, dest: string) {
  if (!existsSync(src)) return;
  mkdirSync(dirname(dest), { recursive: true });
  const srcTime = statSync(src).mtimeMs;
  const destTime = existsSync(dest) ? statSync(dest).mtimeMs : 0;
  if (srcTime > destTime) copyFileSync(src, dest);
}

/** Serve the exact ONNX Runtime and MediaPipe wasm that this install expects. */
function runtimeAssets() {
  return {
    name: 'depth-twin-runtime-assets',
    buildStart() {
      const mp = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
      copyRuntime(
        join(mp, 'vision_wasm_internal.js'),
        join(root, 'public/mediapipe/vision_wasm_internal.js'),
      );
      copyRuntime(
        join(mp, 'vision_wasm_internal.wasm'),
        join(root, 'public/mediapipe/vision_wasm_internal.wasm'),
      );
    },
  };
}

export default defineConfig({
  plugins: [runtimeAssets()],
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['@huggingface/transformers', 'onnxruntime-web'],
  },
  build: { target: 'es2022' },
  // This ONNX Runtime build allocates a shared WebAssembly.Memory even for one
  // thread, so the page must be cross-origin isolated. Model hosts we fetch
  // (Hugging Face, Google storage) send CORS headers, which COEP allows.
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
