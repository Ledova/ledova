export async function guarded<Result>(guard: () => void, read: () => Promise<Result>) {
  guard();
  const result = await read();
  guard();
  return result;
}

export function firstOfEach<Row>(rows: Row[], uuidOf: (row: Row) => string) {
  const kept = new Map<string, Row>();
  for (const row of rows) if (!kept.has(uuidOf(row))) kept.set(uuidOf(row), row);
  return [...kept.values()];
}
