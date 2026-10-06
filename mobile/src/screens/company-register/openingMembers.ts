import { formatShareCount, REGISTER_OPENING_COPY as COPY } from '@ledova/shared';

export function memberLabels(members: (string | null | undefined)[], named: Map<string, string | null>) {
  const labels = new Map<string, string>();
  let unnamed = 0;
  let fresh = 0;
  for (const member of members) {
    if (!member || labels.has(member)) continue;
    labels.set(
      member,
      named.has(member) ? named.get(member) || `Unnamed member ${++unnamed}` : COPY.NEW_MEMBER_NUMBERED(++fresh),
    );
  }
  return labels;
}

export const shareCount = (shares: string) => `${formatShareCount(shares)} ${shares === '1' ? 'share' : 'shares'}`;
