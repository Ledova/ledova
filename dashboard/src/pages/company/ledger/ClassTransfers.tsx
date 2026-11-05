import { useCallback, useState, type ReactNode } from 'react';
import { generatePath } from 'react-router-dom';
import { pageTitle } from '@utils/destinations';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  hasCurrentRegisterReadAuthority,
  REGISTER_TRANSFER_COPY as COPY,
  TRANSFER_GROUPS,
  type OrderSubmissionOwner,
  type RecordRow,
  type TokenHoldersResponse,
  registerHoldersKey,
  useOwnAppointments,
  ownAppointmentsKey,
  allPeopleKey,
  registerSteps,
  entriesKey,
  transfersKey,
  useRegisterTransfers,
} from '@ledova/shared';
import { LinkRow, LoadError, Loading, Section } from '@components/Ledger';
import { Actions, PageLink } from '@components/Page';

import { GroupedRecords } from './GroupedRecords';
import { TransferRecord } from './TransferRecord';
import type { Landed } from '@pages/company/ledger/shared/registerPlace';

export function ClassTransfers({
  landed,
  owner,
  guard,
  register,
  company,
  visible = true,
  onHeldChange,
}: {
  landed?: Landed;
  owner: OrderSubmissionOwner;
  guard: () => void;
  register: TokenHoldersResponse;
  company: string;
  visible?: boolean;
  onHeldChange?: (token: string, uuid: string, held: boolean) => void;
}) {
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<HTMLDivElement | null>(null);
  const reviewChanged = useCallback((uuid: string, open: boolean) => {
    setReviewing((current) => (open ? uuid : current === uuid ? null : current));
  }, []);
  const client = useQueryClient();
  const token = register.token.uuid;
  const transfers = useRegisterTransfers(owner, company, token, guard);
  const appointments = useOwnAppointments(owner, guard);
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : null;
  const privateReady =
    visible &&
    transfers.isSuccess &&
    transfers.fetchStatus === 'idle' &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const [heldRecords, setHeldRecords] = useState<ReadonlySet<string>>(() => new Set());
  const recordHeld = useCallback(
    (uuid: string, held: boolean) => {
      setHeldRecords((current) => {
        if (current.has(uuid) === held) return current;
        const next = new Set(current);
        if (held) next.add(uuid);
        else next.delete(uuid);
        return next;
      });
      onHeldChange?.(token, uuid, held);
    },
    [onHeldChange, token],
  );
  const refresh = async () => {
    try {
      guard();
    } catch {
      return;
    }
    await Promise.all(
      [
        transfersKey(owner, token),
        allPeopleKey(owner),
        registerHoldersKey(owner),
        entriesKey(owner, token),
        ownAppointmentsKey(owner),
      ].map((queryKey) => client.invalidateQueries({ queryKey })),
    );
  };
  const supported = register.initialized && register.token.status === 'draft';
  const rows: RecordRow<ReactNode>[] = (transfers.data ?? []).map((transfer) => ({
    uuid: transfer.uuid,
    stage: transfer.stage,
    companyEventOn: transfer.companyEventOn,
    createdAt: transfer.createdAt,
    shown: privateReady,
    held: heldRecords.has(transfer.uuid),
    render: ({ collapsed, ruled }) => (
      <TransferRecord
        landed={landed?.record === transfer.uuid ? landed : undefined}
        transfer={transfer}
        visible={privateReady}
        collapsed={collapsed}
        ruled={ruled}
        onHeldChange={recordHeld}
        steps={steps ?? {}}
        guard={guard}
        onSettled={refresh}
        reviewTarget={reviewTarget}
        onReviewChange={reviewChanged}
      />
    ),
  }));
  const prepareAction =
    privateReady && steps?.prepare && supported ? (
      <PageLink
        primary
        to={generatePath(DESTINATIONS.companyRegisterTransfer.path, { uuid: token })}
        label={COPY.PREPARE}
      />
    ) : null;
  const status = (
    <>
      {!supported && visible && (
        <p className="text-sm text-text-muted">
          {register.token.status === 'draft'
            ? 'Set up this share register before recording a transfer.'
            : 'Transfers for a class that uses the chain aren’t available in the web app.'}
        </p>
      )}
      {!supported && privateReady && steps?.prepare && register.token.status === 'draft' && (
        <LinkRow
          to={generatePath(DESTINATIONS.companyRegisterImport.path, { uuid: token })}
          label={pageTitle('companyRegisterImport')}
        />
      )}
      {appointments.isError && (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      )}
      {steps && !Object.values(steps).some(Boolean) && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>}
      {transfers.isPending ? (
        <Loading>Loading non-paid transfers…</Loading>
      ) : transfers.isError ? (
        <LoadError
          retry={() => Promise.all([transfers.refetch(), appointments.refetch()])}
          busy={transfers.isFetching || appointments.isFetching}
        >
          Transfers could not be loaded.
        </LoadError>
      ) : privateReady && transfers.data.length === 0 ? (
        <p className="text-sm text-text-muted">{COPY.EMPTY}</p>
      ) : null}
    </>
  );
  return (
    <div role="region" aria-label="Share transfer workflow" className="space-y-5">
      <div hidden={!!reviewing}>
        <Section title="Share transfers">
          {!reviewing && status}
          <GroupedRecords grouping={TRANSFER_GROUPS} rows={rows} requested={landed} />
        </Section>
      </div>
      {prepareAction && !reviewing && <Actions>{prepareAction}</Actions>}
      <div hidden={!reviewing} className="space-y-5">
        {reviewing && status}
        <div ref={setReviewTarget} />
      </div>
    </div>
  );
}
