import type { ThemeName } from '../constants/ui/design-tokens';

export function parseTheme(value: unknown): ThemeName {
  return value === 'dark' ? 'dark' : 'paper';
}
