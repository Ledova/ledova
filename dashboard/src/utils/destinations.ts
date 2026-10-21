import { matchPath } from 'react-router-dom';
import { DESTINATIONS, DESTINATION_PARENTS, type Destination, type DestinationKey } from '@ledova/shared';

export interface Place {
  destination: DestinationKey;
  view?: string;
}

const WEB_TITLES: Partial<Record<DestinationKey, string>> = {
  home: 'Dashboard',
  companyRegister: 'Ledger',
  companyRegisterSetup: 'Set up your ledger',
  companyRegisterImport: 'Set up your ledger',
  companyRegisterOpening: 'Ledger opening',
};

function viewName(key: DestinationKey, view: string): string | undefined {
  const destination: Destination = DESTINATIONS[key];
  const views = destination.views;
  return views && Object.prototype.hasOwnProperty.call(views, view) ? views[view] : undefined;
}

export function pageTitle(key: DestinationKey, view?: string): string {
  const named = view ? viewName(key, view) : undefined;
  if (named) return named;
  return WEB_TITLES[key] ?? DESTINATIONS[key].title;
}

export function backLink(key: DestinationKey) {
  const parent = DESTINATION_PARENTS[key];
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
  const view = hash.slice(1);
  let current: Place | undefined = key ? { destination: key, view: viewName(key, view) ? view : undefined } : undefined;
  while (current && places.length < 8) {
    places.push(current);
    key = current.destination;
    const parent: Place | undefined = DESTINATION_PARENTS[key];
    current = parent && { destination: parent.destination, view: parent.view };
  }
  return places;
}
