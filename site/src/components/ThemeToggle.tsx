import { MoonIcon, SunIcon } from '@phosphor-icons/react';
import { setTheme, useTheme } from '../theme';

export function ThemeToggle() {
  const dark = useTheme() === 'dark';
  return (
    <button
      type="button"
      aria-pressed={dark}
      aria-label="Dark theme"
      onClick={() => setTheme(dark ? 'paper' : 'dark')}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-tertiary hover:text-text-primary"
    >
      {dark ? <SunIcon size={20} /> : <MoonIcon size={20} />}
    </button>
  );
}
