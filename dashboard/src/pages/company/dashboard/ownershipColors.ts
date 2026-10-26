import type { CompanyOwnershipSummary } from '@ledova/shared';

export function ownershipColor(classes: CompanyOwnershipSummary['classes'], uuid: string) {
  const index = classes
    .map((item) => item.uuid)
    .sort()
    .indexOf(uuid);
  return `var(--color-chart-${(Math.max(0, index) % 6) + 1})`;
}
