export function ownershipColor(classes: ReadonlyArray<{ uuid: string }>, uuid: string) {
  const index = classes
    .map((item) => item.uuid)
    .sort()
    .indexOf(uuid);
  return `var(--color-chart-${(Math.max(0, index) % 6) + 1})`;
}
