import { useState } from 'react';
import { PageAction } from '@components/Page';

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [result, setResult] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setResult('copied');
    } catch {
      setResult('failed');
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <PageAction label={label} onClick={() => void copy()} />
      {result === 'copied' && (
        <span role="status" className="text-xs text-text-muted">
          Copied
        </span>
      )}
      {result === 'failed' && (
        <span role="alert" className="text-xs text-error-light">
          Could not copy. Select and copy the value above.
        </span>
      )}
    </div>
  );
}
