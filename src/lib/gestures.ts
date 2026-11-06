export type GestureName = 'none' | 'point' | 'open' | 'pinch' | 'fist';
export type HandKind = 'open' | 'fist' | 'point' | 'pinch';

export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

const FINGERS: Array<[number, number]> = [
  [8, 6],
  [12, 10],
  [16, 14],
  [20, 18],
];

export const GESTURE_HOLD_MS: Record<GestureName, number> = {
  none: 120,
  point: 70,
  open: 70,
  pinch: 45,
  fist: 110,
};

export interface GestureState {
  raw: GestureName;
  rawSince: number;
  committed: GestureName;
}

export interface GestureStep {
  state: GestureState;
  committed: GestureName;
  edge: GestureName | null;
}

export function landmarkDistance(a: Landmark, b: Landmark): number {
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(a.x - b.x, a.y - b.y, dz);
}

export function isFingerExtended(lm: Landmark[], tip: number, pip: number): boolean {
  return landmarkDistance(lm[tip], lm[0]) > landmarkDistance(lm[pip], lm[0]) * 1.15;
}

export function classifyHand(lm: Landmark[] | null | undefined): GestureName {
  if (!lm || lm.length < 21) return 'none';
  const extended = FINGERS.map(([tip, pip]) => isFingerExtended(lm, tip, pip));
  const [index, middle, ring, pinky] = extended;
  const extendedCount = extended.filter(Boolean).length;
  const pinchDist = landmarkDistance(lm[4], lm[8]);
  const othersCurled = !middle && !ring && !pinky;

  if (extendedCount === 0) return 'fist';
  if (pinchDist < 0.07 && othersCurled) return 'pinch';
  if (index && othersCurled) return 'point';
  if (extendedCount >= 3) return 'open';
  return 'none';
}

export function createGestureState(now = 0): GestureState {
  return { raw: 'none', rawSince: now, committed: 'none' };
}

export function stepGesture(state: GestureState, raw: GestureName, now: number): GestureStep {
  let next = state;
  if (raw !== state.raw) next = { ...state, raw, rawSince: now };
  const held = now - next.rawSince;
  let committed = next.committed;
  if (held >= GESTURE_HOLD_MS[next.raw] && next.raw !== committed) {
    committed = next.raw;
    next = { ...next, committed };
  }
  const edge = committed !== state.committed ? committed : null;
  return { state: next, committed, edge };
}

export function cursorLandmark(lm: Landmark[], gesture: GestureName): Landmark {
  if (gesture === 'point' || gesture === 'pinch') return lm[8];
  const wrist = lm[0];
  const indexMcp = lm[5];
  const pinkyMcp = lm[17];
  return {
    x: (wrist.x + indexMcp.x + pinkyMcp.x) / 3,
    y: (wrist.y + indexMcp.y + pinkyMcp.y) / 3,
    z: ((wrist.z ?? 0) + (indexMcp.z ?? 0) + (pinkyMcp.z ?? 0)) / 3,
  };
}

function point(x: number, y: number): Landmark {
  return { x, y, z: 0 };
}

/** A geometric hand, built so the classifier tests and the rehearsal share one shape. */
export function synthesizeHand(kind: HandKind, origin: { x: number; y: number } = { x: 0.5, y: 0.55 }): Landmark[] {
  const pts: Landmark[] = Array.from({ length: 21 }, () => point(origin.x, origin.y));
  const wrist = point(origin.x, origin.y + 0.22);
  pts[0] = wrist;

  const spread = [-0.12, -0.04, 0.04, 0.12];
  const tips = [8, 12, 16, 20];
  const dips = [7, 11, 15, 19];
  const pips = [6, 10, 14, 18];
  const mcps = [5, 9, 13, 17];
  const extended: Record<HandKind, boolean[]> = {
    open: [true, true, true, true],
    fist: [false, false, false, false],
    point: [true, false, false, false],
    pinch: [true, false, false, false],
  };

  for (let i = 0; i < 4; i++) {
    const mcp = point(origin.x + spread[i], origin.y + 0.02);
    pts[mcps[i]] = mcp;
    if (extended[kind][i]) {
      pts[pips[i]] = point(mcp.x + spread[i] * 0.15, origin.y - 0.1);
      pts[dips[i]] = point(mcp.x + spread[i] * 0.2, origin.y - 0.18);
      pts[tips[i]] = point(mcp.x + spread[i] * 0.25, origin.y - 0.26);
    } else {
      pts[pips[i]] = point(mcp.x, origin.y + 0.08);
      pts[dips[i]] = point(mcp.x, origin.y + 0.12);
      pts[tips[i]] = point(mcp.x, wrist.y - 0.02);
    }
  }

  pts[1] = point(origin.x - 0.08, origin.y + 0.12);
  pts[2] = point(origin.x - 0.14, origin.y + 0.06);
  if (kind === 'pinch') {
    pts[3] = point(pts[8].x + 0.01, pts[8].y + 0.01);
    pts[4] = point(pts[8].x + 0.012, pts[8].y + 0.008);
  } else if (kind === 'fist') {
    pts[3] = point(origin.x - 0.04, wrist.y - 0.04);
    pts[4] = point(origin.x - 0.02, wrist.y - 0.03);
  } else {
    pts[3] = point(origin.x - 0.2, origin.y + 0.02);
    pts[4] = point(origin.x - 0.24, origin.y - 0.02);
  }
  return pts;
}

const CURSOR_OFFSET: Record<HandKind, { x: number; y: number }> = {
  open: cursorOf('open'),
  fist: cursorOf('fist'),
  point: cursorOf('point'),
  pinch: cursorOf('pinch'),
};

function cursorOf(kind: HandKind): { x: number; y: number } {
  const hand = synthesizeHand(kind, { x: 0, y: 0 });
  const gesture: GestureName = kind;
  const cursor = cursorLandmark(hand, gesture);
  return { x: cursor.x, y: cursor.y };
}

/** Place a synthetic hand so its cursor landmark sits on a raw-video normalized point. */
export function handAtCursor(kind: HandKind, cursor: { x: number; y: number }): Landmark[] {
  const offset = CURSOR_OFFSET[kind];
  return synthesizeHand(kind, { x: cursor.x - offset.x, y: cursor.y - offset.y });
}

export interface AirTarget {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function hitAirTarget(x: number, y: number, targets: AirTarget[], pad = 18): string | null {
  let best: { id: string; d: number } | null = null;
  for (const target of targets) {
    const inside =
      x >= target.left - pad &&
      x <= target.right + pad &&
      y >= target.top - pad &&
      y <= target.bottom + pad;
    if (!inside) continue;
    const cx = (target.left + target.right) / 2;
    const cy = (target.top + target.bottom) / 2;
    const d = (x - cx) ** 2 + (y - cy) ** 2;
    if (!best || d < best.d) best = { id: target.id, d };
  }
  return best?.id ?? null;
}
