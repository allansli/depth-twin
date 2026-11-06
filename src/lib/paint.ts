export interface PaintPoint {
  u: number;
  v: number;
}

export function decayField(field: Uint8Array, keep: number): void {
  const k = Math.min(1, Math.max(0, keep));
  for (let i = 0; i < field.length; i++) field[i] = (field[i] * k) | 0;
}

/** Stamp a soft disc. `v` is 0 at the top of the image, matching landmark y. */
export function stampDisc(
  field: Uint8Array,
  cols: number,
  rows: number,
  u: number,
  v: number,
  radius: number,
  amount: number,
): void {
  if (cols < 1 || rows < 1 || amount <= 0) return;
  const cx = u * cols;
  const cy = v * rows;
  const rad = Math.max(1, radius * Math.max(cols, rows));
  const r2 = rad * rad;
  const x0 = Math.max(0, Math.floor(cx - rad));
  const x1 = Math.min(cols - 1, Math.ceil(cx + rad));
  const y0 = Math.max(0, Math.floor(cy - rad));
  const y1 = Math.min(rows - 1, Math.ceil(cy + rad));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d2 = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
      if (d2 > r2) continue;
      const fall = 1 - d2 / r2;
      const i = y * cols + x;
      field[i] = Math.min(255, field[i] + Math.round(amount * fall));
    }
  }
}

export function stampSegment(
  field: Uint8Array,
  cols: number,
  rows: number,
  from: PaintPoint,
  to: PaintPoint,
  radius: number,
  amount: number,
): void {
  const dist = Math.hypot((to.u - from.u) * cols, (to.v - from.v) * rows);
  const steps = Math.max(1, Math.min(24, Math.ceil(dist)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stampDisc(
      field,
      cols,
      rows,
      from.u + (to.u - from.u) * t,
      from.v + (to.v - from.v) * t,
      radius,
      amount,
    );
  }
}

/** Body motion: where the depth field changes, the volume takes on paint. */
export function absorbMotion(
  paint: Uint8Array,
  prev: Uint8Array,
  next: Uint8Array,
  gain = 0.5,
): void {
  const n = Math.min(paint.length, prev.length, next.length);
  for (let i = 0; i < n; i++) {
    const delta = Math.abs(next[i] - prev[i]);
    if (delta < 18) continue;
    paint[i] = Math.min(255, paint[i] + Math.round(Math.min(48, (delta - 18) * gain)));
  }
}
