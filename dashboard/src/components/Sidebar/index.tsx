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
  FilesIcon,
  UsersIcon,
} from '@phosphor-icons/react';
import { DESTINATIONS, useFeatureFlags, type DestinationKey } from '@ledova/shared';
import { ICON_MD } from '@components/iconSizes';
import { useRole } from '@hooks/useRole';
import { useUserProfile } from '@pages/user-profile/useUserProfile';
import { SITE_URL } from '@utils/siteUrl';
import { Logo } from '@components/Logo';
import { NotificationBell } from '@components/NotificationBell';
import { SignOutButton } from '@components/SignOutButton';
import { useRegisterEntry } from '@pages/company/register/useCompanyRegister';

type Icon = React.ComponentType<{ size?: number; weight?: 'regular' | 'fill' }>;

interface NavItem {
  destination: DestinationKey;
  icon: Icon;
  hash?: string;
  label?: string;
}

interface NavGroup {
  id: string;
  label?: string;
  items: NavItem[];
}

const COMPANY: NavItem[] = [
  { destination: 'companyRegister', icon: BookOpenIcon },
  { destination: 'companyRegister', hash: 'awards', label: 'Employee awards', icon: UsersIcon },
  { destination: 'companyRegister', hash: 'documents', label: 'Documents', icon: FilesIcon },
  { destination: 'company', icon: BuildingsIcon },
];

const YOUR_SHARES: NavItem[] = [{ destination: 'home', label: 'My shares', icon: HouseIcon }];

const HISTORY: NavItem[] = [
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
  { destination: 'userProfile', icon: UserIcon },
  { destination: 'settings', icon: GearIcon },
];

const ITEM_CLASS = 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors';
const IDLE_CLASS = 'text-text-secondary hover:bg-surface-tertiary hover:text-text-primary';

function itemPath(item: NavItem) {
  return `${DESTINATIONS[item.destination].path}${item.hash ? `#${item.hash}` : ''}`;
}

function GroupLabel({ children }: { children: string }) {
  return (
    <p className="mb-1 break-words px-3 text-xs font-medium uppercase tracking-wider text-text-muted">{children}</p>
  );
}

function NavButton({ item, active, onSelect }: { item: NavItem; active: boolean; onSelect: (path: string) => void }) {
  const Icon = item.icon;
  const { title } = DESTINATIONS[item.destination];
  return (
    <button
      onClick={() => onSelect(itemPath(item))}
      aria-current={active ? 'page' : undefined}
      className={`${ITEM_CLASS} ${active ? 'bg-brand-mid/10 text-brand-light' : IDLE_CLASS}`}
    >
      <Icon size={ICON_MD} weight={active ? 'fill' : 'regular'} />
      <span>{item.label ?? title}</span>
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
  const registerAccess = useRegisterEntry();
  const hasCompanyWorkspace = registerAccess;
  const { userProfile } = useUserProfile();
  const person = userProfile?.fullName?.trim() || userProfile?.email;

  const groups: NavGroup[] = [
    ...(hasCompanyWorkspace ? [{ id: 'company', label: DESTINATIONS.company.title, items: COMPANY }] : []),
    { id: 'shares', label: 'Your shares', items: YOUR_SHARES },
    { id: 'yours', items: YOURS },
  ];
  const secondaryGroups: NavGroup[] = [
    { id: 'history', items: HISTORY },
    ...(isInvestor
      ? [{ id: 'invest', label: 'Invest', items: INVEST.filter((item) => item !== MARKET || tradingEnabled) }]
      : []),
    {
      id: 'yours',
      items: [
        ...(!hasCompanyWorkspace ? [{ destination: 'company' as const, icon: BuildingsIcon }] : []),
        ...(isCompany ? [{ destination: 'companyOffering' as const, icon: MegaphoneIcon }] : []),
        { destination: 'wallets', icon: WalletIcon },
      ],
    },
  ];

  const allItems = [...groups, ...secondaryGroups].flatMap((group) => group.items);
  const activePath = allItems
    .map(itemPath)
    .filter((path) => {
      const [pathname, hash] = path.split('#');
      return (
        (location.pathname === pathname || location.pathname.startsWith(`${pathname}/`)) &&
        (hash ? location.hash === `#${hash}` : !location.hash || pathname !== DESTINATIONS.companyRegister.path)
      );
    })
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
                  key={itemPath(item)}
                  item={item}
                  active={itemPath(item) === activePath}
                  onSelect={handleNav}
                />
              ))}
            </div>
          ))}
          <details open={secondaryGroups.some((group) => group.items.some((item) => itemPath(item) === activePath))}>
            <summary className={`${ITEM_CLASS} ${IDLE_CLASS} cursor-pointer`}>More</summary>
            <div className="space-y-4 pt-2">
              {secondaryGroups.map((group) => (
                <div key={group.id} className="space-y-1">
                  {group.label && <GroupLabel>{group.label}</GroupLabel>}
                  {group.items.map((item) => (
                    <NavButton
                      key={itemPath(item)}
                      item={item}
                      active={itemPath(item) === activePath}
                      onSelect={handleNav}
                    />
                  ))}
                </div>
              ))}
            </div>
          </details>
        </nav>
        <a
          href={`${SITE_URL}/contact`}
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
