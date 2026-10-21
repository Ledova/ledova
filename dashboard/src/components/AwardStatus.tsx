import { formatShareCount, hasValidRegisterAwardTotals, REGISTER_AWARD_COPY as COPY, shareCount } from '@ledova/shared';

export function AwardStatus({
  shares,
  vestedShares,
  issuedShares,
  availableShares,
  endedUnvestedShares,
  endedVestedShares,
  unvestedRemainingShares,
  remainingUnissuedShares,
}: {
  shares: string;
  vestedShares: string;
  issuedShares: string;
  availableShares: string;
  endedUnvestedShares: string;
  endedVestedShares: string;
  unvestedRemainingShares: string;
  remainingUnissuedShares: string;
}) {
  if (
    !hasValidRegisterAwardTotals({
      shares,
      vestedShares,
      issuedShares,
      availableShares,
      endedUnvestedShares,
      endedVestedShares,
      unvestedRemainingShares,
      remainingUnissuedShares,
    })
  )
    return <p role="status">Award quantities are unavailable. Refresh the current record.</p>;
  const promised = BigInt(shares);
  const parts = [
    { label: 'Unvested', quantity: BigInt(unvestedRemainingShares), look: 'bg-text-muted/35' },
    { label: 'Vested, awaiting issue', quantity: BigInt(availableShares), look: 'bg-brand-mid/45' },
    { label: 'Issued from award', quantity: BigInt(issuedShares), look: 'bg-brand-mid' },
    { label: COPY.ENDED_UNVESTED, quantity: BigInt(endedUnvestedShares), look: 'bg-text-muted/70' },
    { label: COPY.ENDED_VESTED, quantity: BigInt(endedVestedShares), look: 'bg-text-muted/70' },
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        {shareCount(shares)} promised · {formatShareCount(vestedShares)} company-recorded vested
      </p>
      <div
        role="img"
        aria-label={`Award status: ${parts.map((part) => `${formatShareCount(String(part.quantity))} ${part.label.toLowerCase()}`).join(', ')}. ${shareCount(shares)} promised.`}
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
            <dd className="break-words font-medium tabular-nums">{shareCount(String(part.quantity))}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs text-text-muted">
        {shareCount(remainingUnissuedShares)} {remainingUnissuedShares === '1' ? 'remains' : 'remain'} unissued. Issued
        award shares are already included in the holding.
      </p>
    </div>
  );
}
