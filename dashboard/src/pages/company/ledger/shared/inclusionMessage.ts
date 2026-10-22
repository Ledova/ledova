import { shortReference } from '@ledova/shared';

export function registerInclusionMessage(value: string) {
  const message = value.match(
    /^(The completed (?:issue|transfer) )([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})( .+)$/i,
  );
  if (!message) return value;
  const [, prefix, source, detail] = message;
  const known =
    detail ===
      ' has no verified final chain inclusion. It requires operator attribution ' +
        'before a register boundary can represent or exclude it.' ||
    /^ was finally included in block \d+, after the captured boundary block \d+, so this boundary does not represent it\. Prepare a fresh opening\.$/.test(
      detail,
    ) ||
    /^ is not in the captured boundary's canonical history at block \d+, so this boundary does not represent it\. Prepare a fresh opening\.$/.test(
      detail,
    );
  return known ? `${prefix}${shortReference(source)}${detail}` : value;
}
