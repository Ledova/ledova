import { matchPath, useLocation } from 'react-router-dom';
import { DESTINATIONS, type Destination } from '@ledova/shared';

const DESTINATION_LIST: Destination[] = Object.values(DESTINATIONS);

export function usePageTitle(): Pick<Destination, 'title' | 'subtitle'> {
  const { pathname } = useLocation();
  const destination = DESTINATION_LIST.find(({ path }) => matchPath(path, pathname));
  return destination ?? { title: 'Ledova' };
}
