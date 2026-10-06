import { useQueryClient } from '@tanstack/react-query';
import { DESTINATIONS, REGISTER_LINK_COPY, type OrderSubmissionOwner, type TokenHoldersResponse } from '@ledova/shared';
import { LinkRow, Section } from '@components/Ledger';
import { PageAction } from '@components/Page';
import { ownAppointmentsKey } from '../team/appointments';
import { LinkRecord } from './LinkRecord';
import { registerSteps } from './proposals';
import { registerKey } from './useCompanyRegister';
import { useOwnAppointments } from './useRegisterImports';
import { linksKey, useRegisterLinks, useWaitingWallets, waitingWalletsKey } from './useRegisterLinks';

const COPY = REGISTER_LINK_COPY;

export function RegisterLinks({
  owner,
  guard,
  company,
  registers,
}: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  registers: TokenHoldersResponse[];
}) {
  const client = useQueryClient();
  const links = useRegisterLinks(owner, company, guard);
  const appointments = useOwnAppointments(owner, guard);
  const steps = appointments.isSuccess ? registerSteps(appointments.data, company) : null;
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
        waitingWalletsKey(owner, company),
        [...registerKey(owner), 'holders'],
        [...registerKey(owner), 'entries'],
        ownAppointmentsKey(owner),
      ].map((queryKey) => client.invalidateQueries({ queryKey })),
    );
  };
  return (
    <Section title={COPY.TITLE}>
      {appointments.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text-muted">
          <p>Your appointments could not be loaded. Retry before preparing or deciding a wallet link.</p>
          <PageAction
            label="Retry appointments"
            onClick={() => void appointments.refetch()}
            disabled={appointments.isFetching}
          />
        </div>
      ) : (
        steps && !Object.values(steps).some(Boolean) && <p className="text-sm text-text-muted">{COPY.READ_ONLY_NOTE}</p>
      )}
      {steps?.prepare &&
        (waiting.isError ? (
          <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text-muted">
            <p>We couldn&apos;t load the wallets waiting for a link.</p>
            <PageAction
              label="Retry waiting wallets"
              onClick={() => void waiting.refetch()}
              disabled={waiting.isFetching}
            />
          </div>
        ) : (
          waiting.isSuccess &&
          (waiting.data.length > 0 ? (
            <div className="border-b border-border-subtle">
              <LinkRow to={DESTINATIONS.companyRegisterLinks.path.replace(':company', company)} label={COPY.PREPARE} />
            </div>
          ) : (
            <p className="text-sm text-text-muted">{COPY.NOTHING_WAITING}</p>
          ))
        ))}
      {links.isPending ? (
        <p role="status" className="text-sm text-text-muted">
          Loading wallet links…
        </p>
      ) : links.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 text-sm text-text-muted">
          <p>We couldn&apos;t load the wallet links for this company.</p>
          <PageAction label="Retry wallet links" onClick={() => void links.refetch()} disabled={links.isFetching} />
        </div>
      ) : links.data.length === 0 ? (
        <p className="text-sm text-text-muted">{COPY.EMPTY}</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {links.data.map((link) => (
            <LinkRecord
              key={link.uuid}
              link={link}
              holders={holders}
              steps={steps ?? {}}
              guard={guard}
              onDecided={refresh}
              onRefused={refresh}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}
