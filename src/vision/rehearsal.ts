import type { HandKind } from '../lib/gestures';

export type RehearsalAim = 'mode' | 'freeze' | 'parallax' | 'save';

export interface RehearsalCue {
  at: number;
  until: number;
  kind: HandKind;
  aim: RehearsalAim;
}

export const REHEARSAL: RehearsalCue[] = [
  { at: 0, until: 900, kind: 'open', aim: 'mode' },
  { at: 900, until: 1600, kind: 'pinch', aim: 'mode' },
  { at: 1600, until: 2400, kind: 'point', aim: 'freeze' },
  { at: 2400, until: 3300, kind: 'fist', aim: 'freeze' },
];

export const REHEARSAL_MS = 3300;

export function cueAt(elapsed: number): RehearsalCue | null {
  return REHEARSAL.find((cue) => elapsed >= cue.at && elapsed < cue.until) ?? null;
}
