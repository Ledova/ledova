import { registerHoldersKey } from '@pages/company/shared/useCompanyRegister';
import { useCallback, useState } from 'react';
import { generatePath } from 'react-router-dom';
import { pageTitle } from '@utils/destinations';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  hasCurrentRegisterReadAuthority,
  REGISTER_TRANSFER_COPY as COPY,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LinkRow, LoadError, Loading, Section } from '@components/Ledger';
import { PageLink } from '@components/Page';

import { TransferRecord } from './TransferRecord';
import { registerSteps } from '@pages/company/shared/proposals';
import { entriesKey } from '@pages/company/ledger/shared/useRegisterEntries';
import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';
import { transfersKey, useRegisterTransfers } from '@pages/company/ledger/shared/useRegisterTransfers';
import { allPeopleKey } from '@pages/company/ledger/shared/usePeople';
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
  const recordHeld = useCallback(
    (uuid: string, held: boolean) => onHeldChange?.(token, uuid, held),
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
  const records = transfers.data ?? [];
  const prepareAction =
    privateReady && steps?.prepare && supported ? (
      <PageLink to={generatePath(DESTINATIONS.companyRegisterTransfer.path, { uuid: token })} label={COPY.PREPARE} />
    ) : null;
  const status = (
    <>
      {!supported && visible && (
        <p className="text-sm text-text-muted">
          {register.token.status === 'draft'
            ? 'Set up this share register before recording a transfer.'
            : 'Tokenised share transfers use wallet and chain controls. This task records non-paid transfers for a non-tokenised register.'}
        </p>
      )}
      {!supported && privateReady && steps?.prepare && (
        <LinkRow
          to={generatePath(
            (register.token.status === 'draft' ? DESTINATIONS.companyRegisterImport : DESTINATIONS.companyClass).path,
            { uuid: token },
          )}
          label={pageTitle(register.token.status === 'draft' ? 'companyRegisterImport' : 'companyClass')}
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
        <Section title={visible ? `${register.token.name} · ${register.token.symbol}` : 'Transfers'}>
          {!reviewing && status}
          <ul className="divide-y divide-border-subtle">
            {records.map((transfer, index) => (
              <TransferRecord
                key={transfer.uuid}
                landed={landed?.record === transfer.uuid ? landed : undefined}
                transfer={transfer}
                visible={privateReady}
                onHeldChange={recordHeld}
                steps={steps ?? {}}
                guard={guard}
                onSettled={refresh}
                prepareAction={index === records.length - 1 ? prepareAction : undefined}
                reviewTarget={reviewTarget}
                onReviewChange={reviewChanged}
              />
            ))}
          </ul>
          {records.length === 0 && prepareAction && (
            <div className="flex flex-wrap justify-end gap-2">{prepareAction}</div>
          )}
        </Section>
      </div>
      <div hidden={!reviewing} className="space-y-5">
        {reviewing && status}
        <div ref={setReviewTarget} />
      </div>
    </div>
  );
}
