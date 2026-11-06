/// <reference lib="webworker" />

import { env, pipeline } from '@huggingface/transformers';
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import { DEPTH_MODEL_ID } from '../lib/constants';
import { normalizeDepth } from '../lib/depthMath';

interface InitMessage {
  type: 'init';
}

interface InferMessage {
  type: 'infer';
  id: number;
  bitmap: ImageBitmap;
  cols: number;
  rows: number;
}

type InMessage = InitMessage | InferMessage;

interface ProgressLike {
  status?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

type DeviceName = 'webgpu' | 'wasm';
type DtypeName = 'fp16' | 'q4f16' | 'q8';

interface Attempt {
  device: DeviceName;
  dtype: DtypeName;
}

type Estimator = (image: OffscreenCanvas) => Promise<{
  predicted_depth?: { data: ArrayLike<number>; dims: number[] };
  depth?: { data: ArrayLike<number>; width: number; height: number };
}>;

let estimator: Estimator | null = null;
let backend: DeviceName | '' = '';
let dtype: DtypeName | '' = '';
let busy = false;
let scratch: OffscreenCanvas | null = null;
let scratchCtx: OffscreenCanvasRenderingContext2D | null = null;
let fellBack = false;

const ctx = self as DedicatedWorkerGlobalScope;

ctx.onmessage = (event: MessageEvent<InMessage>) => {
  const message = event.data;
  if (message.type === 'init') void boot(false);
  else void infer(message);
};

function post(message: object, transfer?: Transferable[]) {
  if (transfer) ctx.postMessage(message, transfer);
  else ctx.postMessage(message);
}

function configureRuntime() {
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  const onnx = env.backends.onnx as {
    wasm?: { wasmPaths?: { mjs: string; wasm: string }; numThreads?: number };
  };
  onnx.wasm ??= {};
  // The asyncify runtime still allocates shared memory. The page is
  // cross-origin isolated so that succeeds; keep a single thread so a laptop
  // is not asked to fan out pthreads next to the renderer.
  onnx.wasm.numThreads = 1;
  onnx.wasm.wasmPaths = {
    mjs: new URL(mjsUrl, self.location.href).href,
    wasm: new URL(wasmUrl, self.location.href).href,
  };
}

async function loadAttempt(attempt: Attempt) {
  const created = await pipeline('depth-estimation', DEPTH_MODEL_ID, {
    device: attempt.device,
    dtype: attempt.dtype,
    progress_callback: (info: ProgressLike) => {
      const progress =
        typeof info.progress === 'number'
          ? info.progress
          : info.total
            ? Math.round(((info.loaded ?? 0) / info.total) * 100)
            : undefined;
      post({
        type: 'progress',
        status: info.status ?? 'loading',
        file: info.file ?? '',
        progress,
        device: attempt.device,
        dtype: attempt.dtype,
      });
    },
  });
  estimator = created as unknown as Estimator;
  backend = attempt.device;
  dtype = attempt.dtype;
}

async function webgpuReady(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    const adapter = await gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

async function boot(wasmOnly: boolean) {
  configureRuntime();
  const hasGpu = !wasmOnly && (await webgpuReady());
  const attempts: Attempt[] = [
    ...(hasGpu
      ? [
          { device: 'webgpu' as const, dtype: 'fp16' as const },
          { device: 'webgpu' as const, dtype: 'q4f16' as const },
        ]
      : []),
    { device: 'wasm', dtype: 'q8' },
  ];

  let last = 'Depth model failed to load';
  for (const attempt of attempts) {
    try {
      post({ type: 'status', state: 'loading', detail: `${attempt.device} · ${attempt.dtype}` });
      await loadAttempt(attempt);
      post({ type: 'ready', backend, dtype });
      return;
    } catch (error) {
      estimator = null;
      last = error instanceof Error ? error.message : String(error);
      post({ type: 'status', state: 'retrying', detail: last });
    }
  }
  post({ type: 'error', message: last });
}

function blit(bitmap: ImageBitmap): OffscreenCanvas {
  if (!scratch || scratch.width !== bitmap.width || scratch.height !== bitmap.height) {
    scratch = new OffscreenCanvas(bitmap.width, bitmap.height);
    scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
  }
  if (!scratchCtx || !scratch) throw new Error('Could not draw the camera frame');
  scratchCtx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return scratch;
}

function pack(
  result: {
    predicted_depth?: { data: ArrayLike<number>; dims: number[] };
    depth?: { data: ArrayLike<number>; width: number; height: number };
  },
  cols: number,
  rows: number,
): Uint8Array {
  const tensor = result.predicted_depth;
  if (tensor?.dims && tensor.dims.length >= 2 && tensor.data) {
    const width = tensor.dims[tensor.dims.length - 1];
    const height = tensor.dims[tensor.dims.length - 2];
    const plane = width * height;
    const data = tensor.data;
    const offset = Math.max(0, data.length - plane);
    const view =
      data instanceof Float32Array
        ? data.subarray(offset, offset + plane)
        : Array.prototype.slice.call(data, offset, offset + plane);
    return normalizeDepth(view, width, height, cols, rows);
  }
  const raw = result.depth;
  if (raw?.data && raw.width && raw.height) {
    return normalizeDepth(raw.data, raw.width, raw.height, cols, rows);
  }
  throw new Error('Depth model returned an empty map');
}

async function infer(message: InferMessage) {
  if (!estimator || busy) {
    message.bitmap.close();
    return;
  }
  busy = true;
  const started = performance.now();
  try {
    const image = blit(message.bitmap);
    const result = await estimator(image);
    const single = Array.isArray(result) ? result[0] : result;
    const depth = pack(single, message.cols, message.rows);
    post(
      {
        type: 'depth',
        id: message.id,
        cols: message.cols,
        rows: message.rows,
        ms: performance.now() - started,
        depth,
        backend,
        dtype,
      },
      [depth.buffer],
    );
  } catch (error) {
    try {
      message.bitmap.close();
    } catch {
      /* already closed */
    }
    const text = error instanceof Error ? error.message : String(error);
    if (backend === 'webgpu' && !fellBack) {
      fellBack = true;
      estimator = null;
      post({ type: 'status', state: 'retrying', detail: text });
      await boot(true);
      return;
    }
    post({ type: 'error', message: text });
  } finally {
    busy = false;
  }
}
