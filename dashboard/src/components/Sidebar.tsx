import { useId, useState } from 'react';
import { Link, matchPath, useLocation } from 'react-router-dom';
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
  UsersThreeIcon,
  CaretDownIcon,
  CaretRightIcon,
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
import {
  destinationAt,
  pageTitle,
  placesAt,
  SHAREHOLDER_VIEWS,
  LEDGER_TASKS,
  ledgerTask,
  type LedgerTask,
} from '@utils/destinations';
import { useLedgerNavigation } from './LedgerNavigation';

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
const LEDGER_TASK_PARENTS: Partial<Record<DestinationKey, LedgerTask>> = {
  companyRegisterTransfer: 'transfer',
  companyRegisterCorrection: 'corrections',
  companyRegisterOpening: 'corrections',
  companyRegisterLinks: 'corrections',
  companyRegisterParticulars: 'corrections',
};

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

function LedgerGroup({ active, onNavigate }: { active: boolean; onNavigate?: () => void }) {
  const location = useLocation();
  const { state } = useLedgerNavigation();
  const path = DESTINATIONS.companyRegister.path;
  const current = active;
  const place = `${location.pathname}${location.hash}`;
  const [shownPlace, setShownPlace] = useState(place);
  const [expanded, setExpanded] = useState(current);
  const id = useId();
  const tasks = Object.entries(LEDGER_TASKS);
  const hashTask = location.pathname === path ? location.hash.slice(1) : '';
  const routedTask = ledgerTask(hashTask);
  const destination = destinationAt(location.pathname);
  const task =
    active && location.pathname === path
      ? state?.blocked && state.task
        ? state.task
        : (routedTask ?? state?.task)
      : destination && LEDGER_TASK_PARENTS[destination];
  const selectedTask = tasks.some(([key]) => key === task);
  const blocked = location.pathname === path && (!state || state.blocked);
  const blocks = (task?: string) => blocked && !(task && state?.task === task && !routedTask);
  const classPath =
    destination &&
    (destination === 'companyClass' || destination === 'companyRegisterImport' || LEDGER_TASK_PARENTS[destination])
      ? DESTINATIONS[destination].path
      : undefined;
  const classParams = classPath ? matchPath(classPath, location.pathname)?.params : undefined;
  const context =
    location.pathname === path
      ? { registerCompany: state?.company, registerToken: state?.token }
      : classParams
        ? { registerCompany: classParams.company, registerToken: classParams.uuid }
        : undefined;
  const Caret = expanded ? CaretDownIcon : CaretRightIcon;

  if (shownPlace !== place) {
    setShownPlace(place);
    if (current) setExpanded(true);
  }

  const navigate = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (blocks(event.currentTarget.hash.slice(1) || undefined)) event.preventDefault();
    else onNavigate?.();
  };

  return (
    <div>
      <div className="flex items-center gap-1">
        <Link
          to={path}
          state={context}
          onClick={navigate}
          onAuxClick={(event) => {
            if (blocks()) event.preventDefault();
          }}
          aria-current={active && !selectedTask ? 'page' : undefined}
          aria-disabled={blocked || undefined}
          className={`${ITEM_CLASS} min-w-0 flex-1 ${active && !selectedTask ? 'bg-brand-mid/10 text-brand-light dark:bg-brand-tint' : IDLE_CLASS} ${blocked ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <BookOpenIcon size={ICON_MD} weight={active ? 'fill' : 'regular'} />
          <span>{pageTitle('companyRegister')}</span>
        </Link>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} Ledger navigation`}
          aria-expanded={expanded}
          aria-controls={id}
          className={`${IDLE_CLASS} flex h-10 w-8 shrink-0 items-center justify-center rounded-lg`}
        >
          <Caret size={16} />
        </button>
      </div>
      <div id={id} hidden={!expanded} className="ml-5 mt-1 space-y-1 border-l border-border-subtle pl-3">
        {tasks.map(([key, label]) => (
          <Link
            key={key}
            to={`${path}#${key}`}
            state={context}
            onClick={navigate}
            onAuxClick={(event) => {
              if (blocks(key)) event.preventDefault();
            }}
            aria-current={task === key ? 'page' : undefined}
            aria-disabled={blocks(key) || undefined}
            className={`${ITEM_CLASS} ${task === key ? 'bg-brand-mid/10 text-brand-light dark:bg-brand-tint' : IDLE_CLASS} ${blocks(key) ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function ShareholdersGroup({ active, onNavigate }: { active: boolean; onNavigate?: () => void }) {
  const location = useLocation();
  const { state } = useLedgerNavigation();
  const path = DESTINATIONS.companyRegister.path;
  const place = `${location.pathname}${location.hash}`;
  const [shownPlace, setShownPlace] = useState(place);
  const [expanded, setExpanded] = useState(active);
  const id = useId();
  const children = Object.entries(SHAREHOLDER_VIEWS);
  const routedView = location.pathname === path ? location.hash.slice(1) : '';
  const selected = state?.blocked && state.shareholderView ? state.shareholderView : routedView;
  const selectedChild = children.some(([key]) => key === selected);
  const blocked = location.pathname === path && (!state || state.blocked);
  const blocks = (view: string) => blocked && view !== (state?.shareholderView ?? selected);
  const destination = destinationAt(location.pathname);
  const classPath =
    destination &&
    (destination === 'companyClass' || destination === 'companyRegisterImport' || LEDGER_TASK_PARENTS[destination])
      ? DESTINATIONS[destination].path
      : undefined;
  const classParams = classPath ? matchPath(classPath, location.pathname)?.params : undefined;
  const company =
    (location.pathname === path ? state?.company : classParams?.company) ??
    (typeof location.state?.registerCompany === 'string'
      ? location.state.registerCompany
      : (new URLSearchParams(location.search).get('company') ?? undefined));
  const token = location.pathname === path ? state?.token : classParams?.uuid;
  const context = company || token ? { registerCompany: company, registerToken: token } : undefined;
  const Caret = expanded ? CaretDownIcon : CaretRightIcon;

  if (shownPlace !== place) {
    setShownPlace(place);
    if (active) setExpanded(true);
  }

  const navigate = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (blocks(event.currentTarget.hash.slice(1))) event.preventDefault();
    else onNavigate?.();
  };

  return (
    <div>
      <div className="flex items-center gap-1">
        <Link
          to={`${path}#shareholders`}
          state={context}
          onClick={navigate}
          onAuxClick={(event) => {
            if (blocks('shareholders')) event.preventDefault();
          }}
          aria-current={active && !selectedChild ? 'page' : undefined}
          aria-disabled={blocks('shareholders') || undefined}
          className={`${ITEM_CLASS} min-w-0 flex-1 ${active && !selectedChild ? 'bg-brand-mid/10 text-brand-light dark:bg-brand-tint' : IDLE_CLASS} ${blocks('shareholders') ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <UsersThreeIcon size={ICON_MD} weight={active ? 'fill' : 'regular'} />
          <span>{pageTitle('companyRegister', 'shareholders')}</span>
        </Link>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} Shareholders navigation`}
          aria-expanded={expanded}
          aria-controls={id}
          className={`${IDLE_CLASS} flex h-10 w-8 shrink-0 items-center justify-center rounded-lg`}
        >
          <Caret size={16} />
        </button>
      </div>
      <div id={id} hidden={!expanded} className="ml-5 mt-1 space-y-1 border-l border-border-subtle pl-3">
        {children.map(([key, label]) => (
          <Link
            key={key}
            to={`${path}#${key}`}
            state={context}
            title={key === 'awards' ? label : undefined}
            onClick={navigate}
            onAuxClick={(event) => {
              if (blocks(key)) event.preventDefault();
            }}
            aria-current={selected === key ? 'page' : undefined}
            aria-disabled={blocks(key) || undefined}
            className={`${ITEM_CLASS} ${selected === key ? 'bg-brand-mid/10 text-brand-light dark:bg-brand-tint' : IDLE_CLASS} ${blocks(key) ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            {key === 'awards' ? 'ESS' : label}
          </Link>
        ))}
      </div>
    </div>
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
              (place.destination === 'companyRegister' &&
              Object.prototype.hasOwnProperty.call(SHAREHOLDER_VIEWS, place.view ?? '')
                ? allItems.find((item) => item.destination === 'companyRegister' && item.view === 'shareholders')
                : undefined) ??
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
              {group.items.map((item) =>
                item.destination === 'companyRegister' && !item.view ? (
                  <LedgerGroup key={itemPath(item)} active={itemPath(item) === activePath} onNavigate={onNavigate} />
                ) : item.destination === 'companyRegister' && item.view === 'shareholders' ? (
                  <ShareholdersGroup
                    key={itemPath(item)}
                    active={itemPath(item) === activePath}
                    onNavigate={onNavigate}
                  />
                ) : (
                  <NavLink
                    key={itemPath(item)}
                    item={item}
                    active={itemPath(item) === activePath}
                    onNavigate={onNavigate}
                  />
                ),
              )}
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
