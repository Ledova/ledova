import { useQueryClient } from '@tanstack/react-query';
import {
  appointmentForRegisterStep,
  createUserFriendlyError,
  getClassRights,
  ownAppointmentsKey,
  registerClassesKey,
  registerHoldersKey,
  useApiClient,
  useClassRightsWriter,
  type ImportPreparationOptions,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';

export function useNewClassRights({
  owner,
  company,
  check,
  resolveRegister,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  check: () => void;
  resolveRegister: NonNullable<ImportPreparationOptions['resolveRegister']>;
}) {
  const api = useApiClient();
  const client = useQueryClient();
  return useClassRightsWriter({
    guard: check,
    newKey: () => crypto.randomUUID(),
    resolveTarget: async () => {
      check();
      const { register } = await resolveRegister().finally(() =>
        Promise.all([
          client.invalidateQueries({ queryKey: registerClassesKey(owner), refetchType: 'none' }),
          client.invalidateQueries({ queryKey: registerHoldersKey(owner), refetchType: 'none' }),
        ]),
      );
      check();
      const { data } = await getClassRights(api, register.token.uuid, {}, { ledovaSubmissionGuard: check });
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
