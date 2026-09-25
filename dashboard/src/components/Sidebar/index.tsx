import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  HouseIcon,
  WalletIcon,
  ArrowsClockwiseIcon,
  LinkIcon,
  ChartBarIcon,
  UserIcon,
  GearIcon,
  QuestionIcon,
  SignOutIcon,
  EnvelopeIcon,
  BuildingsIcon,
  FileTextIcon,
  ShieldCheckIcon,
  MegaphoneIcon,
  NewspaperIcon,
  StorefrontIcon,
  HandCoinsIcon,
} from '@phosphor-icons/react';
import { DESIGN_TOKENS } from '@ledova/shared';
import { useFeatureFlags, useRole } from '@hooks';
import { useSignOut } from '@hooks/useSignOut';
import { useUserProfile } from '@pages/user-profile/useUserProfile';
import { MARKETING_URL } from '@utils/marketingUrl';
import { Logo } from '@components/Logo';

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

interface SidebarProps {
  onNavigate?: () => void;
}

export function Sidebar({ onNavigate }: SidebarProps = {}) {
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
        { label: 'Market', path: '/asset-prices', icon: ChartBarIcon },
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
    <aside className="w-60 bg-surface-base border-r border-border-subtle/30 flex flex-col h-full">
      <div className="h-16 flex items-center px-5 border-b border-border-subtle/30">
        <Logo />
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <div className="mb-2">
          <span className="px-3 text-xs font-medium text-text-muted uppercase tracking-wider">Menu</span>
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => handleNav(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
                ${
                  active
                    ? 'bg-brand-mid/10 text-brand-light'
                    : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary'
                }`}
            >
              <Icon size={ICON_MD} weight={active ? 'fill' : 'regular'} />
              <span>{item.label}</span>
            </button>
          );
        })}

        <div className="my-4 mx-3">
          <div className="h-px bg-gradient-to-r from-transparent via-border-subtle/50 to-transparent" />
        </div>

        <div className="mb-2">
          <span className="px-3 text-xs font-medium text-text-muted uppercase tracking-wider">Account</span>
        </div>
        {secondaryNavItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => handleNav(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
                ${
                  active
                    ? 'bg-brand-mid/10 text-brand-light'
                    : 'text-text-secondary hover:bg-surface-raised hover:text-text-primary'
                }`}
            >
              <Icon size={ICON_MD} weight={active ? 'fill' : 'regular'} />
              <span>{item.label}</span>
            </button>
          );
        })}
        <a
          href={`${MARKETING_URL}/contact`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onNavigate?.()}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 text-text-secondary hover:bg-surface-raised hover:text-text-primary"
        >
          <QuestionIcon size={ICON_MD} />
          <span>Help & Support</span>
        </a>
      </nav>

      <div className="p-3 border-t border-border-subtle/30 space-y-2">
        {userProfile?.email && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-raised/50">
            <EnvelopeIcon size={ICON_MD} className="text-text-muted flex-shrink-0" />
            <span className="text-sm text-text-secondary truncate">{userProfile.email}</span>
          </div>
        )}
        <button
          onClick={signOut}
          disabled={isSigningOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:bg-error/10 hover:text-error-light transition-all duration-150 disabled:opacity-50"
        >
          <SignOutIcon size={ICON_MD} />
          <span>{isSigningOut ? 'Signing out...' : 'Sign Out'}</span>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
