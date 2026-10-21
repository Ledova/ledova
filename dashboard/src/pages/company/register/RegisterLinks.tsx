import { registerEntriesKey } from '@pages/company/register/shared/useRegisterEntries';
import { allPeopleKey } from '@pages/company/register/shared/usePeople';
import { registerHoldersKey } from '@pages/company/shared/useCompanyRegister';
import { generatePath } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_LINK_COPY,
  hasCurrentRegisterReadAuthority,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LinkRow, Section, LoadError, Loading } from '@components/Ledger';

import { LinkRecord } from './LinkRecord';
import { registerSteps } from '@pages/company/shared/proposals';
import { useOwnAppointments, ownAppointmentsKey } from '@hooks/useOwnAppointments';
import {
  linksKey,
  useRegisterLinks,
  useWaitingWallets,
  waitingWalletsKey,
} from '@pages/company/register/shared/useRegisterLinks';

const COPY = REGISTER_LINK_COPY;

export function RegisterLinks({
  owner,
  guard,
  company,
  registers,
  visible = true,
  onHeldChange,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  registers: TokenHoldersResponse[];
  visible?: boolean;
  onHeldChange?: (uuid: string, held: boolean) => void;
}) {
  const client = useQueryClient();
  const links = useRegisterLinks(owner, company, guard);
  const appointments = useOwnAppointments(owner, guard);
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : null;
  const privateReady =
    visible &&
    links.isSuccess &&
    links.fetchStatus === 'idle' &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const waiting = useWaitingWallets(owner, company, guard, {
    enabled: !!steps?.prepare,
    onMissing: () => void appointments.refetch(),
  });
  const holders = registers.flatMap((register) => register.holders);
  const refresh = async () => {
    try {
      guard();
    } catch {
      return;
    }
    await Promise.all(
      [
        linksKey(owner, company),
        allPeopleKey(owner),
        waitingWalletsKey(owner, company),
        registerHoldersKey(owner),
        registerEntriesKey(owner),
        ownAppointmentsKey(owner),
      ].map((queryKey) => client.invalidateQueries({ queryKey })),
    );
  };
  if (
    links.isSuccess &&
    links.data.length === 0 &&
    (!steps?.prepare || (waiting.isSuccess && waiting.data.length === 0))
  )
    return null;
  return (
    <Section title={COPY.TITLE}>
      {appointments.isError ? (
        <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
          Your appointments could not be loaded.
        </LoadError>
      ) : (
        steps && !Object.values(steps).some(Boolean) && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
      )}
      {visible &&
        appointments.fetchStatus === 'idle' &&
        steps?.prepare &&
        (waiting.isError ? (
          <LoadError retry={() => waiting.refetch()} busy={waiting.isFetching}>
            Wallets waiting for a link could not be loaded.
          </LoadError>
        ) : (
          waiting.isSuccess &&
          (waiting.data.length > 0 ? (
            <div className="border-b border-border-subtle">
              <LinkRow
                to={generatePath(DESTINATIONS.companyRegisterLinks.path, { company: company })}
                label={COPY.PREPARE}
              />
            </div>
          ) : null)
        ))}
      {links.isPending ? (
        <Loading>Loading wallet links…</Loading>
      ) : links.isError ? (
        <LoadError retry={() => links.refetch()} busy={links.isFetching}>
          Wallet links could not be loaded.
        </LoadError>
      ) : null}
      <ul className="divide-y divide-border-subtle">
        {(links.data ?? []).map((link) => (
          <LinkRecord
            key={link.uuid}
            link={link}
            visible={privateReady}
            onHeldChange={onHeldChange}
            holders={holders}
            steps={steps ?? {}}
            guard={guard}
            onDecided={refresh}
            onRefused={refresh}
          />
        ))}
      </ul>
    </Section>
  );
}
