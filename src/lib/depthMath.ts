/** Downsample a raw depth plane to a uint8 map. Larger model values become brighter (nearer). */
export function normalizeDepth(
  src: ArrayLike<number>,
  srcW: number,
  srcH: number,
  outW: number,
  outH: number,
): Uint8Array {
  const out = new Uint8Array(Math.max(0, outW) * Math.max(0, outH));
  if (srcW < 1 || srcH < 1 || outW < 1 || outH < 1 || src.length < srcW * srcH) return out;

  const samples: number[] = [];
  const stride = Math.max(1, Math.floor((srcW * srcH) / 4000));
  for (let i = 0; i < srcW * srcH; i += stride) {
    const value = src[i];
    if (Number.isFinite(value)) samples.push(value);
  }
  if (samples.length === 0) return out;
  samples.sort((a, b) => a - b);
  const lo = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.02))];
  const hi = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.98))];
  const span = Math.max(1e-5, hi - lo);

  for (let y = 0; y < outH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(((y + 0.5) * srcH) / outH));
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(((x + 0.5) * srcW) / outW));
      const value = src[sy * srcW + sx];
      const n = Number.isFinite(value) ? (value - lo) / span : 0;
      out[y * outW + x] = Math.max(0, Math.min(255, Math.round(n * 255)));
    }
  }
  return out;
}

export function frameSize(
  videoW: number,
  videoH: number,
  longSide: number,
): { w: number; h: number } {
  if (videoW < 2 || videoH < 2) return { w: longSide, h: Math.round((longSide * 9) / 16) };
  if (videoW >= videoH) {
    return { w: longSide, h: Math.max(2, Math.round((longSide * videoH) / videoW)) };
  }
  return { w: Math.max(2, Math.round((longSide * videoW) / videoH)), h: longSide };
}

export function gridSize(videoW: number, videoH: number, cols = 160): { cols: number; rows: number } {
  const safeCols = Math.max(8, cols - (cols % 4));
  const aspect = videoW > 1 && videoH > 1 ? videoH / videoW : 9 / 16;
  let rows = Math.max(8, Math.round(safeCols * aspect));
  rows -= rows % 2;
  return { cols: safeCols, rows: Math.max(8, rows) };
}
