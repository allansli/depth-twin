import { ACTIVE_PERIOD_MS, IDLE_PERIOD_MS } from './constants';

export interface PresenceState {
  present: boolean;
  streak: number;
}

export function cooldownAfterInfer(present: boolean, inferMs: number): number {
  const period = present ? ACTIVE_PERIOD_MS : IDLE_PERIOD_MS;
  return Math.max(0, period - Math.max(0, inferMs));
}

/** Near pixels are the bright end of the normalized depth map. */
export function isPersonPresent(depth: ArrayLike<number>, handVisible: boolean): boolean {
  if (handVisible) return true;
  if (depth.length === 0) return false;
  let near = 0;
  let count = 0;
  const step = Math.max(1, Math.floor(depth.length / 2500));
  for (let i = 0; i < depth.length; i += step) {
    count++;
    if (depth[i] > 148) near++;
  }
  return count > 0 && near / count > 0.1;
}

export function stepPresence(state: PresenceState, sample: boolean): PresenceState {
  if (sample === state.present) return { present: state.present, streak: 0 };
  const streak = state.streak + 1;
  if (streak >= 3) return { present: sample, streak: 0 };
  return { present: state.present, streak };
}

export function createPresence(): PresenceState {
  return { present: false, streak: 0 };
}
