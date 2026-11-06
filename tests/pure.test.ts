import { describe, expect, it } from 'vitest';
import { cooldownAfterInfer, createPresence, isPersonPresent, stepPresence } from '../src/lib/cadence';
import { coverRect, mirrorToView, viewToVideoNorm } from '../src/lib/coverMap';
import { frameSize, gridSize, normalizeDepth } from '../src/lib/depthMath';
import {
  classifyHand,
  createGestureState,
  cursorLandmark,
  handAtCursor,
  hitAirTarget,
  stepGesture,
  synthesizeHand,
} from '../src/lib/gestures';
import { formatTelemetry } from '../src/lib/telemetry';
import { cueAt, REHEARSAL_MS } from '../src/vision/rehearsal';

describe('depth math', () => {
  it('maps larger depth values to brighter bytes', () => {
    const src = new Float32Array([0, 0, 50, 100, 100]);
    const out = normalizeDepth(src, 5, 1, 5, 1);
    expect(out[0]).toBeLessThan(out[2]);
    expect(out[2]).toBeLessThan(out[4]);
    expect(out[4]).toBe(255);
  });

  it('downsamples the center of a ramp', () => {
    const src = Float32Array.from({ length: 10 }, (_, index) => index * 10);
    const out = normalizeDepth(src, 10, 1, 1, 1);
    expect(out[0]).toBeGreaterThan(80);
    expect(out[0]).toBeLessThan(180);
  });

  it('sizes frames and grids on the video aspect', () => {
    expect(frameSize(1280, 720, 320)).toEqual({ w: 320, h: 180 });
    expect(gridSize(1280, 720, 160)).toEqual({ cols: 160, rows: 90 });
    expect(gridSize(10, 10, 100).cols % 4).toBe(0);
  });
});

describe('cadence', () => {
  it('aims near 18 fps when the person is present and backs off when idle', () => {
    expect(cooldownAfterInfer(true, 30)).toBe(26);
    expect(cooldownAfterInfer(true, 90)).toBe(0);
    expect(cooldownAfterInfer(false, 80)).toBe(440);
  });

  it('treats a hand or a near mass as presence, with a short streak', () => {
    expect(isPersonPresent(new Uint8Array(20).fill(10), true)).toBe(true);
    expect(isPersonPresent(new Uint8Array(20).fill(10), false)).toBe(false);
    expect(isPersonPresent(new Uint8Array(20).fill(220), false)).toBe(true);
    let state = createPresence();
    state = stepPresence(state, true);
    state = stepPresence(state, true);
    expect(state.present).toBe(false);
    state = stepPresence(state, true);
    expect(state.present).toBe(true);
  });
});

describe('gestures', () => {
  it('classifies the four air poses', () => {
    expect(classifyHand(synthesizeHand('open'))).toBe('open');
    expect(classifyHand(synthesizeHand('point'))).toBe('point');
    expect(classifyHand(synthesizeHand('pinch'))).toBe('pinch');
    expect(classifyHand(synthesizeHand('fist'))).toBe('fist');
    expect(classifyHand(null)).toBe('none');
  });

  it('commits a gesture only after it holds, and emits one edge', () => {
    let state = createGestureState(0);
    let step = stepGesture(state, 'fist', 20);
    state = step.state;
    expect(step.edge).toBeNull();
    step = stepGesture(state, 'fist', 200);
    expect(step.committed).toBe('fist');
    expect(step.edge).toBe('fist');
    step = stepGesture(step.state, 'fist', 400);
    expect(step.edge).toBeNull();
  });

  it('places the cursor landmark on the requested point', () => {
    const hand = handAtCursor('point', { x: 0.42, y: 0.61 });
    const cursor = cursorLandmark(hand, 'point');
    expect(cursor.x).toBeCloseTo(0.42, 5);
    expect(cursor.y).toBeCloseTo(0.61, 5);
  });

  it('hits the nearest padded control', () => {
    const targets = [
      { id: 'mode', left: 100, top: 100, right: 180, bottom: 140 },
      { id: 'save', left: 300, top: 100, right: 380, bottom: 140 },
    ];
    expect(hitAirTarget(110, 120, targets)).toBe('mode');
    expect(hitAirTarget(190, 120, targets)).toBe('mode');
    expect(hitAirTarget(10, 10, targets)).toBeNull();
  });
});

describe('cover mapping', () => {
  it('mirrors a raw webcam coordinate into the cover rect', () => {
    const view = mirrorToView(0, 0.5, 16 / 9, 1600, 900);
    expect(view.x).toBeGreaterThan(1500);
    expect(view.y).toBeCloseTo(450, 0);
  });

  it('round-trips a point inside the cover rect', () => {
    const aspect = 16 / 9;
    const rect = coverRect(aspect, 1280, 800);
    const x = rect.x + rect.width * 0.3;
    const y = rect.y + rect.height * 0.4;
    const raw = viewToVideoNorm(x, y, aspect, 1280, 800);
    const back = mirrorToView(raw.x, raw.y, aspect, 1280, 800);
    expect(back.x).toBeCloseTo(x, 4);
    expect(back.y).toBeCloseTo(y, 4);
  });
});

describe('telemetry and rehearsal', () => {
  it('prints the live numbers it was given', () => {
    const line = formatTelemetry({
      fps: 58.2,
      depthFps: 16.4,
      depthMs: 61.2,
      backend: 'webgpu',
      dtype: 'fp16',
      model: 'model ready',
      gesture: 'point',
      cadence: 'cadence live',
      hands: 'hands 4.2 ms GPU',
      pose: 'head off',
      source: 'source camera',
      frozen: false,
    });
    expect(line).toContain('58 fps');
    expect(line).toContain('depth 16 fps · 61 ms');
    expect(line).toContain('webgpu · fp16');
    expect(line).toContain('gesture point');
    expect(line).toContain('live');
  });

  it('walks the rehearsal from palm to fist', () => {
    expect(cueAt(100)?.kind).toBe('open');
    expect(cueAt(1000)?.kind).toBe('pinch');
    expect(cueAt(2500)?.kind).toBe('fist');
    expect(cueAt(REHEARSAL_MS + 10)).toBeNull();
  });
});
