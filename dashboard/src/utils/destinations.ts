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
  'member-access': 'Member access',
  'member-requests': 'Member requests',
} as const;

const WEB_PARENTS: Partial<Record<DestinationKey, DestinationParent>> = {
  ...DESTINATION_PARENTS,
  companyRegisterCorrection: { destination: 'companyRegister', view: 'corrections' },
  companyRegisterOpening: { destination: 'companyRegister', view: 'corrections' },
  companyRegisterLinks: { destination: 'companyRegister', view: 'corrections' },
  companyRegisterParticulars: { destination: 'companyRegister', view: 'corrections' },
};

function viewName(key: DestinationKey, view: string): string | undefined {
  const destination: Destination = DESTINATIONS[key];
  const views = destination.views;
  if (key === 'companyRegister') {
    const task = ledgerTask(view);
    if (task) return LEDGER_TASKS[task];
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
  const view = key === 'companyRegister' ? (ledgerTask(hashView) ?? hashView) : hashView;
  let current: Place | undefined = key ? { destination: key, view: viewName(key, view) ? view : undefined } : undefined;
  while (current && places.length < 8) {
    places.push(current);
    key = current.destination;
    const parent: Place | undefined = WEB_PARENTS[key];
    current = parent && { destination: parent.destination, view: parent.view };
  }
  return places;
}
