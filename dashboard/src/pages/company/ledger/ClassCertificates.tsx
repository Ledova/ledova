import { useQueryClient } from '@tanstack/react-query';
import {
  USER_PREFERENCES_QUERY_KEY,
  hasCurrentRegisterReadAuthority,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { ownAppointmentsKey } from '@hooks/useOwnAppointments';
import { ClassEntries } from './ClassEntries';
import { ClassCertificate } from './ClassCertificate';

export function ClassCertificates({
  owner,
  guard,
  company,
  register,
  sourceReady = true,
  visible = true,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  register: TokenHoldersResponse;
  sourceReady?: boolean;
  visible?: boolean;
}) {
  const client = useQueryClient();
  const certificateGuard = () => {
    guard();
    const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
    const state = client.getQueryState<OwnCompanyAppointment[]>(ownAppointmentsKey(owner));
    if (
      preferences?.status !== 'success' ||
      preferences.fetchStatus !== 'idle' ||
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      !hasCurrentRegisterReadAuthority(state.data ?? [], company)
    )
      throw new Error('Refresh current company register authority before preparing a certificate.');
  };
  return (
    <div hidden={!visible} className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-text-primary">Certificates</h3>
      <ClassEntries
        owner={owner}
        guard={guard}
        company={company}
        register={register}
        sourceReady={sourceReady}
        visible={visible}
        entryFilter={(entry) =>
          ['issue', 'transfer'].includes(entry.kind) && Number.isSafeInteger(entry.sequence) && entry.sequence > 0
        }
        emptyText="No eligible issues or transfers in the loaded records."
        renderAction={(entry, ready) => (
          <ClassCertificate
            sourceKey={`${owner.userUuid}/${owner.ownerAccountUuid}`}
            register={register}
            entry={entry}
            guard={certificateGuard}
            sourceReady={ready}
          />
        )}
      />
    </div>
  );
}
