import { matchPath } from 'react-router-dom';
import {
  DESTINATIONS,
  DESTINATION_PARENTS,
  type Destination,
  type DestinationKey,
  type DestinationParent,
} from '@ledova/shared';

export interface Place {
  destination: DestinationKey;
  view?: string;
}

const WEB_TITLES: Partial<Record<DestinationKey, string>> = {
  home: 'Dashboard',
  memberRecords: 'Dashboard',
  company: 'Profile',
  companyTeam: 'Team',
  userProfile: 'Profile',
};

export const LEDGER_TASKS = {
  issue: DESTINATIONS.companyRegister.tasks.issue,
  transfer: DESTINATIONS.companyRegister.tasks.transfer,
  corrections: DESTINATIONS.companyRegister.tasks.corrections,
} as const;

export type LedgerTask = keyof typeof LEDGER_TASKS;

export function ledgerTask(value: unknown): LedgerTask | undefined {
  const task = value === 'history' ? 'corrections' : value;
  return typeof task === 'string' && Object.prototype.hasOwnProperty.call(LEDGER_TASKS, task)
    ? (task as LedgerTask)
    : undefined;
}

export const SHAREHOLDER_VIEWS = {
  awards: DESTINATIONS.companyRegister.views.awards,
  'member-access': 'Member access',
  'member-requests': 'Member requests',
} as const;

export const DOCUMENT_VIEWS = [
  { key: 'certificates', label: 'Certificates' },
  { key: 'inspection-copies', label: 'Inspection copies' },
  { key: 'company-pack', label: 'Company pack' },
] as const;

export type DocumentView = (typeof DOCUMENT_VIEWS)[number]['key'];

export function documentView(value: unknown): DocumentView | undefined {
  const view = value === 'documents' ? 'certificates' : value === 'ledger-exports' ? 'inspection-copies' : value;
  return DOCUMENT_VIEWS.find(({ key }) => key === view)?.key;
}

export const SETTINGS_VIEWS = [
  { key: 'profile', label: 'Profile', to: `${DESTINATIONS.settings.path}#profile` },
  { key: 'company-team', label: 'Team', to: DESTINATIONS.companyTeam.path },
  { key: 'activation', label: 'Activation', to: DESTINATIONS.companyListing.path },
] as const;

export type SettingsView = (typeof SETTINGS_VIEWS)[number]['key'];

export function settingsView(pathname: string, hash: string): SettingsView | undefined {
  if (pathname === DESTINATIONS.company.path) return 'profile';
  if (
    pathname === DESTINATIONS.companyTeam.path ||
    pathname === DESTINATIONS.companyAuthority.path ||
    matchPath(DESTINATIONS.companyAuthorityRequest.path, pathname)
  )
    return 'company-team';
  if (pathname === DESTINATIONS.companyListing.path) return 'activation';
  if (pathname === DESTINATIONS.userProfile.path) return 'profile';
  if (pathname === DESTINATIONS.settings.path && (hash === '#profile' || hash === '#account')) return 'profile';
  return undefined;
}

const WEB_PARENTS: Partial<Record<DestinationKey, DestinationParent>> = {
  ...DESTINATION_PARENTS,
  company: { destination: 'settings', back: false },
  companyTeam: { destination: 'settings', back: false },
  companyListing: { destination: 'settings', back: false },
  userProfile: { destination: 'settings', back: false },
  companyAuthority: { destination: 'companyTeam' },
  companyAuthorityRequest: { destination: 'companyAuthority' },
  companyOfferingDetail: { destination: 'companyOffering' },
  companyClassChain: { destination: 'companyClass' },
  companyRegisterCorrection: { destination: 'companyRegister', view: 'corrections' },
  companyRegisterOpening: { destination: 'companyRegister', view: 'corrections' },
  companyRegisterLinks: { destination: 'companyRegister', view: 'corrections' },
  companyRegisterParticulars: { destination: 'companyRegister', view: 'corrections' },
};

function viewName(key: DestinationKey, view: string): string | undefined {
  if (key === 'settings' && (view === 'profile' || view === 'account')) return 'Profile';
  const destination: Destination = DESTINATIONS[key];
  const views = destination.views;
  if (key === 'companyRegister') {
    const task = ledgerTask(view);
    if (task) return LEDGER_TASKS[task];
    const output = documentView(view);
    if (output) return DOCUMENT_VIEWS.find(({ key }) => key === output)?.label;
  }
  if (key === 'companyRegister' && Object.prototype.hasOwnProperty.call(SHAREHOLDER_VIEWS, view))
    return SHAREHOLDER_VIEWS[view as keyof typeof SHAREHOLDER_VIEWS];
  return views && Object.prototype.hasOwnProperty.call(views, view) ? views[view] : undefined;
}

export function pageTitle(key: DestinationKey, view?: string): string {
  const named = view ? viewName(key, view) : undefined;
  if (named) return named;
  return WEB_TITLES[key] ?? DESTINATIONS[key].title;
}

export function backLink(key: DestinationKey) {
  const parent = WEB_PARENTS[key];
  if (!parent || parent.back === false) return undefined;
  const path = DESTINATIONS[parent.destination].path;
  return {
    to: parent.view ? `${path}#${parent.view}` : path,
    label: `Back to ${pageTitle(parent.destination, parent.view)}`,
  };
}

export function destinationAt(pathname: string): DestinationKey | undefined {
  let found: DestinationKey | undefined;
  let fixedSegments = -1;
  for (const key of Object.keys(DESTINATIONS) as DestinationKey[]) {
    const path = DESTINATIONS[key].path;
    if (!matchPath({ path, end: true }, pathname)) continue;
    const fixed = path.split('/').filter((segment) => segment && !segment.startsWith(':')).length;
    if (fixed > fixedSegments) {
      found = key;
      fixedSegments = fixed;
    }
  }
  return found;
}

export function placesAt(pathname: string, hash: string): Place[] {
  const places: Place[] = [];
  let key = destinationAt(pathname);
  const hashView = hash.slice(1);
  const view = key === 'companyRegister' ? (ledgerTask(hashView) ?? documentView(hashView) ?? hashView) : hashView;
  let current: Place | undefined = key ? { destination: key, view: viewName(key, view) ? view : undefined } : undefined;
  while (current && places.length < 8) {
    places.push(current);
    key = current.destination;
    const parent: Place | undefined = WEB_PARENTS[key];
    current = parent && { destination: parent.destination, view: parent.view };
  }
  return places;
}
