import { useState } from 'react';
import { PageAction } from '@components/Page';
import { TextInput } from '@components/Field';

export function CopyButton({ value, label, valueLabel }: { value: string; label: string; valueLabel?: string }) {
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
          {valueLabel
            ? 'Could not copy. Select and copy it below.'
            : 'Could not copy. Select and copy the value above.'}
        </span>
      )}
      {result === 'failed' && valueLabel && (
        <TextInput readOnly aria-label={valueLabel} value={value} onFocus={(event) => event.target.select()} />
      )}
    </div>
  );
}
