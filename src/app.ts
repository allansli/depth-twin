import { DepthClient, type DepthFrame } from './depth/depthClient';
import { cooldownAfterInfer, createPresence, isPersonPresent, presenceEnergy, stepPresence, type PresenceState } from './lib/cadence';
import { captureFilename } from './lib/capture';
import { INFER_LONG_SIDE } from './lib/constants';
import { mirrorToView, viewToVideoNorm } from './lib/coverMap';
import { frameSize, gridSize } from './lib/depthMath';
import { prefersReducedMotion, wantsDesktopNotice } from './lib/device';
import { readFlags, type LaunchFlags } from './lib/flags';
import {
  createDwell,
  createGestureState,
  cursorLandmark,
  handAtCursor,
  hitAirTarget,
  mapGestureCategory,
  resolveGesture,
  stepDwell,
  stepGesture,
  type DwellState,
  type GestureName,
  type GestureState,
  type Landmark,
} from './lib/gestures';
import { isMaterialId, materialLabel, nextMaterial, type MaterialId } from './lib/materials';
import { absorbMotion, decayField, stampDisc, stampSegment, type PaintPoint } from './lib/paint';
import { formatTelemetry } from './lib/telemetry';
import { syntheticPersonDepth } from './preview/depthField';
import { startSyntheticPreview } from './preview/synthetic';
import { TwinScene } from './twin/scene';
import { Hud, type AirId } from './ui/hud';
import { cueAt } from './vision/rehearsal';
import {
  createGestureTracker,
  createHandTracker,
  createPoseTracker,
  type GestureTracker,
  type HandTracker,
  type PoseTracker,
} from './vision/trackers';

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
  private flags: LaunchFlags = readFlags('');
  private gestures: GestureTracker | null = null;
  private hands: HandTracker | null = null;
  private pose: PoseTracker | null = null;
  private handsDetail = 'loading';
  private recognizerLive = false;
  private gestureState: GestureState = createGestureState();
  private dwell: DwellState = createDwell();
  private gestureLabel: GestureName = 'none';
  private lastRaw: GestureName = 'none';
  private presence: PresenceState = createPresence();
  private energy = 0;
  private lastLandmarks: Landmark[] | null = null;
  private focus: string | null = null;
  private cursor = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  private source: SourceName = 'idle';
  private running = false;
  private look = false;
  private frozen = false;
  private paintOn = false;
  private split = false;
  private material: MaterialId = 'particles';
  private grabbing = false;
  private sculpted = false;
  private handMs = 0;
  private lastHandAt = 0;
  private nextHandAt = 0;
  private visionStamp = 0;
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
  private lastLook = 0;
  private rehearsalStart: number | null = null;
  private paintField = new Uint8Array(160 * 90);
  private paintCols = 160;
  private paintRows = 90;
  private lastDepth: Uint8Array | null = null;
  private depthPrimed = false;
  private lastStamp: PaintPoint | null = null;

  async start() {
    if (!this.video) throw new Error('Missing video element');
    const canvas = document.querySelector<HTMLCanvasElement>('#stage');
    if (!canvas) throw new Error('Missing stage');
    this.flags = readFlags(window.location.search);
    this.scene = new TwinScene(canvas);
    this.scene.setReducedMotion(prefersReducedMotion());
    this.scene.setParallax(null);
    if (isMaterialId(this.flags.material)) {
      this.material = this.flags.material;
      this.scene.setMaterial(this.material);
    }
    this.hud.setMaterial(materialLabel(this.material));
    this.hud.setDev(this.flags.dev);
    this.hud.bind({
      begin: () => void this.begin('camera'),
      preview: () => void this.begin('preview'),
      air: (id) => this.perform(id),
    });
    if (wantsDesktopNotice() && !this.flags.shot) this.hud.showDesktopNote();
    window.addEventListener('resize', () => this.scene.resize(window.innerWidth, window.innerHeight));
    window.addEventListener('keydown', (event) => this.onKey(event));
    this.depth.onChange = () => {
      if (!this.running && !this.look) this.hud.setIntroStatus(this.introLine());
    };
    this.depth.onFrame = (frame) => this.onDepth(frame);
    this.depth.init();
    this.hud.setIntroStatus(this.introLine());
    this.scene.resize(window.innerWidth, window.innerHeight);
    requestAnimationFrame(this.loop);
    if (this.flags.look) this.beginLook();
    else if (this.flags.preview) void this.begin('preview');
  }

  private loop = (now: number) => {
    requestAnimationFrame(this.loop);
    this.fpsTimes.push(now);
    while (this.fpsTimes.length && now - this.fpsTimes[0] > 1000) this.fpsTimes.shift();
    if (this.look) {
      this.tickLook(now);
      this.scene.tick(now);
    } else if (this.running && this.video && this.video.videoWidth > 0) {
      this.scene.setVideoAspect(this.video.videoWidth / this.video.videoHeight);
      this.trackHands(now);
      this.trackPose(now);
      this.maybeInfer(now);
      this.paintTick();
      this.scene.tick(now);
    }
    if (now - this.lastHud > 200) {
      this.lastHud = now;
      if (this.running || this.look) this.hud.setTelemetry(this.telemetryLine());
      else this.hud.setIntroStatus(this.introLine());
    }
  };

  private beginLook() {
    this.look = true;
    this.scene.setVideoAspect(16 / 9);
    const depth = syntheticPersonDepth(160, 90, 0);
    this.scene.pushDepth(depth, 160, 90);
    this.scene.revealNow();
    this.energy = presenceEnergy(depth);
    this.scene.setPresence(this.energy);
    document.body.classList.add('is-look', 'is-sculpted');
    if (this.flags.shot) document.body.classList.add('is-shot');
    else this.hud.showStage('look', this.flags.dev);
  }

  private tickLook(now: number) {
    if (now - this.lastLook < 80) return;
    this.lastLook = now;
    const depth = syntheticPersonDepth(160, 90, now / 1000);
    this.scene.pushDepth(depth, 160, 90);
    this.energy += (presenceEnergy(depth) - this.energy) * 0.2;
    this.scene.setPresence(this.energy);
  }

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
      this.hud.showStage(this.source, this.flags.dev);
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
        this.gestures = await createGestureTracker(handsCanvas);
        this.recognizerLive = true;
        this.handsDetail = `gesture ${this.gestures.delegate}`;
      } catch (error) {
        this.recognizerLive = false;
        try {
          this.hands = await createHandTracker(handsCanvas);
          this.handsDetail = `landmarks ${this.hands.delegate}`;
        } catch (fallback) {
          const reason = fallback instanceof Error ? fallback.message : error instanceof Error ? error.message : 'unavailable';
          this.handsDetail = reason;
        }
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
    const sample = this.sampleHands(now);
    const raw = sample.gesture;
    const landmarks = sample.landmarks;
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
      const dwell = stepDwell(this.dwell, this.focus, raw === 'point', now);
      this.dwell = dwell.state;
      if (dwell.fire) this.perform(dwell.fire as AirId);
      this.hud.setFocus(this.focus, dwell.progress);
      this.hud.setCursor(this.cursor.x, this.cursor.y, this.gestureLabel, true, raw === 'point' ? dwell.progress : 0);
    } else {
      this.dwell = stepDwell(this.dwell, null, false, now).state;
      this.focus = null;
      this.hud.setFocus(null, 0);
      this.hud.setCursor(0, 0, 'none', false, 0);
    }
    if (this.handVisible) this.cooldown = 0;
    this.applyEdge(step.edge);
  }

  private sampleHands(now: number): { landmarks: Landmark[] | null; gesture: GestureName } {
    if (this.rehearsalStart != null) return this.sampleRehearsal(now);
    if ((!this.gestures && !this.hands) || !this.video || this.video.readyState < 2) {
      return { landmarks: this.lastLandmarks, gesture: this.lastRaw };
    }
    if (now < this.nextHandAt) return { landmarks: this.lastLandmarks, gesture: this.lastRaw };
    if (this.video.currentTime === this.lastVideoTime && now - this.lastHandAt < 70) {
      return { landmarks: this.lastLandmarks, gesture: this.lastRaw };
    }
    this.lastVideoTime = this.video.currentTime;
    const started = performance.now();
    try {
      if (this.gestures) {
        const result = this.gestures.recognizer.recognizeForVideo(this.video, this.stamp(now));
        const top = result.gestures[0]?.[0];
        const lm = result.landmarks[0];
        this.lastLandmarks = lm && lm.length >= 21 ? (lm as Landmark[]) : null;
        this.lastRaw = resolveGesture(
          mapGestureCategory(top?.categoryName, top?.score ?? 0),
          this.lastLandmarks,
          true,
        );
      } else if (this.hands) {
        const result = this.hands.landmarker.detectForVideo(this.video, this.stamp(now));
        const lm = result.landmarks[0];
        this.lastLandmarks = lm && lm.length >= 21 ? (lm as Landmark[]) : null;
        this.lastRaw = resolveGesture('none', this.lastLandmarks, false);
      }
    } catch {
      this.lastLandmarks = null;
      this.lastRaw = 'none';
    }
    const elapsed = performance.now() - started;
    this.handMs = this.handMs === 0 ? elapsed : this.handMs * 0.8 + elapsed * 0.2;
    const gap = elapsed < 16 ? Math.max(32, elapsed * 1.2) : elapsed * 6;
    this.nextHandAt = performance.now() + gap;
    this.lastHandAt = now;
    return { landmarks: this.lastLandmarks, gesture: this.lastRaw };
  }

  private sampleRehearsal(now: number): { landmarks: Landmark[] | null; gesture: GestureName } {
    const cue = cueAt(now - (this.rehearsalStart ?? now));
    if (!cue) {
      this.rehearsalStart = null;
      this.hud.showToast('Rehearsal finished');
      this.lastLandmarks = null;
      this.lastRaw = 'none';
      return { landmarks: null, gesture: 'none' };
    }
    const center = this.hud.buttonCenter(cue.aim);
    if (!center || !this.video) return { landmarks: this.lastLandmarks, gesture: this.lastRaw };
    const aspect = this.video.videoWidth / Math.max(1, this.video.videoHeight);
    const raw = viewToVideoNorm(center.x, center.y, aspect, window.innerWidth, window.innerHeight);
    const landmarks = handAtCursor(cue.kind, raw);
    const gesture = resolveGesture('none', landmarks, false);
    this.lastLandmarks = landmarks;
    this.lastRaw = gesture;
    return { landmarks, gesture };
  }

  private stamp(now: number): number {
    const next = Math.max(this.visionStamp + 1, Math.round(now));
    this.visionStamp = next;
    return next;
  }

  private trackPose(now: number) {
    if (this.posePaused || !this.pose || !this.video || this.video.readyState < 2 || this.rehearsalStart != null) return;
    if (this.handMs > 24) {
      this.pausePose('Head parallax paused — hands are using the GPU budget');
      return;
    }
    if (now - this.lastPoseAt < 700) return;
    if (now - this.lastHandAt < 40) return;
    this.lastPoseAt = now;
    const started = performance.now();
    try {
      const result = this.pose.landmarker.detectForVideo(this.video, this.stamp(now));
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
    const resized = frame.cols !== this.paintCols || frame.rows !== this.paintRows;
    this.ensurePaint(frame.cols, frame.rows);
    if (this.paintOn && this.depthPrimed && !resized && this.lastDepth && this.lastDepth.length === frame.depth.length) {
      absorbMotion(this.paintField, this.lastDepth, frame.depth, 0.55);
    }
    if (!this.lastDepth || this.lastDepth.length !== frame.depth.length) this.lastDepth = new Uint8Array(frame.depth.length);
    this.lastDepth.set(frame.depth);
    this.depthPrimed = true;
    this.energy += (presenceEnergy(frame.depth) - this.energy) * 0.35;
    this.scene.setPresence(this.energy);

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

  private paintTick() {
    decayField(this.paintField, this.paintOn ? 0.972 : 0.86);
    const landmarks = this.lastLandmarks;
    if (this.paintOn && landmarks && landmarks.length >= 21) {
      const tip = landmarks[8];
      const palm = landmarks[9];
      stampDisc(this.paintField, this.paintCols, this.paintRows, tip.x, tip.y, 0.03, 150);
      stampDisc(this.paintField, this.paintCols, this.paintRows, palm.x, palm.y, 0.046, 70);
      const next = { u: tip.x, v: tip.y };
      if (this.lastStamp) {
        stampSegment(this.paintField, this.paintCols, this.paintRows, this.lastStamp, next, 0.022, 90);
      }
      this.lastStamp = next;
    } else if (!landmarks) {
      this.lastStamp = null;
    }
    this.scene.setPaint(this.paintField, this.paintCols, this.paintRows);
  }

  private ensurePaint(cols: number, rows: number) {
    if (this.paintCols === cols && this.paintRows === rows && this.paintField.length === cols * rows) return;
    this.paintField = new Uint8Array(cols * rows);
    this.paintCols = cols;
    this.paintRows = rows;
    this.lastDepth = null;
    this.depthPrimed = false;
  }

  private applyEdge(edge: GestureName | null) {
    if (edge === 'fist') this.toggleFreeze();
    else if (edge === 'victory') this.cycleMaterial();
    else if (edge === 'thumb_up') this.capture();
    else if (edge === 'pinch' && !this.recognizerLive && this.focus) this.perform(this.focus as AirId);
  }

  private perform(id: AirId) {
    const live = this.running || this.look;
    if (!live && id !== 'rehearse') return;
    if (id === 'material') this.cycleMaterial();
    else if (id === 'paint') this.togglePaint();
    else if (id === 'split') this.toggleSplit();
    else if (id === 'hold') this.toggleFreeze();
    else if (id === 'capture') this.capture();
    else if (this.flags.dev) this.rehearse();
  }

  private pausePose(message: string) {
    if (this.posePaused) return;
    this.posePaused = true;
    this.scene.setParallax(null);
    if (this.flags.dev) this.hud.showToast(message);
  }

  private toggleFreeze() {
    if (!this.running && !this.look) return;
    this.frozen = !this.frozen;
    this.scene.setFrozen(this.frozen);
    this.hud.setFrozen(this.frozen);
    this.hud.showToast(this.frozen ? 'Twin held' : 'Twin live');
  }

  private cycleMaterial() {
    this.material = nextMaterial(this.material);
    this.scene.setMaterial(this.material);
    const label = materialLabel(this.material);
    this.hud.setMaterial(label);
    this.hud.showToast(label);
  }

  private togglePaint() {
    this.paintOn = !this.paintOn;
    this.hud.setPaint(this.paintOn);
    this.hud.showToast(this.paintOn ? 'Paint on' : 'Paint off');
  }

  private toggleSplit() {
    this.split = !this.split;
    this.hud.setSplit(this.split);
    this.hud.showToast(this.split ? 'Split mirror' : 'Full twin');
  }

  private capture() {
    if (!this.running && !this.look) return;
    this.hud.flash();
    try {
      const href = this.scene.captureStill(this.split ? this.video : null, this.split);
      const link = document.createElement('a');
      link.href = href;
      link.download = captureFilename(new Date());
      link.click();
      this.hud.showToast('Still saved on this device');
    } catch {
      this.hud.showToast('Could not save the still');
    }
  }

  private rehearse() {
    if (!this.running || !this.video) return;
    this.rehearsalStart = performance.now();
    this.hud.showToast('Rehearsal — scripted hand, real gesture path');
  }

  private onKey(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    if (!this.running && !this.look) return;
    const key = event.key.toLowerCase();
    if (key === 'm') this.cycleMaterial();
    else if (key === 'p') this.togglePaint();
    else if (key === 's') this.toggleSplit();
    else if (key === 'h' || key === 'f') this.toggleFreeze();
    else if (key === 'c') this.capture();
    else if (key === 'g' && this.flags.dev) this.rehearse();
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
    const hands = this.gestures
      ? `gesture ${this.handMs.toFixed(1)} ms ${this.gestures.delegate}`
      : this.hands
        ? `hands ${this.handMs.toFixed(1)} ms ${this.hands.delegate}`
        : `hands ${this.handsDetail}`;
    return formatTelemetry({
      fps: this.fpsTimes.length,
      depthFps,
      depthMs: this.depthMs,
      backend: this.depth.backend || '—',
      dtype: this.depth.dtype,
      model: this.depth.state === 'ready' ? 'model ready' : `model ${trimDetail(this.depth.detail)}`,
      gesture: this.rehearsalStart != null ? `${this.gestureLabel} · rehearsal` : this.gestureLabel,
      cadence: this.presence.present ? 'cadence live' : 'cadence idle',
      hands,
      pose: this.posePaused
        ? this.poseMs > 0
          ? `head paused ${Math.round(this.poseMs)} ms`
          : 'head paused'
        : this.pose
          ? `head ${this.poseMs.toFixed(0)} ms ${this.pose.delegate}`
          : 'head off',
      source: this.look ? 'source look' : this.source === 'synthetic' ? 'source synthetic' : 'source camera',
      frozen: this.frozen,
      material: materialLabel(this.material),
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
