import { DESTINATIONS } from '@ledova/shared';
import type { LedgerTask } from '@utils/destinations';

export interface RegisterPlace {
  company?: string;
  token?: string;
  task?: LedgerTask;
  record?: string;
  outcome?: string;
}

export interface Landed {
  record: string;
  key: string;
  outcome?: string;
}

export function registerPlace({ company, token, task, record, outcome }: RegisterPlace) {
  const search = company ? `?${new URLSearchParams({ company })}` : '';
  return {
    to: `${DESTINATIONS.companyRegister.path}${search}${task ? `#${task}` : ''}`,
    state: {
      registerCompany: company,
      registerToken: token,
      registerTask: task,
      registerRecord: record,
      registerOutcome: outcome,
    },
  };
}
