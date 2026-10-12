import { formatShareCount } from '@ledova/shared';

export function AwardStatus({
  shares,
  vestedShares,
  issuedShares,
  availableShares,
}: {
  shares: string;
  vestedShares: string;
  issuedShares: string;
  availableShares: string;
}) {
  const quantities = [shares, vestedShares, issuedShares, availableShares];
  if (!quantities.every((quantity) => /^\d+$/.test(quantity)))
    return <p role="status">Award quantities are unavailable. Refresh the current record.</p>;
  const [promised, vested, issued, available] = quantities.map((quantity) => BigInt(quantity));
  if (issued > vested || vested > promised || available !== vested - issued)
    return <p role="status">Award quantities are unavailable. Refresh the current record.</p>;
  if (promised === 0n) return <p className="text-sm text-text-muted">No award shares recorded.</p>;
  const parts = [
    { label: 'Unvested', quantity: promised - vested, look: 'bg-text-muted/35' },
    { label: 'Vested, awaiting issue', quantity: available, look: 'bg-brand-mid/45' },
    { label: 'Issued from award', quantity: issued, look: 'bg-brand-mid' },
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        {formatShareCount(shares)} shares promised · {formatShareCount(vestedShares)} company-recorded vested
      </p>
      <div
        role="img"
        aria-label={`Award status: ${parts.map((part) => `${formatShareCount(String(part.quantity))} ${part.label.toLowerCase()}`).join(', ')}. ${formatShareCount(shares)} shares promised.`}
        className="flex h-3 overflow-hidden rounded-full bg-surface-tertiary"
      >
        {parts.map((part) => (
          <span
            key={part.label}
            aria-hidden="true"
            className={part.look}
            style={{ width: `${Number((part.quantity * 10000n) / promised) / 100}%` }}
          />
        ))}
      </div>
      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        {parts.map((part) => (
          <div key={part.label} className="min-w-0">
            <dt className="text-text-muted">{part.label}</dt>
            <dd className="font-medium tabular-nums">{formatShareCount(String(part.quantity))} shares</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-text-muted">Issued award shares are already included in the holding.</p>
    </div>
  );
}
