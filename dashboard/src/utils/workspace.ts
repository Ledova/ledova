import { DESTINATIONS } from '@ledova/shared';
import type { WorkspaceMode } from '@services/workspace';
import { MEMBER_INVITATION_PATH } from './paths';

export function routeWorkspace(pathname: string, hash: string): WorkspaceMode | null {
  if (pathname === DESTINATIONS.settings.path) return hash === '#company-recorded-details' ? 'my-shares' : null;
  if (pathname === DESTINATIONS.userProfile.path) return null;
  if (pathname === DESTINATIONS.company.path || pathname.startsWith(`${DESTINATIONS.company.path}/`)) return 'company';
  if (
    pathname === MEMBER_INVITATION_PATH ||
    [
      DESTINATIONS.home.path,
      DESTINATIONS.memberRecords.path,
      DESTINATIONS.walletHoldings.path,
      DESTINATIONS.wallets.path,
      DESTINATIONS.transactions.path,
      DESTINATIONS.publications.path,
      DESTINATIONS.directory.path,
      DESTINATIONS.subscriptions.path,
      DESTINATIONS.investorEligibility.path,
      DESTINATIONS.eligibilityRequests.path,
      DESTINATIONS.trading.path,
    ].some((path) => pathname === path || pathname.startsWith(`${path}/`))
  )
    return 'my-shares';
  return null;
}
