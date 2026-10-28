const ATTRIBUTION =
  'has no verified final chain inclusion. It requires operator attribution ' +
  'before a register boundary can represent or exclude it.';
const AFTER =
  /^was finally included in block \d+, after the captured boundary block \d+, so this boundary does not represent it\. Prepare a fresh opening\.$/;
const OUTSIDE =
  /^is not in the captured boundary's canonical history at block \d+, so this boundary does not represent it\. Prepare a fresh opening\.$/;

export function registerInclusionMessage(value: string) {
  const message = value.match(/^The completed (issue|transfer) [0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12} (.+)$/i);
  if (!message) return value;
  const kind = message[1].toLowerCase();
  const detail = message[2];
  if (detail === ATTRIBUTION)
    return `A completed ${kind} has no confirmed final inclusion on chain, so an opening can't include or exclude it until it is attributed.`;
  if (AFTER.test(detail))
    return `A completed ${kind} was included on chain after these holdings were read, so this opening doesn't show it. Prepare a fresh opening.`;
  if (OUTSIDE.test(detail))
    return `A completed ${kind} isn't in the chain's history where these holdings were read, so this opening doesn't show it. Prepare a fresh opening.`;
  return value;
}
