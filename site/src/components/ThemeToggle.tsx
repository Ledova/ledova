import { useState } from 'react';
import { MoonIcon, SunIcon } from '@phosphor-icons/react';

export function ThemeToggle() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');

  function toggleTheme() {
    const next = !dark;
    if (next) document.documentElement.dataset.theme = 'dark';
    else delete document.documentElement.dataset.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next ? '#151410' : '#f6f3ec');
    try {
      localStorage.setItem('ledova.site.theme', next ? 'dark' : 'paper');
    } catch {}
    setDark(next);
  }

  return (
    <button
      type="button"
      aria-pressed={dark}
      aria-label="Dark theme"
      title={dark ? 'Use light theme' : 'Use dark theme'}
      onClick={toggleTheme}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-surface-tertiary hover:text-text-primary"
    >
      {dark ? <SunIcon size={20} /> : <MoonIcon size={20} />}
    </button>
  );
}
