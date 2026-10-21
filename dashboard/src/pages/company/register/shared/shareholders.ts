import { generatePath } from 'react-router-dom';
import { DESTINATIONS } from '@ledova/shared';

export function shareholderPath(member: string, company: string) {
  return `${generatePath(DESTINATIONS.companyShareholder.path, { member })}?company=${encodeURIComponent(company)}`;
}
