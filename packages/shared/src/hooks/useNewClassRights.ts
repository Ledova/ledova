import { useQueryClient } from '@tanstack/react-query';
import { getClassRights } from '../services/class-rights';
import { createUserFriendlyError } from '../utils/errors';
import { appointmentForRegisterStep } from '../utils/register-commands';
import type { OwnCompanyAppointment } from '../types';
import { useApiClient } from './useApiClient';
import { useClassRightsWriter } from './useClassRightsWriter';
import type { ImportPreparationOptions } from './useImportPreparation';
import { ownAppointmentsKey } from './useOwnAppointments';
import { registerClassesKey, registerHoldersKey } from './useCompanyOwnership';
import type { OrderSubmissionOwner, OrderSubmissionSession } from './useSubmissionOwner';

export function useNewClassRights({
  owner,
  company,
  check,
  resolveRegister,
  newKey,
  session,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  check: () => void;
  resolveRegister: NonNullable<ImportPreparationOptions['resolveRegister']>;
  newKey: () => string;
  session?: OrderSubmissionSession;
}) {
  const api = useApiClient();
  const client = useQueryClient();
  return useClassRightsWriter({
    guard: check,
    newKey,
    session,
    resolveTarget: async () => {
      check();
      const { register } = await resolveRegister().finally(() =>
        Promise.all([
          client.invalidateQueries({ queryKey: registerClassesKey(owner), refetchType: 'none' }),
          client.invalidateQueries({ queryKey: registerHoldersKey(owner), refetchType: 'none' }),
        ]),
      );
      check();
      const { data } = await getClassRights(
        api,
        register.token.uuid,
        {},
        {
          ...session?.requestConfig(),
          ledovaSubmissionGuard: check,
        },
      );
      check();
      if (data.current && data.current.token !== register.token.uuid)
        throw createUserFriendlyError('The class rights did not identify the new share class.');
      return {
        token: register.token.uuid,
        company,
        appointment: data.administrationAppointment ?? '',
        previousRevision: data.current?.revision ?? 0,
      };
    },
    checkTarget: (target, draft) => {
      check();
      const rows = client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [];
      return (
        target.company === company &&
        target.previousRevision === draft.previousRevision &&
        !!appointmentForRegisterStep(
          rows.filter((row) => row.uuid === target.appointment && row.capabilities.includes('admin') && !row.revokedAt),
          company,
          'prepare',
        )
      );
    },
  });
}
