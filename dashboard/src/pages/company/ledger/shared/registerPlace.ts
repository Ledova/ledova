import { DESTINATIONS } from '@ledova/shared';
import { WEB_LEDGER_TASKS, type WebLedgerTask } from '@utils/destinations';

export type RegisterTask = WebLedgerTask;

export interface RegisterPlace {
  company?: string;
  token?: string;
  task?: RegisterTask;
  record?: string;
  outcome?: string;
}

export interface Landed {
  record: string;
  key: string;
  outcome?: string;
}

export function isRegisterTask(value: unknown): value is RegisterTask {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(WEB_LEDGER_TASKS, value);
}

export function registerPlace({ company, token, task, record, outcome }: RegisterPlace) {
  return {
    to: `${DESTINATIONS.companyRegister.path}${task ? `#${task}` : ''}`,
    state: {
      registerCompany: company,
      registerToken: token,
      registerTask: task,
      registerRecord: record,
      registerOutcome: outcome,
    },
  };
}
