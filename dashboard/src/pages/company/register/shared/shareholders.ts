import { generatePath } from 'react-router-dom';
import { DESTINATIONS } from '@ledova/shared';

export function percentage(balance: string, supply: string | null) {
  if (supply === null || supply === '0') return 'Not recorded';
  const shares = BigInt(balance);
  const total = BigInt(supply);
  const rounded = (shares * 10000n + total / 2n) / total;
  return rounded === 0n && shares > 0n ? '<0.01%' : `${(Number(rounded) / 100).toFixed(2)}%`;
}

export function shareholderPath(member: string, company: string) {
  return `${generatePath(DESTINATIONS.companyShareholder.path, { member })}?company=${encodeURIComponent(company)}`;
}
