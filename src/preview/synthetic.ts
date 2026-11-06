let previewFrame = 0;

function draw(ctx: CanvasRenderingContext2D, time: number) {
  const { width, height } = ctx.canvas;
  const t = time / 1000;
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#1a1c28');
  gradient.addColorStop(0.55, '#12141c');
  gradient.addColorStop(1, '#07080c');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = '#2a3148';
  ctx.fillRect(width * 0.08, height * 0.12, width * 0.22, height * 0.28);

  const lean = Math.sin(t * 0.7) * width * 0.04;
  const cx = width * 0.5 + lean;
  const bob = Math.sin(t * 1.3) * 8;

  ctx.fillStyle = '#6d6258';
  ctx.beginPath();
  ctx.ellipse(cx, height * 0.78 + bob, width * 0.18, height * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#d7b5a0';
  ctx.beginPath();
  ctx.ellipse(cx, height * 0.42 + bob, width * 0.09, height * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();

  const arm = Math.sin(t * 1.6) * 0.35;
  ctx.strokeStyle = '#c9a08c';
  ctx.lineWidth = 28;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + width * 0.08, height * 0.58);
  ctx.quadraticCurveTo(
    cx + width * 0.22,
    height * 0.5 + arm * 40,
    cx + width * 0.28,
    height * 0.38 + arm * 80,
  );
  ctx.stroke();
}

/** A moving figure so the depth twin can be previewed without a webcam. Not a camera. */
export function startSyntheticPreview(): MediaStream {
  if (previewFrame) cancelAnimationFrame(previewFrame);
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 540;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not start the synthetic preview');
  const loop = (time: number) => {
    draw(ctx, time);
    previewFrame = requestAnimationFrame(loop);
  };
  loop(performance.now());
  return canvas.captureStream(30);
}
