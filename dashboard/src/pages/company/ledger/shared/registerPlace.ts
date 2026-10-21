import { DESTINATIONS } from '@ledova/shared';

export type RegisterTask = keyof typeof DESTINATIONS.companyRegister.tasks;

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
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DESTINATIONS.companyRegister.tasks, value);
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
