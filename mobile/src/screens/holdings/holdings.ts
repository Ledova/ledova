import { formatShareCount } from '@ledova/shared';

export function shareQuantity(shares: string) {
  return /^\d+$/.test(shares) ? formatShareCount(shares) : 'Unavailable';
}
