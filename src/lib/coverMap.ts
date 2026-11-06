export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** object-fit: cover rect of a video inside the viewport. */
export function coverRect(videoAspect: number, viewW: number, viewH: number): ViewRect {
  const safeAspect = Math.max(0.01, videoAspect);
  const viewAspect = viewW / Math.max(1, viewH);
  if (safeAspect > viewAspect) {
    const height = viewH;
    const width = viewH * safeAspect;
    return { x: (viewW - width) / 2, y: 0, width, height };
  }
  const width = viewW;
  const height = viewW / safeAspect;
  return { x: 0, y: (viewH - height) / 2, width, height };
}

/** Raw webcam x (not mirrored) → viewport pixel, matching the mirrored twin. */
export function mirrorToView(
  nx: number,
  ny: number,
  videoAspect: number,
  viewW: number,
  viewH: number,
): { x: number; y: number } {
  const rect = coverRect(videoAspect, viewW, viewH);
  return {
    x: rect.x + (1 - nx) * rect.width,
    y: rect.y + ny * rect.height,
  };
}

export function viewToVideoNorm(
  x: number,
  y: number,
  videoAspect: number,
  viewW: number,
  viewH: number,
): { x: number; y: number } {
  const rect = coverRect(videoAspect, viewW, viewH);
  const mirrored = (x - rect.x) / Math.max(1, rect.width);
  return {
    x: 1 - mirrored,
    y: (y - rect.y) / Math.max(1, rect.height),
  };
}
