export function shortName(name: string) {
  return (
    name
      .replace(/\b(pty|ltd|limited|proprietary)\b\.?/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || name
  );
}

export function initials(name: string) {
  const words = shortName(name)
    .split(' ')
    .filter((word) => /^[A-Za-z0-9]/.test(word));
  return (
    words
      .slice(0, 2)
      .map((word) => word[0])
      .join('') || name.slice(0, 2)
  ).toUpperCase();
}
