import { MoonIcon, SunIcon } from '@phosphor-icons/react';
import { ICON_MD } from '@components/iconSizes';
import { setTheme, useTheme } from '@hooks/useTheme';

export function ThemeToggle() {
  const dark = useTheme() === 'dark';
  return (
    <button
      type="button"
      aria-pressed={dark}
      aria-label="Dark theme"
      onClick={() => setTheme(dark ? 'paper' : 'dark')}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-tertiary hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
    >
      {dark ? <SunIcon size={ICON_MD} /> : <MoonIcon size={ICON_MD} />}
    </button>
  );
}
