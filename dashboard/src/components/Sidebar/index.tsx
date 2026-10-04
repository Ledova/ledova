import { useLocation, useNavigate } from 'react-router-dom';
import {
  HouseIcon,
  WalletIcon,
  ArrowsClockwiseIcon,
  LinkIcon,
  UserIcon,
  GearIcon,
  BuildingsIcon,
  ShieldCheckIcon,
  MegaphoneIcon,
  NewspaperIcon,
  StorefrontIcon,
  HandCoinsIcon,
  BookOpenIcon,
} from '@phosphor-icons/react';
import { DESTINATIONS, useFeatureFlags, type DestinationKey } from '@ledova/shared';
import { ICON_MD } from '@components/iconSizes';
import { useRole } from '@hooks/useRole';
import { useUserProfile } from '@pages/user-profile/useUserProfile';
import { MARKETING_URL } from '@utils/marketingUrl';
import { Logo } from '@components/Logo';
import { NotificationBell } from '@components/NotificationBell';
import { SignOutButton } from '@components/SignOutButton';

type Icon = React.ComponentType<{ size?: number; weight?: 'regular' | 'fill' }>;

interface NavItem {
  destination: DestinationKey;
  icon: Icon;
}

interface NavGroup {
  id: string;
  label?: string;
  items: NavItem[];
}

const COMPANY: NavItem[] = [
  { destination: 'companyRegister', icon: BookOpenIcon },
  { destination: 'companyOffering', icon: MegaphoneIcon },
  { destination: 'company', icon: BuildingsIcon },
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
  return (
    <p className="mb-1 break-words px-3 text-xs font-medium uppercase tracking-wider text-text-muted">{children}</p>
  );
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

interface SidebarProps {
  onNavigate?: () => void;
  withNotifications?: boolean;
}

export function Sidebar({ onNavigate, withNotifications = false }: SidebarProps = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const tradingEnabled = useFeatureFlags().isEnabled('trading_enabled');
  const { isInvestor, isCompany } = useRole();
  const { userProfile } = useUserProfile();
  const person = userProfile?.fullName?.trim() || userProfile?.email;

  const groups: NavGroup[] = [
    ...(isCompany ? [{ id: 'company', label: DESTINATIONS.company.title, items: COMPANY }] : []),
    { id: 'shares', label: 'Your shares', items: YOUR_SHARES },
    ...(isInvestor
      ? [{ id: 'invest', label: 'Invest', items: INVEST.filter((item) => item !== MARKET || tradingEnabled) }]
      : []),
    {
      id: 'yours',
      items: [...(!isCompany ? [{ destination: 'company' as const, icon: BuildingsIcon }] : []), ...YOURS],
    },
  ];

  const activePath = groups
    .flatMap((group) => group.items)
    .map((item) => DESTINATIONS[item.destination].path)
    .filter((path) => location.pathname === path || location.pathname.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0];

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

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <nav className="space-y-6">
          {groups.map((group) => (
            <div key={group.id} className="space-y-1">
              {group.label && <GroupLabel>{group.label}</GroupLabel>}
              {group.items.map((item) => (
                <NavButton
                  key={item.destination}
                  item={item}
                  active={DESTINATIONS[item.destination].path === activePath}
                  onSelect={handleNav}
                />
              ))}
            </div>
          ))}
        </nav>
        <a
          href={`${MARKETING_URL}/contact`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onNavigate?.()}
          className="mx-3 mt-6 block w-fit text-sm text-text-muted transition-colors hover:text-text-primary"
        >
          Help & Support
        </a>
      </div>

      <div className="border-t border-border-subtle p-3">
        {person && <p className="break-words px-3 py-1 text-sm font-medium text-text-primary">{person}</p>}
        <SignOutButton variant="sidebar" />
      </div>
    </aside>
  );
}

export default Sidebar;
