import { PreparationNotice, PreparationPreferences } from '@pages/company/ledger/shared/PreparationShell';
import { useRegisterPreparationOwner } from '@pages/company/ledger/shared/useRegisterPreparationOwner';
import { useTransferRegister } from './useTransferRegister';
import { useMemo, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';

import {
  REGISTER_TRANSFER_COPY as COPY,
  appointmentForRegisterStep,
  type OrderSubmissionOwner,
  peopleFrom,
} from '@ledova/shared';
import { Section, LoadError, Loading } from '@components/Ledger';
import { Page } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { useRegisterClasses } from '@hooks/useRegisterClasses';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { useOwnAppointments } from '@hooks/useOwnAppointments';
import { usePeople } from '@pages/company/ledger/shared/usePeople';
import { TransferForm } from './TransferForm';
import { registerPlace } from '@pages/company/ledger/shared/registerPlace';

export default function CompanyRegisterTransferPage() {
  const { uuid = '' } = useParams();
  const { owner, boundary, preferences } = useRegisterPreparationOwner();
  return (
    <PageTitle.Provider value="Transfer shares">
      {owner && !preferences.isError ? (
        <OwnTransfer
          key={`${owner.userUuid}/${owner.ownerAccountUuid}/${uuid}`}
          uuid={uuid}
          owner={owner}
          currentOwner={boundary.get}
        />
      ) : (
        <Page back={{ to: undefined }}>
          <PreparationPreferences preferences={preferences} />
        </Page>
      )}
    </PageTitle.Provider>
  );
}

function OwnTransfer({
  uuid,
  owner,
  currentOwner,
}: {
  uuid: string;
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const { state } = useLocation();
  const navigate = useNavigate();
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const classes = useRegisterClasses(owner, guard);
  const appointments = useOwnAppointments(owner, guard);
  const listed = classes.data?.find((item) => item.uuid === uuid);
  const appointment =
    listed && appointments.data
      ? appointmentForRegisterStep(appointments.data, listed.companyUuid, 'prepare')
      : undefined;
  const registers = useTransferRegister(owner, uuid, listed, guard);
  const register = registers.data?.[0];
  const members = usePeople(owner, uuid, guard, !!appointment);
  const busy = classes.isFetching || appointments.isFetching || registers.isFetching || members.isFetching;
  const fromMember = typeof state?.fromMember === 'string' ? state.fromMember : '';
  const stale = classes.isError || appointments.isError || registers.isError || members.isError;
  const retry = () => {
    void classes.refetch();
    void appointments.refetch();
    void registers.refetch();
    void members.refetch();
  };
  let content: ReactNode;
  if (!classes.data || !appointments.data)
    content = stale ? (
      <LoadError retry={retry} busy={busy}>
        The register or your appointments could not be loaded.
      </LoadError>
    ) : (
      <Loading>Loading the register…</Loading>
    );
  else if (!listed) content = <PreparationNotice />;
  else if (!appointment) content = <PreparationNotice>{COPY.READ_ONLY_NOTE}</PreparationNotice>;
  else if (!register || !members.data)
    content = stale ? (
      <LoadError retry={retry} busy={busy}>
        The register or your appointments could not be loaded.
      </LoadError>
    ) : (
      <Loading>Loading the register…</Loading>
    );
  else if (!register.initialized || register.token.status !== 'draft')
    content = (
      <p className="text-sm text-text-muted">
        This transfer requires an opened register for a draft share class without a deployed contract.
      </p>
    );
  else
    content = (
      <Section title="Non-paid transfer">
        {stale && (
          <LoadError retry={retry} busy={busy}>
            The register or your appointments could not be loaded.
          </LoadError>
        )}
        <TransferForm
          owner={owner}
          guard={guard}
          company={listed.companyUuid}
          token={uuid}
          classLabel={`${listed.name} (${listed.symbol})`}
          people={peopleFrom(members.data)}
          appointment={appointment}
          blocked={stale || busy}
          onRefused={retry}
          initialFrom={fromMember}
          onCancel={() => {
            const place = registerPlace({ company: listed.companyUuid, token: uuid, task: 'transfer' });
            navigate(place.to, { state: place.state });
          }}
        />
      </Section>
    );
  return (
    <Page
      lede={listed && appointment ? `${listed.companyName} · ${listed.name} (${listed.symbol})` : undefined}
      back={{ to: undefined }}
    >
      {content}
    </Page>
  );
}
