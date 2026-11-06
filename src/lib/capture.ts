export const STILL_W = 1920;
export const STILL_H = 1080;

export function captureFilename(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `depth-twin-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.png`;
}

/** GL readPixels is bottom-up. Return a top-up RGBA buffer of the same size. */
export function flipRgba(src: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * row;
    out.set(src.subarray(from, from + row), y * row);
  }
  return out;
}

function drawCoverMirrored(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.max(dw / vw, dh / vh);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (vw - sw) / 2;
  const sy = (vh - sh) / 2;
  ctx.save();
  ctx.translate(dx + dw, dy);
  ctx.scale(-1, 1);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
  ctx.restore();
}

function paintBrand(ctx: CanvasRenderingContext2D) {
  const w = STILL_W;
  const h = STILL_H;
  const glow = ctx.createRadialGradient(w * 0.5, h * 0.45, h * 0.18, w * 0.5, h * 0.5, h * 0.78);
  glow.addColorStop(0, 'rgba(0,0,0,0)');
  glow.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(68, h - 86);
  ctx.strokeStyle = 'rgba(244,239,230,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(10, 0);
  ctx.lineTo(20, 10);
  ctx.lineTo(10, 20);
  ctx.lineTo(0, 10);
  ctx.closePath();
  ctx.stroke();
  ctx.font = '500 18px Outfit, sans-serif';
  ctx.fillStyle = 'rgba(244,239,230,0.92)';
  ctx.fillText('DEPTH TWIN', 32, 16);
  ctx.restore();

  ctx.font = '400 13px Outfit, sans-serif';
  ctx.fillStyle = 'rgba(244,239,230,0.58)';
  ctx.textAlign = 'right';
  ctx.fillText('on-device', w - 68, h - 70);
}

/** Grade a 1920×1080 framebuffer into a branded PNG. Split keeps the live camera on the left. */
export function composeStill(rgbaTop: Uint8Array, video: HTMLVideoElement | null, split: boolean): string {
  const canvas = document.createElement('canvas');
  canvas.width = STILL_W;
  canvas.height = STILL_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not compose the still');
  const pixels = new Uint8ClampedArray(rgbaTop);
  ctx.putImageData(new ImageData(pixels, STILL_W, STILL_H), 0, 0);
  if (split && video && video.videoWidth > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, STILL_W / 2, STILL_H);
    ctx.clip();
    drawCoverMirrored(ctx, video, 0, 0, STILL_W, STILL_H);
    ctx.restore();
    ctx.fillStyle = 'rgba(244,239,230,0.75)';
    ctx.fillRect(STILL_W / 2 - 1, 0, 2, STILL_H);
  }
  paintBrand(ctx);
  return canvas.toDataURL('image/png');
}
