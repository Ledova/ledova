import { generatePath } from 'react-router-dom';
import { DESTINATIONS } from '@ledova/shared';

export function awardPath(token: string, award: string, company: string) {
  return `${generatePath(DESTINATIONS.companyRegisterAward.path, { uuid: token, award })}?company=${encodeURIComponent(company)}`;
}
