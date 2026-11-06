export interface DepthFrame {
  id: number;
  cols: number;
  rows: number;
  depth: Uint8Array;
  ms: number;
  backend: string;
  dtype: string;
}

export type DepthModelState = 'booting' | 'loading' | 'ready' | 'error';

interface ProgressMessage {
  type: 'progress';
  status: string;
  file: string;
  progress?: number;
  device: string;
  dtype: string;
}

interface StatusMessage {
  type: 'status';
  state: string;
  detail: string;
}

interface ReadyMessage {
  type: 'ready';
  backend: string;
  dtype: string;
}

interface ErrorMessage {
  type: 'error';
  message: string;
}

interface DepthMessage {
  type: 'depth';
  id: number;
  cols: number;
  rows: number;
  ms: number;
  depth: Uint8Array;
  backend: string;
  dtype: string;
}

type WorkerMessage = ProgressMessage | StatusMessage | ReadyMessage | ErrorMessage | DepthMessage;

export class DepthClient {
  readonly worker: Worker;
  state: DepthModelState = 'booting';
  backend = '';
  dtype = '';
  progress = 0;
  detail = 'Starting depth model';
  inflight = false;
  onFrame: (frame: DepthFrame) => void = () => {};
  onChange: () => void = () => {};
  private requestId = 0;

  constructor() {
    this.worker = new Worker(new URL('./depth.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => this.onMessage(event.data);
    this.worker.onerror = (event) => {
      this.state = 'error';
      this.detail = event.message || 'Depth worker failed';
      this.inflight = false;
      this.onChange();
    };
  }

  init() {
    this.worker.postMessage({ type: 'init' });
  }

  submit(bitmap: ImageBitmap, cols: number, rows: number): boolean {
    if (this.state !== 'ready' || this.inflight) {
      bitmap.close();
      return false;
    }
    this.inflight = true;
    const id = ++this.requestId;
    this.worker.postMessage({ type: 'infer', id, bitmap, cols, rows }, [bitmap]);
    return true;
  }

  private onMessage(message: WorkerMessage) {
    if (message.type === 'progress') {
      this.state = 'loading';
      if (typeof message.progress === 'number' && Number.isFinite(message.progress)) {
        this.progress = Math.max(this.progress, Math.min(100, message.progress));
      }
      const file = message.file ? message.file.split('/').pop() : 'weights';
      this.detail = `${message.device} · ${message.dtype} · ${file} ${Math.round(this.progress)}%`;
      this.onChange();
      return;
    }
    if (message.type === 'status') {
      this.state = message.state === 'retrying' ? 'loading' : 'loading';
      this.detail = message.detail;
      if (message.state === 'retrying') this.progress = 0;
      this.onChange();
      return;
    }
    if (message.type === 'ready') {
      this.state = 'ready';
      this.backend = message.backend;
      this.dtype = message.dtype;
      this.progress = 100;
      this.detail = `${message.backend} · ${message.dtype}`;
      this.onChange();
      return;
    }
    if (message.type === 'error') {
      this.state = 'error';
      this.detail = message.message;
      this.inflight = false;
      this.onChange();
      return;
    }
    this.inflight = false;
    this.backend = message.backend || this.backend;
    this.dtype = message.dtype || this.dtype;
    this.onFrame({
      id: message.id,
      cols: message.cols,
      rows: message.rows,
      depth: message.depth,
      ms: message.ms,
      backend: this.backend,
      dtype: this.dtype,
    });
  }
}
