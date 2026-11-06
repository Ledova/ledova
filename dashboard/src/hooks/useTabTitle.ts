import { useEffect } from 'react';

export function useTabTitle(title: string | undefined) {
  useEffect(() => {
    if (!title) return;
    document.title = `${title} · Ledova`;
    return () => {
      document.title = 'Ledova';
    };
  }, [title]);
}
