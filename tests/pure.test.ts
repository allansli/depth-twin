import { describe, expect, it } from 'vitest';
import { cooldownAfterInfer, createPresence, isPersonPresent, presenceEnergy, stepPresence } from '../src/lib/cadence';
import { captureFilename, flipRgba, STILL_H, STILL_W } from '../src/lib/capture';
import { coverRect, mirrorToView, viewToVideoNorm } from '../src/lib/coverMap';
import { frameSize, gridSize, normalizeDepth } from '../src/lib/depthMath';
import { readFlags } from '../src/lib/flags';
import {
  classifyHand,
  createDwell,
  createGestureState,
  cursorLandmark,
  DWELL_MS,
  handAtCursor,
  hitAirTarget,
  mapGestureCategory,
  resolveGesture,
  stepDwell,
  stepGesture,
  synthesizeHand,
} from '../src/lib/gestures';
import { isMaterialId, MATERIALS, materialLabel, nextMaterial } from '../src/lib/materials';
import { absorbMotion, decayField, stampDisc } from '../src/lib/paint';
import { syntheticPersonDepth } from '../src/preview/depthField';
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
  it('classifies the air poses, including victory and thumb up', () => {
    expect(classifyHand(synthesizeHand('open'))).toBe('open');
    expect(classifyHand(synthesizeHand('point'))).toBe('point');
    expect(classifyHand(synthesizeHand('pinch'))).toBe('pinch');
    expect(classifyHand(synthesizeHand('fist'))).toBe('fist');
    expect(classifyHand(synthesizeHand('victory'))).toBe('victory');
    expect(classifyHand(synthesizeHand('thumb_up'))).toBe('thumb_up');
    expect(classifyHand(null)).toBe('none');
  });

  it('does not treat a loose point as a pinch', () => {
    const hand = synthesizeHand('point');
    const tip = hand[8];
    hand[4] = { x: tip.x + 0.06, y: tip.y, z: 0 };
    expect(classifyHand(hand)).toBe('point');
  });

  it('maps MediaPipe gesture categories and ignores weak or unused ones', () => {
    expect(mapGestureCategory('Open_Palm', 0.9)).toBe('open');
    expect(mapGestureCategory('Pointing_Up', 0.8)).toBe('point');
    expect(mapGestureCategory('Closed_Fist', 0.7)).toBe('fist');
    expect(mapGestureCategory('Victory', 0.66)).toBe('victory');
    expect(mapGestureCategory('Thumb_Up', 0.9)).toBe('thumb_up');
    expect(mapGestureCategory('Thumb_Down', 0.99)).toBe('none');
    expect(mapGestureCategory('ILoveYou', 0.99)).toBe('none');
    expect(mapGestureCategory('None', 0.99)).toBe('none');
    expect(mapGestureCategory('Closed_Fist', 0.2)).toBe('none');
    expect(mapGestureCategory(undefined, 1)).toBe('none');
  });

  it('trusts the recognizer over a conflicting geometric pinch', () => {
    const pinchLike = synthesizeHand('pinch');
    expect(resolveGesture('fist', pinchLike, true)).toBe('fist');
    expect(resolveGesture('none', pinchLike, true)).toBe('none');
    expect(resolveGesture('none', pinchLike, false)).toBe('pinch');
    expect(resolveGesture('victory', synthesizeHand('open'), true)).toBe('victory');
    expect(resolveGesture('thumb_up', synthesizeHand('fist'), true)).toBe('thumb_up');
  });

  it('confirms a pointed control after a dwell, once', () => {
    let state = stepDwell(createDwell(0), 'material', true, 0).state;
    let step = stepDwell(state, 'material', true, DWELL_MS - 1);
    expect(step.fire).toBeNull();
    expect(step.progress).toBeGreaterThan(0.9);
    step = stepDwell(step.state, 'material', true, DWELL_MS);
    expect(step.fire).toBe('material');
    step = stepDwell(step.state, 'material', true, DWELL_MS + 200);
    expect(step.fire).toBeNull();
    step = stepDwell(step.state, 'paint', true, DWELL_MS + 220);
    expect(step.fire).toBeNull();
    expect(step.progress).toBeLessThan(0.1);
    step = stepDwell(step.state, 'paint', true, DWELL_MS + 220 + DWELL_MS);
    expect(step.fire).toBe('paint');
  });

  it('keeps a dwell through a one-frame dropout', () => {
    let state = stepDwell(createDwell(0), 'hold', true, 0).state;
    state = stepDwell(state, 'hold', true, 200).state;
    const dipped = stepDwell(state, null, false, 250);
    expect(dipped.progress).toBeGreaterThan(0.4);
    expect(dipped.state.target).toBe('hold');
    const gone = stepDwell(dipped.state, null, false, 400);
    expect(gone.state.target).toBeNull();
    expect(gone.progress).toBe(0);
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

describe('materials', () => {
  it('cycles the wow set and does not keep veil', () => {
    expect(MATERIALS).toEqual(['particles', 'holo', 'metal', 'wire', 'ember']);
    expect(nextMaterial('particles')).toBe('holo');
    expect(nextMaterial('ember')).toBe('particles');
    expect(materialLabel('holo')).toBe('Holo');
    expect(materialLabel('metal')).toBe('Metal');
    expect(isMaterialId('wire')).toBe(true);
    expect(isMaterialId('veil')).toBe(false);
  });
});

describe('paint and presence', () => {
  it('stamps a disc, decays it, and absorbs depth motion', () => {
    const field = new Uint8Array(16);
    stampDisc(field, 4, 4, 0.5, 0.5, 0.2, 200);
    expect(field[2 * 4 + 2]).toBeGreaterThan(80);
    const peak = field[2 * 4 + 2];
    decayField(field, 0.5);
    expect(field[2 * 4 + 2]).toBeLessThan(peak);
    const paint = new Uint8Array(4);
    absorbMotion(paint, new Uint8Array([0, 0, 0, 0]), new Uint8Array([0, 80, 0, 0]), 1);
    expect(paint[1]).toBeGreaterThan(0);
    expect(paint[0]).toBe(0);
  });

  it('raises energy when the depth field comes closer', () => {
    expect(presenceEnergy(new Uint8Array(80).fill(10))).toBe(0);
    expect(presenceEnergy(new Uint8Array(80).fill(230))).toBe(1);
    expect(presenceEnergy(new Uint8Array(0))).toBe(0);
  });

  it('draws a brighter head than the empty corner', () => {
    const depth = syntheticPersonDepth(160, 90, 0);
    const head = depth[Math.floor(0.36 * 90) * 160 + 80];
    expect(head).toBeGreaterThan(depth[0] + 40);
  });
});

describe('capture and flags', () => {
  it('names a branded still and flips GL rows', () => {
    expect(STILL_W).toBe(1920);
    expect(STILL_H).toBe(1080);
    expect(captureFilename(new Date(2026, 10, 6, 3, 4, 5))).toBe('depth-twin-20261106-030405.png');
    const src = new Uint8Array([1, 0, 0, 255, 0, 2, 0, 255]);
    const flipped = flipRgba(src, 1, 2);
    expect(Array.from(flipped)).toEqual([0, 2, 0, 255, 1, 0, 0, 255]);
  });

  it('reads launch flags', () => {
    expect(readFlags('?dev=1&preview=1')).toMatchObject({ dev: true, preview: true, look: false });
    expect(readFlags('?look=1&shot=1&material=holo').material).toBe('holo');
    expect(readFlags('').dev).toBe(false);
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

  it('walks the rehearsal from palm through dwell, victory, fist, and thumb up', () => {
    expect(cueAt(100)?.kind).toBe('open');
    expect(cueAt(100)?.aim).toBe('material');
    expect(cueAt(800)?.kind).toBe('point');
    expect(cueAt(1500)?.kind).toBe('victory');
    expect(cueAt(2100)?.kind).toBe('fist');
    expect(cueAt(2100)?.aim).toBe('hold');
    expect(cueAt(3000)?.kind).toBe('thumb_up');
    expect(cueAt(3000)?.aim).toBe('capture');
    expect(cueAt(REHEARSAL_MS + 10)).toBeNull();
  });
});
