import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  HouseIcon,
  WalletIcon,
  ArrowsClockwiseIcon,
  LinkIcon,
  UserIcon,
  GearIcon,
  QuestionIcon,
  SignOutIcon,
  BuildingsIcon,
  FileTextIcon,
  ShieldCheckIcon,
  MegaphoneIcon,
  NewspaperIcon,
  StorefrontIcon,
  HandCoinsIcon,
} from '@phosphor-icons/react';
import { DESIGN_TOKENS, DESTINATIONS, getCompanies, type DestinationKey } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { useFeatureFlags } from '@hooks/useFeatureFlags';
import { useRole } from '@hooks/useRole';
import { useSignOut } from '@hooks/useSignOut';
import { useUserProfile } from '@pages/user-profile/useUserProfile';
import { MARKETING_URL } from '@utils/marketingUrl';
import { Logo } from '@components/Logo';
import { NotificationBell } from '@components/NotificationBell';

const ICON_MD = DESIGN_TOKENS.icon.sizes.md;

type Icon = React.ComponentType<{ size?: number; weight?: 'regular' | 'fill' }>;

interface NavItem {
  destination: DestinationKey;
  icon: Icon;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const COMPANY: NavItem[] = [
  { destination: 'company', icon: BuildingsIcon },
  { destination: 'companyListing', icon: FileTextIcon },
  { destination: 'companyOffering', icon: MegaphoneIcon },
];

const YOUR_SHARES: NavItem[] = [
  { destination: 'home', icon: HouseIcon },
  { destination: 'publications', icon: NewspaperIcon },
  { destination: 'transactions', icon: LinkIcon },
];

const MARKET: NavItem = { destination: 'trading', icon: ArrowsClockwiseIcon };

const INVEST: NavItem[] = [
  { destination: 'directory', icon: StorefrontIcon },
  { destination: 'subscriptions', icon: HandCoinsIcon },
  MARKET,
  { destination: 'investorEligibility', icon: ShieldCheckIcon },
];

const YOURS: NavItem[] = [
  { destination: 'wallets', icon: WalletIcon },
  { destination: 'userProfile', icon: UserIcon },
  { destination: 'settings', icon: GearIcon },
];

const ITEM_CLASS = 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors';
const IDLE_CLASS = 'text-text-secondary hover:bg-surface-tertiary hover:text-text-primary';

function GroupLabel({ children }: { children: string }) {
  return <p className="mb-1 truncate px-3 text-xs font-medium uppercase tracking-wider text-text-muted">{children}</p>;
}

function NavButton({ item, active, onSelect }: { item: NavItem; active: boolean; onSelect: (path: string) => void }) {
  const Icon = item.icon;
  const { path, title } = DESTINATIONS[item.destination];
  return (
    <button
      onClick={() => onSelect(path)}
      aria-current={active ? 'page' : undefined}
      className={`${ITEM_CLASS} ${active ? 'bg-brand-mid/10 text-brand-light' : IDLE_CLASS}`}
    >
      <Icon size={ICON_MD} weight={active ? 'fill' : 'regular'} />
      <span>{title}</span>
    </button>
  );
}

function useCompanyName(isCompany: boolean): string | undefined {
  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => getCompanies(apiClient),
    enabled: isCompany,
  });
  return companies.data?.data?.results?.[0]?.name || undefined;
}

interface SidebarProps {
  onNavigate?: () => void;
  withNotifications?: boolean;
}

export function Sidebar({ onNavigate, withNotifications = false }: SidebarProps = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { tradingEnabled } = useFeatureFlags();
  const { isInvestor, isCompany } = useRole();
  const { userProfile } = useUserProfile();
  const companyName = useCompanyName(isCompany);
  const { signOut, isSigningOut } = useSignOut();

  const groups: NavGroup[] = [
    ...(isCompany ? [{ label: companyName ?? DESTINATIONS.company.title, items: COMPANY }] : []),
    { label: 'Your shares', items: YOUR_SHARES },
    ...(isInvestor ? [{ label: 'Invest', items: INVEST.filter((item) => item !== MARKET || tradingEnabled) }] : []),
    { items: YOURS },
  ];

  const handleNav = (path: string) => {
    navigate(path);
    onNavigate?.();
  };

  return (
    <aside className="flex h-full w-60 flex-col border-r border-border-subtle bg-surface-base">
      <div className="flex h-16 flex-shrink-0 items-center justify-between pl-5 pr-3">
        <Logo />
        {withNotifications && <NotificationBell align="start" />}
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
        {groups.map((group) => (
          <div key={group.label ?? 'yours'} className="space-y-1">
            {group.label && <GroupLabel>{group.label}</GroupLabel>}
            {group.items.map((item) => (
              <NavButton
                key={item.destination}
                item={item}
                active={location.pathname === DESTINATIONS[item.destination].path}
                onSelect={handleNav}
              />
            ))}
            {!group.label && (
              <a
                href={`${MARKETING_URL}/contact`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onNavigate?.()}
                className={`${ITEM_CLASS} ${IDLE_CLASS}`}
              >
                <QuestionIcon size={ICON_MD} />
                <span>Help & Support</span>
              </a>
            )}
          </div>
        ))}
      </nav>

      <div className="border-t border-border-subtle p-3">
        {userProfile?.email && <p className="truncate px-3 pb-1 pt-1 text-xs text-text-muted">{userProfile.email}</p>}
        <button
          onClick={signOut}
          disabled={isSigningOut}
          className={`${ITEM_CLASS} text-text-secondary hover:bg-error/10 hover:text-error-light disabled:opacity-50`}
        >
          <SignOutIcon size={ICON_MD} />
          <span>{isSigningOut ? 'Signing out...' : 'Sign out'}</span>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
