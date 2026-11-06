export interface TelemetryInput {
  fps: number;
  depthFps: number;
  depthMs: number | null;
  backend: string;
  dtype: string;
  model: string;
  gesture: string;
  cadence: string;
  hands: string;
  pose: string;
  source: string;
  frozen: boolean;
}

export function formatTelemetry(input: TelemetryInput): string {
  const depth =
    input.depthMs == null
      ? 'depth —'
      : `depth ${Math.round(input.depthFps)} fps · ${Math.round(input.depthMs)} ms`;
  const engine = [input.backend, input.dtype].filter(Boolean).join(' · ');
  return [
    `${Math.round(input.fps)} fps`,
    depth,
    engine,
    input.model,
    `gesture ${input.gesture}`,
    input.cadence,
    input.hands,
    input.pose,
    input.source,
    input.frozen ? 'held' : 'live',
  ].join('   ·   ');
}
