import type { HandKind } from '../lib/gestures';

export type RehearsalAim = 'material' | 'hold' | 'capture';

export interface RehearsalCue {
  at: number;
  until: number;
  kind: HandKind;
  aim: RehearsalAim;
}

export const REHEARSAL: RehearsalCue[] = [
  { at: 0, until: 700, kind: 'open', aim: 'material' },
  { at: 700, until: 1300, kind: 'point', aim: 'material' },
  { at: 1300, until: 1900, kind: 'victory', aim: 'material' },
  { at: 1900, until: 2700, kind: 'fist', aim: 'hold' },
  { at: 2700, until: 3400, kind: 'thumb_up', aim: 'capture' },
];

export const REHEARSAL_MS = 3400;

export function cueAt(elapsed: number): RehearsalCue | null {
  return REHEARSAL.find((cue) => elapsed >= cue.at && elapsed < cue.until) ?? null;
}
