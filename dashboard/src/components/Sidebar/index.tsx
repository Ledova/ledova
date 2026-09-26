import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
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
import { DESIGN_TOKENS } from '@ledova/shared';
import { useFeatureFlags } from '@hooks/useFeatureFlags';
import { useRole } from '@hooks/useRole';
import { useSignOut } from '@hooks/useSignOut';
import { useUserProfile } from '@pages/user-profile/useUserProfile';
import { MARKETING_URL } from '@utils/marketingUrl';
import { Logo } from '@components/Logo';
import { NotificationBell } from '@components/NotificationBell';

const ICON_MD = DESIGN_TOKENS.icon.sizes.md;

interface NavItem {
  label: string;
  path: string;
  icon: React.ComponentType<{ size?: number; weight?: 'regular' | 'fill' }>;
}

const secondaryNavItems: NavItem[] = [
  { label: 'Profile', path: '/user-profile', icon: UserIcon },
  { label: 'Settings', path: '/settings', icon: GearIcon },
];

const ITEM_CLASS = 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors';
const IDLE_CLASS = 'text-text-secondary hover:bg-surface-tertiary hover:text-text-primary';

function GroupLabel({ children }: { children: string }) {
  return <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wider text-text-muted">{children}</p>;
}

function NavButton({ item, active, onSelect }: { item: NavItem; active: boolean; onSelect: (path: string) => void }) {
  const Icon = item.icon;
  return (
    <button
      onClick={() => onSelect(item.path)}
      aria-current={active ? 'page' : undefined}
      className={`${ITEM_CLASS} ${active ? 'bg-brand-mid/10 text-brand-light' : IDLE_CLASS}`}
    >
      <Icon size={ICON_MD} weight={active ? 'fill' : 'regular'} />
      <span>{item.label}</span>
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
  const { tradingEnabled } = useFeatureFlags();
  const { isInvestor, isCompany } = useRole();
  const { userProfile } = useUserProfile();

  const navItems = useMemo((): NavItem[] => {
    const items: NavItem[] =
      isCompany && !isInvestor
        ? [
            { label: 'Company', path: '/company', icon: BuildingsIcon },
            { label: 'Listing', path: '/company/listing', icon: FileTextIcon },
            { label: 'Offering', path: '/company/offering', icon: MegaphoneIcon },
            { label: 'Wallets', path: '/wallets', icon: WalletIcon },
          ]
        : [
            { label: 'Home', path: '/home', icon: HouseIcon },
            { label: 'Wallets', path: '/wallets', icon: WalletIcon },
          ];

    if (tradingEnabled && isInvestor) {
      items.push({ label: 'Trading', path: '/trading', icon: ArrowsClockwiseIcon });
    }

    if (isInvestor) {
      items.push(
        { label: 'Transactions', path: '/transactions', icon: LinkIcon },
        { label: 'Directory', path: '/directory', icon: StorefrontIcon },
        { label: 'Subscriptions', path: '/subscriptions', icon: HandCoinsIcon },
        { label: 'Eligibility', path: '/investor-eligibility', icon: ShieldCheckIcon },
      );
    }

    if (isCompany && isInvestor) {
      items.push(
        { label: 'Company', path: '/company', icon: BuildingsIcon },
        { label: 'Offering', path: '/company/offering', icon: MegaphoneIcon },
      );
    }

    items.push({ label: 'Publications', path: '/publications', icon: NewspaperIcon });

    return items;
  }, [tradingEnabled, isInvestor, isCompany]);

  const { signOut, isSigningOut } = useSignOut();

  const isActive = (path: string) => location.pathname === path;

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
        <div className="space-y-1">
          <GroupLabel>Menu</GroupLabel>
          {navItems.map((item) => (
            <NavButton key={item.path} item={item} active={isActive(item.path)} onSelect={handleNav} />
          ))}
        </div>

        <div className="space-y-1">
          <GroupLabel>Account</GroupLabel>
          {secondaryNavItems.map((item) => (
            <NavButton key={item.path} item={item} active={isActive(item.path)} onSelect={handleNav} />
          ))}
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
        </div>
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
