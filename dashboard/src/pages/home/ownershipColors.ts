import { ownershipColorIndex } from '@ledova/shared';

export function ownershipColor(classes: ReadonlyArray<{ uuid: string }>, uuid: string) {
  return `var(--color-chart-${ownershipColorIndex(classes, uuid)})`;
}
