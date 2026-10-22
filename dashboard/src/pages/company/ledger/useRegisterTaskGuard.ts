import { useLayoutEffect, useRef } from 'react';

export function useRegisterTaskGuard(visible: boolean, guard: () => void) {
  const available = useRef(visible);
  useLayoutEffect(() => {
    available.current = visible;
  }, [visible]);
  return () => {
    guard();
    if (!available.current) throw new Error('Open the current register task before reading or deciding this record.');
  };
}
