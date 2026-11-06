export interface LaunchFlags {
  dev: boolean;
  preview: boolean;
  look: boolean;
  shot: boolean;
  material: string | null;
}

export function readFlags(search: string): LaunchFlags {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return {
    dev: q.get('dev') === '1',
    preview: q.has('preview'),
    look: q.get('look') === '1',
    shot: q.get('shot') === '1',
    material: q.get('material'),
  };
}
