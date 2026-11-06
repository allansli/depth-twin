export const MATERIALS = ['particles', 'holo', 'metal', 'wire', 'ember'] as const;

export type MaterialId = (typeof MATERIALS)[number];

const LABELS: Record<MaterialId, string> = {
  particles: 'Particles',
  holo: 'Holo',
  metal: 'Metal',
  wire: 'Wire',
  ember: 'Ember',
};

export function isMaterialId(value: string | null | undefined): value is MaterialId {
  return !!value && (MATERIALS as readonly string[]).includes(value);
}

export function nextMaterial(id: MaterialId): MaterialId {
  const index = MATERIALS.indexOf(id);
  return MATERIALS[(index + 1) % MATERIALS.length];
}

export function materialLabel(id: MaterialId): string {
  return LABELS[id];
}
