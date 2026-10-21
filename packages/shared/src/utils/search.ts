export interface SearchChoice {
  value: string;
  label: string;
  detail?: string;
  unavailable?: string;
}

interface SearchEntry<T extends SearchChoice> {
  choice: T;
  text: string;
}

const folded = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en-AU');

function matcher(query: string) {
  const words = folded(query).split(/\s+/).filter(Boolean);
  return words.length ? (text: string) => words.every((word) => text.includes(word)) : null;
}

export function searchEntries<T extends SearchChoice>(choices: readonly T[]): SearchEntry<T>[] {
  return choices.map((choice) => ({ choice, text: folded(`${choice.label} ${choice.detail ?? ''}`) }));
}

export function searchMatches<T extends SearchChoice>(entries: readonly SearchEntry<T>[], query: string): T[] | null {
  const matches = matcher(query);
  return matches && entries.filter(({ text }) => matches(text)).map(({ choice }) => choice);
}

export function searchRows<T>(rows: readonly T[], text: (row: T) => string, query: string): T[] {
  const matches = matcher(query);
  return matches ? rows.filter((row) => matches(folded(text(row)))) : [...rows];
}
