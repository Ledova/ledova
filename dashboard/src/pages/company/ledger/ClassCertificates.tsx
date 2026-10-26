import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_CORRECTION_COPY,
  USER_PREFERENCES_QUERY_KEY,
  formatDate,
  hasCurrentRegisterReadAuthority,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LoadError, Loading, Section, Status } from '@components/Ledger';
import { LoadMore } from '@components/List';
import { ownAppointmentsKey, useOwnAppointments } from '@hooks/useOwnAppointments';
import { RegisterChanges } from './shared/RegisterChanges';
import { useRegisterEntries } from './shared/useRegisterEntries';
import { ClassCertificate } from './ClassCertificate';

export function ClassCertificates({
  owner,
  guard,
  company,
  register,
  sourceReady = true,
  visible = true,
  activeTask,
  onEditingChange,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  register: TokenHoldersResponse;
  sourceReady?: boolean;
  visible?: boolean;
  activeTask?: string | null;
  onEditingChange?: (key: string, open: boolean) => void;
}) {
  const client = useQueryClient();
  const history = useRegisterEntries(owner, register.token.uuid, guard);
  const appointments = useOwnAppointments(owner, guard);
  const privateReady =
    visible &&
    sourceReady &&
    !history.isPending &&
    !history.hasError &&
    !history.isFetching &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const actionReady = privateReady && !history.moreFailed;
  const entries = history.entries.filter(
    (entry) => ['issue', 'transfer'].includes(entry.kind) && Number.isSafeInteger(entry.sequence) && entry.sequence > 0,
  );
  const editingChange = useCallback(
    (entry: string, open: boolean) => onEditingChange?.(`certificate/${register.token.uuid}/${entry}`, open),
    [onEditingChange, register.token.uuid],
  );
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
    <Section title="Share changes">
      {appointments.isError && (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      )}
      {history.isPending ? (
        <Loading>Loading register entries…</Loading>
      ) : history.hasError ? (
        <LoadError retry={history.retry} busy={history.isFetching}>
          Register entries could not be loaded.
        </LoadError>
      ) : privateReady && entries.length === 0 ? (
        <p className="text-sm text-text-muted">No eligible issues or transfers in the loaded records.</p>
      ) : null}
      <ul aria-label="Certificate records" className={activeTask ? undefined : 'divide-y divide-border-subtle'}>
        {entries.map((entry) => {
          const key = `certificate/${register.token.uuid}/${entry.uuid}`;
          const focused = activeTask === key;
          return (
            <li key={entry.uuid} hidden={!privateReady || (!!activeTask && !focused)}>
              <div className={`flex flex-wrap items-start justify-between gap-4${focused ? '' : ' py-4'}`}>
                {privateReady && !focused && (
                  <div className="min-w-0 flex-1 space-y-1 text-sm">
                    <div className="font-medium text-text-primary">
                      <RegisterChanges changes={entry.changes.slice(0, 2)} />
                    </div>
                    <p className="text-text-muted">
                      {REGISTER_CORRECTION_COPY.ENTRY_KINDS[entry.kind]} ·{' '}
                      {formatDate(entry.companyEventOn, 'Date not recorded')}
                    </p>
                    {entry.changes.length > 2 && (
                      <p className="text-text-muted">{entry.changes.length - 2} more share changes</p>
                    )}
                    {entry.correctedBy && <Status tone="closed">Reversed</Status>}
                  </div>
                )}
                <ClassCertificate
                  sourceKey={`${owner.userUuid}/${owner.ownerAccountUuid}`}
                  register={register}
                  entry={entry}
                  guard={certificateGuard}
                  sourceReady={actionReady}
                  onEditingChange={editingChange}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <div hidden={!!activeTask}>
        <LoadMore
          noun={['register entry', 'register entries']}
          hasMore={history.hasMore}
          failed={history.moreFailed}
          loading={history.isLoadingMore}
          disabled={!privateReady || history.isFetching}
          onLoad={history.loadMore}
        />
      </div>
    </Section>
  );
}
