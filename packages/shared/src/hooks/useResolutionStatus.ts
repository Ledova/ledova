import { useEffect, useState } from 'react';
import { LONGEST_TIMER_DELAY, nextResolutionBoundary, resolutionStatus } from '../constants';
import type { Publication, ResolutionStatus } from '../types';

export function useResolutionStatus(
  publication: Pick<Publication, 'opensAt' | 'closesAt' | 'result'>,
): ResolutionStatus | null {
  const [now, setNow] = useState(() => new Date());
  const boundary = nextResolutionBoundary(publication, now);

  useEffect(() => {
    if (boundary === null) return undefined;
    const delay = Math.min(Math.max(boundary - Date.now(), 0), LONGEST_TIMER_DELAY);
    const timer = setTimeout(() => setNow(new Date()), delay);
    return () => clearTimeout(timer);
  }, [boundary, now]);

  return resolutionStatus(publication, now);
}
