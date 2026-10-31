import { useId, useState, type ReactNode } from 'react';
import { Link, matchPath, useLocation, type Location } from 'react-router-dom';
import {
  HouseIcon,
  GearIcon,
  BookOpenIcon,
  FilesIcon,
  UsersThreeIcon,
  ShieldCheckIcon,
  CaretDownIcon,
  CaretRightIcon,
} from '@phosphor-icons/react';
import { DESTINATIONS, type DestinationKey } from '@ledova/shared';
import { ICON_MD } from './iconSizes';
import { useRole } from '@hooks/useRole';
import { useUserProfile } from '@hooks/useUserProfile';
import { useSettingsNavigation } from '@hooks/useSettingsNavigation';
import { Logo } from './Logo';
import { NotificationBell } from './NotificationBell';
import { SignOutButton } from './SignOutButton';
import { ThemeToggle } from './ThemeToggle';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { certificatesLocation } from '@utils/paths';
import {
  destinationAt,
  pageTitle,
  placesAt,
  SHAREHOLDER_VIEWS,
  DOCUMENT_VIEWS,
  LEDGER_TASKS,
  documentView,
  ledgerTask,
  SETTINGS_VIEWS,
  settingsView,
  type LedgerTask,
} from '@utils/destinations';
import { useLedgerNavigation, type LedgerNavigationState } from './LedgerNavigation';

type Icon = React.ComponentType<{ size?: number; weight?: 'regular' | 'fill' }>;

interface NavItem {
  destination: DestinationKey;
  icon: Icon;
  view?: string;
  label?: string;
}

interface NavSection {
  id: string;
  items: NavItem[];
}

const COMPANY: NavItem[] = [
  { destination: 'home', icon: HouseIcon },
  { destination: 'companyRegister', icon: BookOpenIcon },
  { destination: 'companyRegister', view: 'shareholders', icon: UsersThreeIcon },
  { destination: 'certificates', icon: FilesIcon },
];

const ELIGIBILITY = {
  destination: 'companyEligibility',
  icon: ShieldCheckIcon,
  label: 'Eligibility',
} satisfies NavItem;
const INVESTOR_ELIGIBILITY: NavItem = {
  destination: 'investorEligibility',
  icon: ShieldCheckIcon,
  label: 'Eligibility',
};

const PERSONAL: NavItem[] = [
  { destination: 'home', icon: HouseIcon },
  { destination: 'certificates', icon: FilesIcon },
];

const YOURS: NavItem[] = [{ destination: 'settings', icon: GearIcon }];

const ITEM_CLASS = 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors';
const IDLE_CLASS = 'text-text-secondary hover:bg-surface-tertiary hover:text-text-primary';
const CURRENT_CLASS = 'bg-brand-mid/10 text-brand-light dark:bg-brand-tint';
const LEDGER_TASK_PARENTS: Partial<Record<DestinationKey, LedgerTask>> = {
  companyRegisterTransfer: 'transfer',
  companyRegisterCorrection: 'corrections',
  companyRegisterParticulars: 'corrections',
};

function itemPath(item: NavItem) {
  const path = DESTINATIONS[item.destination].path;
  return `${path}${item.view ? `#${item.view}` : ''}`;
}

function ledgerContext(
  location: Location,
  state: LedgerNavigationState | null,
  companyUuid: string | null | undefined,
) {
  const path = DESTINATIONS.companyRegister.path;
  const destination = destinationAt(location.pathname);
  const classPath =
    destination &&
    (destination === 'companyClass' ||
      destination === 'companyRegisterImport' ||
      destination === 'companyRegisterAward' ||
      LEDGER_TASK_PARENTS[destination])
      ? DESTINATIONS[destination].path
      : undefined;
  const classParams = classPath ? matchPath(classPath, location.pathname)?.params : undefined;
  const company =
    (location.pathname === path ? state?.company : classParams?.company) ??
    (typeof location.state?.registerCompany === 'string'
      ? location.state.registerCompany
      : (new URLSearchParams(location.search).get('company') ?? companyUuid ?? undefined));
  const token =
    location.pathname === path
      ? state?.token
      : location.pathname === DESTINATIONS.certificates.path
        ? (new URLSearchParams(location.search).get('class') ?? location.state?.registerToken)
        : classParams?.uuid;
  return company || token ? { registerCompany: company, registerToken: token } : undefined;
}

function NavLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  const context = useCompanyContext();
  const title = pageTitle(item.destination, item.view);
  return (
    <Link
      to={context?.companyPath(itemPath(item)) ?? itemPath(item)}
      onClick={(event) => {
        if (item.destination === 'home' && !item.view && context) {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          if (context.openDashboard()) onNavigate?.();
        } else onNavigate?.();
      }}
      title={item.label ? title : undefined}
      aria-current={active ? 'page' : undefined}
      className={`${ITEM_CLASS} ${active ? CURRENT_CLASS : IDLE_CLASS}`}
    >
      <Icon size={ICON_MD} weight={active ? 'fill' : 'regular'} />
      <span>{item.label ?? title}</span>
    </Link>
  );
}

interface GroupItem {
  key: string;
  label: string;
  to: string;
  title?: string;
  current: boolean;
  blocked?: boolean;
}

function GroupLink({
  to,
  state,
  title,
  current,
  blocked = false,
  onNavigate,
  className = '',
  children,
}: Omit<GroupItem, 'key' | 'label'> & {
  state?: unknown;
  onNavigate?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const context = useCompanyContext();
  return (
    <Link
      to={context?.companyPath(to) ?? to}
      state={state}
      title={title}
      onClick={(event) => {
        if (blocked) event.preventDefault();
        else onNavigate?.();
      }}
      onAuxClick={(event) => {
        if (blocked) event.preventDefault();
      }}
      aria-current={current ? 'page' : undefined}
      aria-disabled={blocked || undefined}
      className={`${ITEM_CLASS} ${className} ${current ? CURRENT_CLASS : IDLE_CLASS} ${blocked ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      {children}
    </Link>
  );
}

function NavGroup({
  icon: Icon,
  label,
  title,
  to,
  state,
  active,
  current,
  blocked,
  items,
  onNavigate,
}: {
  icon: Icon;
  label: string;
  title?: string;
  to: string;
  state?: unknown;
  active: boolean;
  current: boolean;
  blocked?: boolean;
  items: GroupItem[];
  onNavigate?: () => void;
}) {
  const location = useLocation();
  const place = `${location.pathname}${location.hash}`;
  const [shownPlace, setShownPlace] = useState(place);
  const [expanded, setExpanded] = useState(active);
  const id = useId();
  const Caret = expanded ? CaretDownIcon : CaretRightIcon;

  if (shownPlace !== place) {
    setShownPlace(place);
    if (active) setExpanded(true);
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        <GroupLink
          to={to}
          state={state}
          title={title}
          current={current}
          blocked={blocked}
          onNavigate={onNavigate}
          className="min-w-0 flex-1"
        >
          <Icon size={ICON_MD} weight={active ? 'fill' : 'regular'} />
          <span>{label}</span>
        </GroupLink>
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label} navigation`}
            aria-expanded={expanded}
            aria-controls={id}
            className={`${IDLE_CLASS} flex h-10 w-8 shrink-0 items-center justify-center rounded-lg`}
          >
            <Caret size={16} />
          </button>
        )}
      </div>
      {items.length > 0 && (
        <div id={id} hidden={!expanded} className="ml-5 mt-1 space-y-1 border-l border-border-subtle pl-3">
          {items.map(({ key, label, ...item }) => (
            <GroupLink key={key} {...item} state={state} onNavigate={onNavigate}>
              {label}
            </GroupLink>
          ))}
        </div>
      )}
    </div>
  );
}

function LedgerGroup({ active, onNavigate }: { active: boolean; onNavigate?: () => void }) {
  const companyContext = useCompanyContext();
  const location = useLocation();
  const { state } = useLedgerNavigation();
  const path = DESTINATIONS.companyRegister.path;
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
    (destination === 'companyClass' ||
      destination === 'companyRegisterImport' ||
      destination === 'companyRegisterAward' ||
      LEDGER_TASK_PARENTS[destination])
      ? DESTINATIONS[destination].path
      : undefined;
  const classParams = classPath ? matchPath(classPath, location.pathname)?.params : undefined;
  const context =
    location.pathname === path
      ? { registerCompany: state?.company ?? companyContext?.companyUuid, registerToken: state?.token }
      : classParams
        ? { registerCompany: classParams.company, registerToken: classParams.uuid }
        : companyContext?.companyUuid
          ? { registerCompany: companyContext.companyUuid }
          : undefined;

  return (
    <NavGroup
      icon={BookOpenIcon}
      label={pageTitle('companyRegister')}
      to={path}
      state={context}
      active={active}
      current={active && !selectedTask}
      blocked={blocks()}
      onNavigate={onNavigate}
      items={tasks.map(([key, label]) => ({
        key,
        label,
        to: `${path}#${key}`,
        current: task === key,
        blocked: blocks(key),
      }))}
    />
  );
}

function ShareholdersGroup({ active, onNavigate }: { active: boolean; onNavigate?: () => void }) {
  const companyContext = useCompanyContext();
  const location = useLocation();
  const { state } = useLedgerNavigation();
  const path = DESTINATIONS.companyRegister.path;
  const children = Object.entries(SHAREHOLDER_VIEWS);
  const routedView =
    location.pathname === path
      ? location.hash.slice(1)
      : destinationAt(location.pathname) === 'companyRegisterAward'
        ? 'awards'
        : '';
  const selected = state?.blocked && state.shareholderView ? state.shareholderView : routedView;
  const selectedChild = children.some(([key]) => key === selected);
  const blocked = location.pathname === path && (!state || state.blocked);
  const blocks = (view: string) => blocked && view !== (state?.shareholderView ?? selected);

  return (
    <NavGroup
      icon={UsersThreeIcon}
      label={pageTitle('companyRegister', 'shareholders')}
      to={`${path}#shareholders`}
      state={ledgerContext(location, state, companyContext?.companyUuid)}
      active={active}
      current={active && !selectedChild}
      blocked={blocks('shareholders')}
      onNavigate={onNavigate}
      items={children.map(([key, label]) => ({
        key,
        label: key === 'awards' ? 'Employee scheme' : label,
        title: key === 'awards' ? label : undefined,
        to: `${path}#${key}`,
        current: selected === key,
        blocked: blocks(key),
      }))}
    />
  );
}

function DocumentsGroup({ active, onNavigate }: { active: boolean; onNavigate?: () => void }) {
  const companyContext = useCompanyContext();
  const { isCompany } = useRole();
  const location = useLocation();
  const { state } = useLedgerNavigation();
  const path = DESTINATIONS.companyRegister.path;
  const selected =
    location.pathname === DESTINATIONS.certificates.path
      ? 'certificates'
      : location.pathname === DESTINATIONS.companyPublications.path
        ? 'publications'
        : location.pathname === path
          ? documentView(location.hash.slice(1))
          : undefined;
  const context = ledgerContext(location, state, companyContext?.companyUuid);
  const certificateTarget = certificatesLocation({ search: '', state: context });
  const certificatePath = `${certificateTarget.pathname}${certificateTarget.search}`;
  const certificatesBlocked = location.pathname === path && !!state?.held;
  const items: GroupItem[] = DOCUMENT_VIEWS.filter(
    ({ key }) => key === 'certificates' || companyContext?.company?.canReadRegister,
  ).map(({ key, label }) => ({
    key,
    label,
    to: key === 'certificates' ? certificatePath : `${path}#${key}`,
    current: selected === key,
    blocked: key === 'certificates' && certificatesBlocked,
  }));
  if (companyContext?.company?.isOwner && isCompany)
    items.splice(1, 0, {
      key: 'publications',
      label: 'Published',
      title: pageTitle('companyPublications'),
      to: DESTINATIONS.companyPublications.path,
      current: selected === 'publications',
      blocked: certificatesBlocked,
    });
  const single = items.length === 1;

  return (
    <NavGroup
      icon={FilesIcon}
      label="Documents"
      to={certificatePath}
      state={context}
      active={active}
      current={single && active}
      blocked={certificatesBlocked}
      onNavigate={onNavigate}
      items={single ? [] : items}
    />
  );
}

function EligibilityGroup({ active, onNavigate }: { active: boolean; onNavigate?: () => void }) {
  const location = useLocation();
  const supporting = location.pathname === DESTINATIONS.companyDocuments.path;
  return (
    <NavGroup
      icon={ShieldCheckIcon}
      label={ELIGIBILITY.label}
      title={pageTitle('companyEligibility')}
      to={DESTINATIONS.companyEligibility.path}
      active={active}
      current={active && !supporting}
      onNavigate={onNavigate}
      items={[
        {
          key: 'supporting',
          label: 'Supporting',
          title: 'Company documents',
          to: DESTINATIONS.companyDocuments.path,
          current: supporting,
        },
      ]}
    />
  );
}

function SettingsGroup({
  active,
  navigation,
  onNavigate,
}: {
  active: boolean;
  navigation: ReturnType<typeof useSettingsNavigation>;
  onNavigate?: () => void;
}) {
  const context = useCompanyContext();
  const location = useLocation();
  const selected = settingsView(location.pathname, location.hash);
  const items = SETTINGS_VIEWS.filter(
    (item) =>
      (item.key === 'profile' || !!context?.company?.canManage) &&
      (selected === item.key || navigation.items.includes(item)),
  );
  const single = items.length === 1;

  return (
    <NavGroup
      icon={GearIcon}
      label="Settings"
      to={navigation.defaultPath}
      active={active}
      current={single && active}
      onNavigate={onNavigate}
      items={single ? [] : items.map(({ key, label, to }) => ({ key, label, to, current: selected === key }))}
    />
  );
}

interface SidebarProps {
  onNavigate?: () => void;
  withNotifications?: boolean;
}

export function Sidebar({ onNavigate, withNotifications = false }: SidebarProps = {}) {
  const location = useLocation();
  const context = useCompanyContext();
  const settings = useSettingsNavigation();
  const companyTasks = !!(context?.company?.canReadRegister || context?.company?.canManage);
  const companyItems = [
    ...(context?.company?.canReadRegister
      ? COMPANY
      : [
          ...COMPANY.filter((item) => item.destination === 'home'),
          ...(context?.company?.memberUuids.length ? [PERSONAL[1]!] : []),
        ]),
    ...(context?.company?.canReviewEligibility ? [ELIGIBILITY] : []),
  ];
  const role = useRole();
  const { userProfile } = useUserProfile();
  const person = userProfile?.fullName?.trim() || userProfile?.email;
  const investorEligibility =
    companyTasks && companyItems.includes(ELIGIBILITY)
      ? { ...INVESTOR_ELIGIBILITY, label: 'Your eligibility' }
      : INVESTOR_ELIGIBILITY;

  const groups: NavSection[] = [
    ...(companyTasks ? [{ id: 'company', items: companyItems }] : []),
    ...(!companyTasks ? [{ id: 'shares', items: PERSONAL }] : []),
    { id: 'yours', items: role.isKnown && role.isInvestor ? [investorEligibility, ...YOURS] : YOURS },
  ];
  const allItems = groups.flatMap((group) => group.items);
  const activeItem = placesAt(location.pathname, location.hash)
    .map(
      (place) =>
        allItems.find((item) => item.destination === place.destination && item.view === place.view) ??
        (place.destination === 'companyRegister' &&
        Object.prototype.hasOwnProperty.call(SHAREHOLDER_VIEWS, place.view ?? '')
          ? allItems.find((item) => item.destination === 'companyRegister' && item.view === 'shareholders')
          : undefined) ??
        ((place.destination === 'companyRegister' && documentView(place.view)) ||
        (place.destination === 'home' && place.view === 'documents')
          ? allItems.find((item) => item.destination === 'certificates')
          : undefined) ??
        allItems.find((item) => item.destination === place.destination && !item.view),
    )
    .find(Boolean);
  const activePath =
    location.pathname === DESTINATIONS.companyDocuments.path ||
    (location.pathname === DESTINATIONS.company.path && location.hash === '#documents')
      ? itemPath(ELIGIBILITY)
      : location.pathname === DESTINATIONS.companyPublications.path
        ? DESTINATIONS.certificates.path
        : activeItem && itemPath(activeItem);

  return (
    <aside className="flex h-full w-52 flex-col border-r border-border-subtle bg-surface-base">
      <div className="flex h-16 flex-shrink-0 items-center justify-between pl-5 pr-3">
        <Logo />
        {withNotifications && <NotificationBell align="start" />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <nav aria-label="Main" className="space-y-6">
          {groups.map((group) => (
            <div key={group.id} className="space-y-1">
              {group.items.map((item) =>
                item.destination === 'companyRegister' && !item.view ? (
                  <LedgerGroup key={itemPath(item)} active={itemPath(item) === activePath} onNavigate={onNavigate} />
                ) : item.destination === 'companyRegister' && item.view === 'shareholders' ? (
                  <ShareholdersGroup
                    key={itemPath(item)}
                    active={itemPath(item) === activePath}
                    onNavigate={onNavigate}
                  />
                ) : item.destination === 'certificates' ? (
                  <DocumentsGroup key={itemPath(item)} active={itemPath(item) === activePath} onNavigate={onNavigate} />
                ) : item.destination === 'companyEligibility' && context?.company?.canManage ? (
                  <EligibilityGroup
                    key={itemPath(item)}
                    active={itemPath(item) === activePath}
                    onNavigate={onNavigate}
                  />
                ) : item.destination === 'settings' ? (
                  <SettingsGroup
                    key={itemPath(item)}
                    active={itemPath(item) === activePath}
                    navigation={settings}
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
        </nav>
      </div>

      <div className="shrink-0 border-t border-border-subtle p-3">
        <div className="min-w-0 space-y-1 px-3 py-1">
          {person && (
            <p className="truncate text-xs font-medium text-text-primary" title={person}>
              {person}
            </p>
          )}
          {context?.company && (
            <p className="truncate text-xs text-text-muted" title={context.company.name}>
              {context.company.name}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <SignOutButton variant="sidebar" />
          </div>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
