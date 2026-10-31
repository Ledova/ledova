import { useContext } from 'react';
import { InSignedInFrame } from '@components/InSignedInFrame';
import { FullScreenSpinner } from '@components/FullScreenSpinner';

export function RouteLoading() {
  const inFrame = useContext(InSignedInFrame);
  if (!inFrame) return <FullScreenSpinner label="Loading the page" />;
  return (
    <div role="status" className="flex items-center justify-center py-20">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-subtle border-t-brand" />
      <span className="sr-only">Loading the page</span>
    </div>
  );
}
