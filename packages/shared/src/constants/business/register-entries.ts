import type { RegisterEntryKind } from '../../types';

export const REGISTER_ENTRY_COPY = {
  ENTRY_KINDS: {
    mirror_correction: 'Copied opening correction',
    opening: 'Opening state',
    issue: 'Issue',
    transfer: 'Transfer',
    cessation: 'Cessation',
    correction: 'Compensating correction',
  } satisfies Record<RegisterEntryKind, string>,
  UNNAMED_MEMBER: (member: string) => `Member ${member}`,
};
