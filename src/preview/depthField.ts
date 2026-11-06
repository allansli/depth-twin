function ellipse(u: number, v: number, cx: number, cy: number, rx: number, ry: number): number {
  const dx = (u - cx) / rx;
  const dy = (v - cy) / ry;
  const r = dx * dx + dy * dy;
  if (r >= 1) return 0;
  return (1 - r) ** 0.7;
}

/** A standing figure so materials can be previewed without a camera or a depth model. */
export function syntheticPersonDepth(cols: number, rows: number, phase = 0): Uint8Array {
  const out = new Uint8Array(Math.max(0, cols) * Math.max(0, rows));
  if (cols < 2 || rows < 2) return out;
  const cx = 0.5 + Math.sin(phase * 0.7) * 0.02;
  const bob = Math.sin(phase * 1.3) * 0.01;
  for (let y = 0; y < rows; y++) {
    const v = (y + 0.5) / rows;
    for (let x = 0; x < cols; x++) {
      const u = (x + 0.5) / cols;
      const head = ellipse(u, v, cx, 0.34 + bob, 0.09, 0.12);
      const shoulders = ellipse(u, v, cx, 0.5 + bob, 0.26, 0.09) * 0.8;
      const torso = ellipse(u, v, cx, 0.7 + bob, 0.18, 0.24) * 0.76;
      const armL = ellipse(u, v, cx - 0.22, 0.58 + bob, 0.07, 0.14) * 0.66;
      const armR = ellipse(u, v, cx + 0.22, 0.56 + bob, 0.065, 0.13) * 0.66;
      const hand = ellipse(u, v, cx + 0.24 + Math.sin(phase) * 0.01, 0.42, 0.04, 0.045);
      const d = Math.min(1, Math.max(head, shoulders, torso, armL, armR, hand));
      out[y * cols + x] = Math.min(255, Math.round(14 + d * 236));
    }
  }
  return out;
}
