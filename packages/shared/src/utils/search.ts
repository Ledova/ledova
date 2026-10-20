export interface SearchChoice {
  value: string;
  label: string;
  detail?: string;
  unavailable?: string;
}

export interface SearchEntry<T extends SearchChoice> {
  choice: T;
  text: string;
}

const folded = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-AU');

export function searchEntries<T extends SearchChoice>(choices: readonly T[]): SearchEntry<T>[] {
  return choices.map((choice) => ({ choice, text: folded(`${choice.label} ${choice.detail ?? ''}`) }));
}

export function searchMatches<T extends SearchChoice>(entries: readonly SearchEntry<T>[], query: string): T[] | null {
  const words = folded(query).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return entries.filter(({ text }) => words.every((word) => text.includes(word))).map(({ choice }) => choice);
}
