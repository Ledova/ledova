import { Link, useLocation } from 'react-router-dom';
import {
  HouseIcon,
  WalletIcon,
  ArrowsClockwiseIcon,
  LinkIcon,
  GearIcon,
  ShieldCheckIcon,
  MegaphoneIcon,
  NewspaperIcon,
  StorefrontIcon,
  HandCoinsIcon,
  BookOpenIcon,
  FilesIcon,
  UsersIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';
import { DESTINATIONS, useFeatureFlags, type DestinationKey } from '@ledova/shared';
import { ICON_MD } from './iconSizes';
import { useRole } from '@hooks/useRole';
import { useUserProfile } from '@hooks/useUserProfile';
import { SITE_URL } from '@utils/siteUrl';
import { Logo } from './Logo';
import { NotificationBell } from './NotificationBell';
import { SignOutButton } from './SignOutButton';
import { ThemeToggle } from './ThemeToggle';
import { useRegisterEntry } from '@hooks/useRegisterAccess';
import { COMPANY_DASHBOARD_PATH, SITE_PATHS } from '@utils/paths';
import { pageTitle, placesAt } from '@utils/destinations';

type Icon = React.ComponentType<{ size?: number; weight?: 'regular' | 'fill' }>;

interface NavItem {
  destination: DestinationKey | 'companyDashboard';
  icon: Icon;
  view?: string;
  label?: string;
}

interface NavGroup {
  id: string;
  label?: string;
  items: NavItem[];
}

const COMPANY: NavItem[] = [
  { destination: 'companyDashboard', icon: HouseIcon },
  { destination: 'companyRegister', icon: BookOpenIcon },
  { destination: 'companyRegister', view: 'shareholders', icon: UsersThreeIcon },
  { destination: 'companyRegister', view: 'awards', icon: UsersIcon },
  { destination: 'companyRegister', view: 'documents', icon: FilesIcon },
];

const PERSONAL: NavItem[] = [
  { destination: 'home', icon: HouseIcon },
  { destination: 'home', view: 'documents', icon: FilesIcon },
];

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

const YOURS: NavItem[] = [{ destination: 'settings', icon: GearIcon }];

const ITEM_CLASS = 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors';
const IDLE_CLASS = 'text-text-secondary hover:bg-surface-tertiary hover:text-text-primary';

function itemPath(item: NavItem) {
  const path = item.destination === 'companyDashboard' ? COMPANY_DASHBOARD_PATH : DESTINATIONS[item.destination].path;
  return `${path}${item.view ? `#${item.view}` : ''}`;
}

function GroupLabel({ children }: { children: string }) {
  return (
    <p className="mb-1 break-words px-3 text-xs font-medium uppercase tracking-wider text-text-muted">{children}</p>
  );
}

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  const title = item.destination === 'companyDashboard' ? 'Dashboard' : pageTitle(item.destination, item.view);
  return (
    <Link
      to={itemPath(item)}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`${ITEM_CLASS} ${active ? 'bg-brand-mid/10 text-brand-light dark:bg-brand-tint' : IDLE_CLASS}`}
    >
      <Icon size={ICON_MD} weight={active ? 'fill' : 'regular'} />
      <span>{item.label ?? title}</span>
    </Link>
  );
}

interface SidebarProps {
  onNavigate?: () => void;
  withNotifications?: boolean;
}

export function Sidebar({ onNavigate, withNotifications = false }: SidebarProps = {}) {
  const location = useLocation();
  const tradingEnabled = useFeatureFlags().isEnabled('trading_enabled');
  const { isInvestor, isCompany } = useRole();
  const registerAccess = useRegisterEntry();
  const hasCompanyWorkspace = registerAccess;
  const { userProfile } = useUserProfile();
  const person = userProfile?.fullName?.trim() || userProfile?.email;

  const groups: NavGroup[] = [
    ...(hasCompanyWorkspace ? [{ id: 'company', label: DESTINATIONS.company.title, items: COMPANY }] : []),
    ...(hasCompanyWorkspace
      ? [
          {
            id: 'shares',
            label: 'Personal',
            items: [{ destination: 'home' as const, label: 'Your shares', icon: HouseIcon }],
          },
        ]
      : [{ id: 'shares', items: PERSONAL }]),
    { id: 'yours', label: 'Configuration', items: YOURS },
  ];
  const secondaryGroups: NavGroup[] = [
    { id: 'history', items: HISTORY },
    ...(isInvestor
      ? [{ id: 'invest', label: 'Invest', items: INVEST.filter((item) => item !== MARKET || tradingEnabled) }]
      : []),
    {
      id: 'yours',
      items: [
        ...(isCompany ? [{ destination: 'companyOffering' as const, icon: MegaphoneIcon }] : []),
        { destination: 'wallets', icon: WalletIcon },
      ],
    },
  ];

  const allItems = [...groups, ...secondaryGroups].flatMap((group) => group.items);
  const activeItem =
    location.pathname === COMPANY_DASHBOARD_PATH
      ? allItems.find((item) => item.destination === 'companyDashboard')
      : placesAt(location.pathname, location.hash)
          .map(
            (place) =>
              allItems.find((item) => item.destination === place.destination && item.view === place.view) ??
              allItems.find((item) => item.destination === place.destination && !item.view),
          )
          .find(Boolean);
  const activePath = activeItem && itemPath(activeItem);

  return (
    <aside className="flex h-full w-52 flex-col border-r border-border-subtle bg-surface-base">
      <div className="flex h-16 flex-shrink-0 items-center justify-between pl-5 pr-3">
        <Logo />
        {withNotifications && <NotificationBell align="start" />}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <nav aria-label="Main" className="space-y-6">
          {groups.map((group) => (
            <div key={group.id} className="space-y-1">
              {group.label && <GroupLabel>{group.label}</GroupLabel>}
              {group.items.map((item) => (
                <NavLink
                  key={itemPath(item)}
                  item={item}
                  active={itemPath(item) === activePath}
                  onNavigate={onNavigate}
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
                    <NavLink
                      key={itemPath(item)}
                      item={item}
                      active={itemPath(item) === activePath}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              ))}
            </div>
          </details>
        </nav>
        <a
          href={`${SITE_URL}${SITE_PATHS.contact}`}
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
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <SignOutButton variant="sidebar" />
          </div>
          <div className="hidden lg:block">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </aside>
  );
}
