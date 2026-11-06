import { DepthClient, type DepthFrame } from './depth/depthClient';
import { cooldownAfterInfer, createPresence, isPersonPresent, stepPresence, type PresenceState } from './lib/cadence';
import { INFER_LONG_SIDE } from './lib/constants';
import { mirrorToView, viewToVideoNorm } from './lib/coverMap';
import { frameSize, gridSize } from './lib/depthMath';
import { prefersReducedMotion, wantsDesktopNotice } from './lib/device';
import {
  classifyHand,
  createGestureState,
  cursorLandmark,
  handAtCursor,
  hitAirTarget,
  stepGesture,
  type GestureName,
  type GestureState,
  type Landmark,
} from './lib/gestures';
import { formatTelemetry } from './lib/telemetry';
import { startSyntheticPreview } from './preview/synthetic';
import { TwinScene } from './twin/scene';
import { Hud, type AirId } from './ui/hud';
import { cueAt } from './vision/rehearsal';
import { createHandTracker, createPoseTracker, type HandTracker, type PoseTracker } from './vision/trackers';

type SourceName = 'camera' | 'synthetic' | 'idle';

function cameraMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Camera permission was blocked. The stream never starts, and nothing leaves this browser.';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'No camera was found. Synthetic preview still builds the twin on this machine.';
  }
  return error instanceof Error ? error.message : 'Could not open the camera.';
}

export class App {
  private readonly hud = new Hud();
  private readonly video = document.querySelector<HTMLVideoElement>('#mirror');
  private readonly scratch = document.createElement('canvas');
  private readonly depth = new DepthClient();
  private scene!: TwinScene;
  private hands: HandTracker | null = null;
  private pose: PoseTracker | null = null;
  private handsDetail = 'loading';
  private gestureState: GestureState = createGestureState();
  private gestureLabel: GestureName = 'none';
  private presence: PresenceState = createPresence();
  private lastLandmarks: Landmark[] | null = null;
  private focus: string | null = null;
  private cursor = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  private source: SourceName = 'idle';
  private running = false;
  private frozen = false;
  private grabbing = false;
  private sculpted = false;
  private parallaxOn = true;
  private mode: 'particles' | 'veil' = 'particles';
  private handMs = 0;
  private lastHandAt = 0;
  private nextHandAt = 0;
  private posePaused = false;
  private lastVideoTime = -1;
  private poseMs = 0;
  private lastPoseAt = 0;
  private lastSentAt = 0;
  private cooldown = 0;
  private handVisible = false;
  private depthMs: number | null = null;
  private depthTimes: number[] = [];
  private fpsTimes: number[] = [];
  private lastHud = 0;
  private rehearsalStart: number | null = null;

  async start() {
    if (!this.video) throw new Error('Missing video element');
    const canvas = document.querySelector<HTMLCanvasElement>('#stage');
    if (!canvas) throw new Error('Missing stage');
    this.scene = new TwinScene(canvas);
    this.scene.setReducedMotion(prefersReducedMotion());
    this.scene.setParallax(null);
    this.hud.bind({
      begin: () => void this.begin('camera'),
      preview: () => void this.begin('preview'),
      air: (id) => this.perform(id),
    });
    if (wantsDesktopNotice()) this.hud.showDesktopNote();
    window.addEventListener('resize', () => this.scene.resize(window.innerWidth, window.innerHeight));
    window.addEventListener('keydown', (event) => this.onKey(event));
    this.depth.onChange = () => {
      if (!this.running) this.hud.setIntroStatus(this.introLine());
    };
    this.depth.onFrame = (frame) => this.onDepth(frame);
    this.depth.init();
    this.hud.setIntroStatus(this.introLine());
    this.scene.resize(window.innerWidth, window.innerHeight);
    requestAnimationFrame(this.loop);
    if (new URLSearchParams(window.location.search).has('preview')) void this.begin('preview');
  }

  private loop = (now: number) => {
    requestAnimationFrame(this.loop);
    this.fpsTimes.push(now);
    while (this.fpsTimes.length && now - this.fpsTimes[0] > 1000) this.fpsTimes.shift();
    if (this.running && this.video && this.video.videoWidth > 0) {
      this.scene.setVideoAspect(this.video.videoWidth / this.video.videoHeight);
      this.trackHands(now);
      this.trackPose(now);
      this.maybeInfer(now);
      this.scene.tick(now);
    }
    if (now - this.lastHud > 200) {
      this.lastHud = now;
      if (this.running) this.hud.setTelemetry(this.telemetryLine());
      else this.hud.setIntroStatus(this.introLine());
    }
  };

  private async begin(kind: 'camera' | 'preview') {
    if (!this.video) return;
    this.hud.clearIntroError();
    this.hud.setBusy(true);
    try {
      const stream = kind === 'preview' ? startSyntheticPreview() : await openCamera();
      this.source = kind === 'preview' ? 'synthetic' : 'camera';
      this.video.srcObject = stream;
      this.video.muted = true;
      await this.video.play();
      this.scene.attachVideo(this.video);
      this.running = true;
      this.hud.showStage(this.source);
      void this.startVision();
    } catch (error) {
      this.hud.showIntroError(cameraMessage(error));
    } finally {
      this.hud.setBusy(false);
    }
  }

  private async startVision() {
    const handsCanvas = document.querySelector<HTMLCanvasElement>('#hand-gpu');
    const poseCanvas = document.querySelector<HTMLCanvasElement>('#pose-gpu');
    if (handsCanvas) {
      try {
        this.hands = await createHandTracker(handsCanvas);
        this.handsDetail = this.hands.delegate;
      } catch (error) {
        this.handsDetail = error instanceof Error ? error.message : 'unavailable';
      }
    }
    if (poseCanvas) {
      try {
        this.pose = await createPoseTracker(poseCanvas);
      } catch {
        this.pose = null;
      }
    }
  }

  private trackHands(now: number) {
    const landmarks = this.sampleLandmarks(now);
    const raw = classifyHand(landmarks);
    const step = stepGesture(this.gestureState, raw, now);
    this.gestureState = step.state;
    this.gestureLabel = step.committed === 'none' ? raw : step.committed;
    this.handVisible = Boolean(landmarks && landmarks.length >= 21);

    if (landmarks && this.video) {
      const cursorLm = cursorLandmark(landmarks, this.gestureLabel);
      const aspect = this.video.videoWidth / Math.max(1, this.video.videoHeight);
      const view = mirrorToView(cursorLm.x, cursorLm.y, aspect, window.innerWidth, window.innerHeight);
      this.cursor.x += (view.x - this.cursor.x) * 0.4;
      this.cursor.y += (view.y - this.cursor.y) * 0.4;
      this.focus = hitAirTarget(this.cursor.x, this.cursor.y, this.hud.airTargets());
      this.hud.setFocus(this.focus);
      this.hud.setCursor(this.cursor.x, this.cursor.y, this.gestureLabel, true);
    } else {
      this.focus = null;
      this.hud.setFocus(null);
      this.hud.setCursor(0, 0, 'none', false);
    }
    if (this.handVisible) this.cooldown = 0;
    this.applyEdge(step.edge);
  }

  private sampleLandmarks(now: number): Landmark[] | null {
    if (this.rehearsalStart != null) {
      const cue = cueAt(now - this.rehearsalStart);
      if (!cue) {
        this.rehearsalStart = null;
        this.hud.showToast('Rehearsal finished');
        return null;
      }
      const center = this.hud.buttonCenter(cue.aim);
      if (!center || !this.video) return null;
      const aspect = this.video.videoWidth / Math.max(1, this.video.videoHeight);
      const raw = viewToVideoNorm(center.x, center.y, aspect, window.innerWidth, window.innerHeight);
      return handAtCursor(cue.kind, raw);
    }
    if (!this.hands || !this.video || this.video.readyState < 2) return this.lastLandmarks;
    if (now < this.nextHandAt) return this.lastLandmarks;
    if (this.video.currentTime === this.lastVideoTime && now - this.lastHandAt < 70) return this.lastLandmarks;
    this.lastVideoTime = this.video.currentTime;
    const started = performance.now();
    try {
      const result = this.hands.landmarker.detectForVideo(this.video, now);
      this.lastLandmarks = result.landmarks[0] ?? null;
    } catch {
      this.lastLandmarks = null;
    }
    const elapsed = performance.now() - started;
    this.handMs = this.handMs === 0 ? elapsed : this.handMs * 0.8 + elapsed * 0.2;
    // A few milliseconds on a real GPU delegate. Software GL can take hundreds;
    // leave most of the frame budget for the sculpture.
    const gap = elapsed < 16 ? Math.max(32, elapsed * 1.2) : elapsed * 6;
    this.nextHandAt = performance.now() + gap;
    this.lastHandAt = now;
    return this.lastLandmarks;
  }

  private trackPose(now: number) {
    if (!this.parallaxOn) {
      this.scene.setParallax(null);
      return;
    }
    if (this.posePaused || !this.pose || !this.video || this.video.readyState < 2 || this.rehearsalStart != null) return;
    // Pose shares the same GL budget as hands. If hands are already slow, skip it.
    if (this.handMs > 24) {
      this.pausePose('Head parallax paused — hands are using the GPU budget');
      return;
    }
    if (now - this.lastPoseAt < 700) return;
    if (now - this.lastHandAt < 40) return;
    this.lastPoseAt = now;
    const started = performance.now();
    try {
      const result = this.pose.landmarker.detectForVideo(this.video, now);
      this.poseMs = performance.now() - started;
      if (this.poseMs > 40) {
        this.pausePose('Head parallax paused — pose was too slow here');
        return;
      }
      const nose = result.landmarks[0]?.[0];
      this.scene.setParallax(nose ? 0.5 - nose.x : 0);
    } catch {
      this.pose = null;
      this.scene.setParallax(null);
    }
  }

  private maybeInfer(now: number) {
    if (!this.video || this.frozen || this.grabbing || this.depth.inflight || this.depth.state !== 'ready') return;
    if (document.hidden || this.video.readyState < 2) return;
    if (now - this.lastSentAt < this.cooldown) return;
    const { w, h } = frameSize(this.video.videoWidth, this.video.videoHeight, INFER_LONG_SIDE);
    if (this.scratch.width !== w) this.scratch.width = w;
    if (this.scratch.height !== h) this.scratch.height = h;
    const context = this.scratch.getContext('2d', { alpha: false });
    if (!context) return;
    context.drawImage(this.video, 0, 0, w, h);
    this.grabbing = true;
    void createImageBitmap(this.scratch)
      .then((bitmap) => {
        this.grabbing = false;
        if (!this.video || this.frozen || this.depth.state !== 'ready') {
          bitmap.close();
          return;
        }
        const grid = gridSize(this.video.videoWidth, this.video.videoHeight);
        if (this.depth.submit(bitmap, grid.cols, grid.rows)) this.lastSentAt = performance.now();
      })
      .catch(() => {
        this.grabbing = false;
      });
  }

  private onDepth(frame: DepthFrame) {
    const sample = isPersonPresent(frame.depth, this.handVisible);
    this.presence = stepPresence(this.presence, sample);
    this.cooldown = cooldownAfterInfer(this.presence.present, frame.ms);
    this.scene.setFadeMs(Math.max(90, (this.presence.present ? 56 : 520) * 0.8));
    this.scene.pushDepth(frame.depth, frame.cols, frame.rows);
    this.depthMs = frame.ms;
    const now = performance.now();
    this.depthTimes.push(now);
    this.depthTimes = this.depthTimes.filter((stamp) => now - stamp < 1000);
    if (!this.sculpted) {
      this.sculpted = true;
      this.hud.markSculpted();
    }
  }

  private applyEdge(edge: GestureName | null) {
    if (edge === 'fist') this.toggleFreeze();
    if (edge === 'pinch' && this.focus) this.perform(this.focus as AirId);
  }

  private perform(id: AirId) {
    if (!this.running && id !== 'rehearse') return;
    if (id === 'freeze') this.toggleFreeze();
    else if (id === 'mode') this.toggleMode();
    else if (id === 'parallax') {
      this.parallaxOn = !this.parallaxOn;
      if (this.parallaxOn) this.posePaused = false;
      this.hud.setParallax(this.parallaxOn);
      if (!this.parallaxOn) this.scene.setParallax(null);
    } else if (id === 'save') this.save();
    else this.rehearse();
  }

  private pausePose(message: string) {
    if (this.posePaused) return;
    this.posePaused = true;
    this.parallaxOn = false;
    this.hud.setParallax(false);
    this.scene.setParallax(null);
    this.hud.showToast(message);
  }

  private toggleFreeze() {
    if (!this.running) return;
    this.frozen = !this.frozen;
    this.scene.setFrozen(this.frozen);
    this.hud.setFrozen(this.frozen);
    this.hud.flash();
    this.hud.showToast(this.frozen ? 'Twin held' : 'Twin live');
  }

  private toggleMode() {
    this.mode = this.mode === 'particles' ? 'veil' : 'particles';
    this.scene.setMode(this.mode);
    this.hud.setMode(this.mode);
  }

  private save() {
    const href = this.scene.capture();
    const link = document.createElement('a');
    link.href = href;
    link.download = 'depth-twin.png';
    link.click();
    this.hud.showToast('Still saved on this device');
  }

  private rehearse() {
    if (!this.running) return;
    this.rehearsalStart = performance.now();
    this.hud.showToast('Rehearsal — scripted hand, real gesture path');
  }

  private onKey(event: KeyboardEvent) {
    if (!this.running || event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === 'f') this.toggleFreeze();
    else if (key === 'v') this.toggleMode();
    else if (key === 'h') this.perform('parallax');
    else if (key === 's') this.save();
    else if (key === 'g') this.rehearse();
  }

  private introLine(): string {
    if (this.depth.state === 'ready') {
      return `Depth model ready · ${this.depth.backend} · ${this.depth.dtype}. First download is cached in this browser.`;
    }
    if (this.depth.state === 'error') return this.depth.detail;
    return `Warming depth model… ${this.depth.detail}`;
  }

  private telemetryLine(): string {
    const now = performance.now();
    const depthFps = this.depthTimes.filter((stamp) => now - stamp < 1000).length;
    return formatTelemetry({
      fps: this.fpsTimes.length,
      depthFps,
      depthMs: this.depthMs,
      backend: this.depth.backend || '—',
      dtype: this.depth.dtype,
      model:
        this.depth.state === 'ready'
          ? `model ready`
          : `model ${trimDetail(this.depth.detail)}`,
      gesture: this.rehearsalStart != null ? `${this.gestureLabel} · rehearsal` : this.gestureLabel,
      cadence: this.presence.present ? 'cadence live' : 'cadence idle',
      hands: this.hands ? `hands ${this.handMs.toFixed(1)} ms ${this.hands.delegate}` : `hands ${this.handsDetail}`,
      pose: this.posePaused
        ? this.poseMs > 0
          ? `head paused ${Math.round(this.poseMs)} ms`
          : 'head paused'
        : this.pose && this.parallaxOn
          ? `head ${this.poseMs.toFixed(0)} ms ${this.pose.delegate}`
          : 'head off',
      source: this.source === 'synthetic' ? 'source synthetic' : 'source camera',
      frozen: this.frozen,
    });
  }
}

function trimDetail(detail: string): string {
  const clean = detail.replace(/\s+/g, ' ').trim();
  return clean.length > 90 ? `${clean.slice(0, 87)}…` : clean;
}

function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return Promise.reject(new Error('This browser has no camera API. Use the synthetic preview.'));
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
  });
}
