import { useId, useState } from 'react';
import { Link, matchPath, useLocation, type Location } from 'react-router-dom';
import {
  HouseIcon,
  GearIcon,
  BookOpenIcon,
  FilesIcon,
  UsersThreeIcon,
  CaretDownIcon,
  CaretRightIcon,
} from '@phosphor-icons/react';
import { DESTINATIONS, type DestinationKey } from '@ledova/shared';
import { ICON_MD } from './iconSizes';
import { useUserProfile } from '@hooks/useUserProfile';
import { useSettingsNavigation } from '@hooks/useSettingsNavigation';
import { Logo } from './Logo';
import { NotificationBell } from './NotificationBell';
import { SignOutButton } from './SignOutButton';
import { ThemeToggle } from './ThemeToggle';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { CERTIFICATES_PATH, COMPANY_DOCUMENTS_PATH, certificatesLocation } from '@utils/paths';
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
}

interface NavGroup {
  id: string;
  items: NavItem[];
}

const COMPANY: NavItem[] = [
  { destination: 'home', icon: HouseIcon },
  { destination: 'companyRegister', icon: BookOpenIcon },
  { destination: 'companyRegister', view: 'shareholders', icon: UsersThreeIcon },
  { destination: 'companyRegister', view: 'certificates', icon: FilesIcon },
];

const PERSONAL: NavItem[] = [
  { destination: 'home', icon: HouseIcon },
  { destination: 'home', view: 'documents', icon: FilesIcon },
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
  if (
    (item.destination === 'companyRegister' && item.view === 'certificates') ||
    (item.destination === 'home' && item.view === 'documents')
  )
    return CERTIFICATES_PATH;
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
    (destination === 'companyClass' || destination === 'companyRegisterImport' || LEDGER_TASK_PARENTS[destination])
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
      : location.pathname === CERTIFICATES_PATH
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
      aria-current={active ? 'page' : undefined}
      className={`${ITEM_CLASS} ${active ? 'bg-brand-mid/10 text-brand-light dark:bg-brand-tint' : IDLE_CLASS}`}
    >
      <Icon size={ICON_MD} weight={active ? 'fill' : 'regular'} />
      <span>{title}</span>
    </Link>
  );
}

function LedgerGroup({ active, onNavigate }: { active: boolean; onNavigate?: () => void }) {
  const companyContext = useCompanyContext();
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
      ? { registerCompany: state?.company ?? companyContext?.companyUuid, registerToken: state?.token }
      : classParams
        ? { registerCompany: classParams.company, registerToken: classParams.uuid }
        : companyContext?.companyUuid
          ? { registerCompany: companyContext.companyUuid }
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
          to={companyContext?.companyPath(path) ?? path}
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
            to={companyContext?.companyPath(`${path}#${key}`) ?? `${path}#${key}`}
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
  const companyContext = useCompanyContext();
  const location = useLocation();
  const { state } = useLedgerNavigation();
  const path = DESTINATIONS.companyRegister.path;
  const place = `${location.pathname}${location.hash}`;
  const [shownPlace, setShownPlace] = useState(place);
  const [expanded, setExpanded] = useState(active);
  const id = useId();
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
  const context = ledgerContext(location, state, companyContext?.companyUuid);
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
          to={companyContext?.companyPath(`${path}#shareholders`) ?? `${path}#shareholders`}
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
            to={companyContext?.companyPath(`${path}#${key}`) ?? `${path}#${key}`}
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

function DocumentsGroup({ active, onNavigate }: { active: boolean; onNavigate?: () => void }) {
  const companyContext = useCompanyContext();
  const location = useLocation();
  const { state } = useLedgerNavigation();
  const path = DESTINATIONS.companyRegister.path;
  const place = `${location.pathname}${location.hash}`;
  const [shownPlace, setShownPlace] = useState(place);
  const [expanded, setExpanded] = useState(active);
  const id = useId();
  const selected =
    location.pathname === CERTIFICATES_PATH
      ? 'certificates'
      : location.pathname === COMPANY_DOCUMENTS_PATH
        ? 'company-documents'
        : location.pathname === path
          ? documentView(location.hash.slice(1))
          : undefined;
  const context = ledgerContext(location, state, companyContext?.companyUuid);
  const certificateTarget = certificatesLocation({ search: '', state: context });
  const certificatePath = `${certificateTarget.pathname}${certificateTarget.search}`;
  const certificatesBlocked = location.pathname === path && !!state?.held;
  const links: { key: string; label: string; to: string; blocked: boolean }[] = DOCUMENT_VIEWS.filter(
    ({ key }) => key === 'certificates' || companyContext?.company?.canReadRegister,
  ).map(({ key, label }) => ({
    key,
    label,
    to: key === 'certificates' ? certificatePath : `${path}#${key}`,
    blocked: key === 'certificates' && certificatesBlocked,
  }));
  if (companyContext?.company?.canManage)
    links.splice(1, 0, {
      key: 'company-documents',
      label: 'Company documents',
      to: COMPANY_DOCUMENTS_PATH,
      blocked: certificatesBlocked,
    });
  const Caret = expanded ? CaretDownIcon : CaretRightIcon;

  if (shownPlace !== place) {
    setShownPlace(place);
    if (active) setExpanded(true);
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        <Link
          to={companyContext?.companyPath(certificatePath) ?? certificatePath}
          state={context}
          onClick={(event) => {
            if (certificatesBlocked) event.preventDefault();
            else onNavigate?.();
          }}
          onAuxClick={(event) => {
            if (certificatesBlocked) event.preventDefault();
          }}
          aria-disabled={certificatesBlocked || undefined}
          className={`${ITEM_CLASS} min-w-0 flex-1 ${IDLE_CLASS} ${certificatesBlocked ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          <FilesIcon size={ICON_MD} weight={active ? 'fill' : 'regular'} />
          <span>Documents</span>
        </Link>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} Documents navigation`}
          aria-expanded={expanded}
          aria-controls={id}
          className={`${IDLE_CLASS} flex h-10 w-8 shrink-0 items-center justify-center rounded-lg`}
        >
          <Caret size={16} />
        </button>
      </div>
      <div id={id} hidden={!expanded} className="ml-5 mt-1 space-y-1 border-l border-border-subtle pl-3">
        {links.map(({ key, label, to, blocked }) => (
          <Link
            key={key}
            to={companyContext?.companyPath(to) ?? to}
            state={context}
            onClick={(event) => {
              if (blocked) event.preventDefault();
              else onNavigate?.();
            }}
            onAuxClick={(event) => {
              if (blocked) event.preventDefault();
            }}
            aria-current={selected === key ? 'page' : undefined}
            aria-disabled={blocked || undefined}
            className={`${ITEM_CLASS} ${selected === key ? 'bg-brand-mid/10 text-brand-light dark:bg-brand-tint' : IDLE_CLASS} ${blocked ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            {label}
          </Link>
        ))}
      </div>
    </div>
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
  const place = `${location.pathname}${location.hash}`;
  const [shownPlace, setShownPlace] = useState(place);
  const [expanded, setExpanded] = useState(active);
  const id = useId();
  const selected = settingsView(location.pathname, location.hash);
  const items = SETTINGS_VIEWS.filter(
    (item) =>
      (item.key === 'profile' || !!context?.company?.canManage) &&
      (selected === item.key || navigation.items.includes(item)),
  );
  const Caret = expanded ? CaretDownIcon : CaretRightIcon;

  if (shownPlace !== place) {
    setShownPlace(place);
    if (active) setExpanded(true);
  }

  return (
    <div>
      <div className="flex items-center gap-1">
        <Link
          to={context?.companyPath(navigation.defaultPath) ?? navigation.defaultPath}
          onClick={onNavigate}
          className={`${ITEM_CLASS} min-w-0 flex-1 ${IDLE_CLASS}`}
        >
          <GearIcon size={ICON_MD} weight={active ? 'fill' : 'regular'} />
          <span>Settings</span>
        </Link>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} Settings navigation`}
          aria-expanded={expanded}
          aria-controls={id}
          className={`${IDLE_CLASS} flex h-10 w-8 shrink-0 items-center justify-center rounded-lg`}
        >
          <Caret size={16} />
        </button>
      </div>
      <div id={id} hidden={!expanded} className="ml-5 mt-1 space-y-1 border-l border-border-subtle pl-3">
        {items.map(({ key, label, to }) => (
          <Link
            key={key}
            to={context?.companyPath(to) ?? to}
            onClick={onNavigate}
            aria-current={selected === key ? 'page' : undefined}
            className={`${ITEM_CLASS} ${selected === key ? 'bg-brand-mid/10 text-brand-light dark:bg-brand-tint' : IDLE_CLASS}`}
          >
            {label}
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
  const context = useCompanyContext();
  const settings = useSettingsNavigation();
  const companyTasks = !!(context?.company?.canReadRegister || context?.company?.canManage);
  const companyItems = context?.company?.canReadRegister
    ? COMPANY
    : [
        ...COMPANY.filter((item) => item.destination === 'home'),
        ...(context?.company?.memberUuids.length ? [PERSONAL[1]!] : []),
      ];
  const { userProfile } = useUserProfile();
  const person = userProfile?.fullName?.trim() || userProfile?.email;

  const groups: NavGroup[] = [
    ...(companyTasks ? [{ id: 'company', items: companyItems }] : []),
    ...(!companyTasks ? [{ id: 'shares', items: PERSONAL }] : []),
    { id: 'yours', items: YOURS },
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
        (place.destination === 'companyRegister' && documentView(place.view)
          ? allItems.find((item) => item.destination === 'companyRegister' && item.view === 'certificates')
          : undefined) ??
        (place.destination === 'home' && place.view === 'documents'
          ? allItems.find((item) => item.destination === 'companyRegister' && item.view === 'certificates')
          : undefined) ??
        allItems.find((item) => item.destination === place.destination && !item.view),
    )
    .find(Boolean);
  const activePath =
    [CERTIFICATES_PATH, COMPANY_DOCUMENTS_PATH].includes(location.pathname) ||
    (location.pathname === DESTINATIONS.company.path && location.hash === '#documents')
      ? CERTIFICATES_PATH
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
                ) : (item.destination === 'companyRegister' && item.view === 'certificates') ||
                  (item.destination === 'home' && item.view === 'documents') ? (
                  <DocumentsGroup key={itemPath(item)} active={itemPath(item) === activePath} onNavigate={onNavigate} />
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
          <div className="hidden lg:block">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </aside>
  );
}
