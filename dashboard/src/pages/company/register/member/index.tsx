import { useMemo, useState, type ReactNode } from 'react';
import { generatePath, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  HOLDER_TYPE_LABELS,
  REGISTER_COPY,
  REGISTER_CORRECTION_COPY,
  REGISTER_PARTICULARS_COPY,
  USER_PREFERENCES_QUERY_KEY,
  appointmentForRegisterStep,
  formatDate,
  formatDateTime,
  formatShareCount,
  hasCurrentRegisterReadAuthority,
  useCompanyMemberAccess,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
} from '@ledova/shared';
import { Row, Rows, Section } from '@components/Ledger';
import { Page, PageAction, PageLink } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { Loading, Unavailable } from '@pages/company/shared/RegisterStatus';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { registerClassesKey, registersQuery } from '@pages/company/shared/useCompanyRegister';
import { percentage } from '@pages/company/register/shared/shareholders';
import { ownAppointmentsKey, useOwnAppointments } from '@hooks/useOwnAppointments';
import { useShareholder } from './useShareholder';

const SHAREHOLDERS = `${DESTINATIONS.companyRegister.path}#shareholders`;
const PRIVATE_NOTE =
  'Particulars, history and awards show only to someone with a current company register appointment.';

interface Read {
  isError: boolean;
  isSuccess: boolean;
  isFetching: boolean;
  fetchStatus: string;
  refetch: () => unknown;
}

function signed(shares: bigint) {
  const size = formatShareCount((shares < 0n ? -shares : shares).toString());
  return shares < 0n ? `−${size}` : `+${size}`;
}

export default function CompanyShareholderPage() {
  const { member = '' } = useParams();
  const [params] = useSearchParams();
  const company = params.get('company') ?? '';
  const navigate = useNavigate();
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  const back = (
    <PageAction
      label="Back to Shareholders"
      onClick={() => navigate(SHAREHOLDERS, company ? { state: { registerCompany: company } } : undefined)}
    />
  );
  if (owner)
    return (
      <OwnShareholder
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${company}/${member}`}
        owner={owner}
        currentOwner={boundary.get}
        company={company}
        member={member}
        back={back}
      />
    );
  return (
    <Page narrow actions={back}>
      {preferences.isLoading ? (
        <Loading />
      ) : (
        <Unavailable retry={() => void preferences.refetch()} busy={preferences.isFetching} />
      )}
    </Page>
  );
}

function OwnShareholder({
  owner,
  currentOwner,
  company,
  member,
  back,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
  member: string;
  back: ReactNode;
}) {
  const guard = useMemo(() => ownerGuard(owner, currentOwner), [owner, currentOwner]);
  const data = useShareholder(owner, guard, company, member);
  const preferenceRead = useUserPreferences();
  const client = useQueryClient();
  const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const appointments = useOwnAppointments(owner, guard, { enabled: !!data.company });
  const sourceReady =
    preferences?.status === 'success' &&
    preferences.fetchStatus === 'idle' &&
    data.classes.isSuccess &&
    data.classes.fetchStatus === 'idle' &&
    data.registers.isSuccess &&
    data.registers.fetchStatus === 'idle' &&
    !!data.company;
  const access = useCompanyMemberAccess(company, () => crypto.randomUUID(), undefined, sourceReady);
  const [navigationError, setNavigationError] = useState(false);
  const prepare =
    appointments.isSuccess &&
    !appointments.isFetching &&
    !!appointmentForRegisterStep(appointments.data, company, 'prepare');
  const guardPreparation = () => {
    guard();
    for (const key of [
      USER_PREFERENCES_QUERY_KEY,
      registerClassesKey(owner),
      registersQuery(owner, data.tokens, guard).queryKey,
      ownAppointmentsKey(owner),
    ]) {
      const current = client.getQueryState(key);
      if (current?.status !== 'success' || current.fetchStatus !== 'idle')
        throw new Error('Refresh the register and your current preparation appointment.');
    }
    if (
      !appointmentForRegisterStep(
        client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [],
        company,
        'prepare',
      )
    )
      throw new Error('A current company preparation appointment is required.');
  };
  const authorised =
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const settled = (query: Read) => authorised && query.isSuccess && query.fetchStatus === 'idle';
  const privately = (query: Read, render: () => ReactNode) =>
    appointments.isError ? (
      <Unavailable retry={() => void appointments.refetch()} busy={appointments.isFetching} />
    ) : !appointments.isSuccess || appointments.fetchStatus !== 'idle' ? (
      <Loading />
    ) : !authorised ? (
      <p className="text-sm text-text-muted">{PRIVATE_NOTE}</p>
    ) : query.isError ? (
      <Unavailable retry={() => void query.refetch()} busy={query.isFetching} />
    ) : !settled(query) ? (
      <Loading />
    ) : (
      render()
    );

  let title: string = DESTINATIONS.companyShareholder.title;
  let content: ReactNode;
  if (preferenceRead.isError)
    content = <Unavailable retry={() => void preferenceRead.refetch()} busy={preferenceRead.isFetching} />;
  else if (data.classes.isPending) content = <Loading />;
  else if (data.classes.isError || data.registers.isError)
    content = (
      <Unavailable
        retry={() => {
          void data.classes.refetch();
          void data.registers.refetch();
        }}
        busy={data.classes.isFetching || data.registers.isFetching}
      />
    );
  else if (!data.company)
    content = <p className="py-3 text-sm text-text-muted">This shareholder is not on a register you can read.</p>;
  else if (!sourceReady) content = <Loading />;
  else {
    const registers = data.registers.data ?? [];
    const holdings = registers.flatMap((register) =>
      register.holders.filter((holder) => holder.member === member).map((holder) => ({ register, holder })),
    );
    const former = registers.flatMap((register) =>
      (register.formerMembers ?? []).filter((row) => row.member === member).map((row) => ({ register, row })),
    );
    const recorded = settled(data.particulars)
      ? data.particulars.data?.members.find((row) => row.member === member)
      : undefined;
    title = holdings.length
      ? holdings[0].holder.name || HOLDER_TYPE_LABELS[holdings[0].holder.holderType]
      : recorded?.name || former[0]?.row.name || REGISTER_PARTICULARS_COPY.UNNAMED_MEMBER;
    const current = access.access?.associations.find((row) => row.member === member && row.current);
    const invited = access.access?.invitations.find((row) => row.member === member && row.status === 'pending');
    const waiting = [
      ...(access.requests?.particulars ?? [])
        .filter((row) => row.member === member && row.status === 'submitted')
        .map((row) => ({ uuid: row.uuid, text: 'They asked the company to update their particulars.' })),
      ...(access.requests?.certificates ?? [])
        .filter((row) => row.member === member && row.status === 'requested')
        .map((row) => ({ uuid: row.uuid, text: 'They asked the company for a certificate.' })),
    ];
    const issueClass = [...holdings.map(({ register }) => register), ...registers].find(
      (register) => register.initialized && register.token.status === 'draft',
    )?.token.uuid;
    const className = (token: string) => {
      const register = registers.find((item) => item.token.uuid === token);
      return register ? `${register.token.name} · ${register.token.symbol}` : 'Share class';
    };
    content =
      !holdings.length && !former.length && !recorded ? (
        <p className="py-3 text-sm text-text-muted">This shareholder is not on the register of {data.company.name}.</p>
      ) : (
        <>
          <Section title="Particulars">
            {privately(data.particulars, () => (
              <Rows>
                <Row label="Name">{recorded?.name || title}</Row>
                <Row label="Residential address">{recorded?.residentialAddress || 'Not recorded'}</Row>
              </Rows>
            ))}
            {prepare && holdings.length > 0 && (
              <PageLink
                to={generatePath(DESTINATIONS.companyRegisterParticulars.path, { member })}
                label={REGISTER_PARTICULARS_COPY.PREPARE}
                onClick={(event) => {
                  try {
                    guardPreparation();
                    setNavigationError(false);
                  } catch {
                    event.preventDefault();
                    setNavigationError(true);
                  }
                }}
              />
            )}
            {navigationError && (
              <p role="alert" className="text-sm text-error-light">
                Refresh the register and your current preparation appointment before changing particulars.
              </p>
            )}
          </Section>
          <Section title="Holdings">
            {!holdings.length && <p className="text-sm text-text-muted">No current holding.</p>}
            {holdings.map(({ register, holder }) => (
              <section key={register.token.uuid} className="space-y-3 rounded-xl border border-border-subtle p-4">
                <h3 className="break-words text-base font-medium text-text-primary">
                  {register.token.name} · {register.token.symbol}
                </h3>
                <dl className="grid gap-4 sm:grid-cols-2">
                  {[
                    ['Shares held', formatShareCount(holder.balance)],
                    ['% of class', percentage(holder.balance, register.issuedSupply)],
                    ['Date added', formatDate(holder.enteredOn, 'Not recorded')],
                    ['Holder type', HOLDER_TYPE_LABELS[holder.holderType]],
                    ...(holder.name && holder.name !== title ? [['Name for this class', holder.name]] : []),
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-text-muted">{label}</dt>
                      <dd className="mt-1 break-words text-sm tabular-nums text-text-primary">{value}</dd>
                    </div>
                  ))}
                </dl>
                {holder.holderType === 'ambiguous' && (
                  <p className="text-sm text-text-muted">{REGISTER_COPY.AMBIGUOUS_NOTE}</p>
                )}
                {holder.holderType === 'unidentified' && (
                  <p className="text-sm text-text-muted">{REGISTER_COPY.UNIDENTIFIED_NOTE}</p>
                )}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-text-primary">Optional wallet links</h4>
                  {holder.wallets.length ? (
                    <ul className="space-y-2 text-sm text-text-muted">
                      {holder.wallets.map((wallet) => (
                        <li key={wallet.address} className="break-all">
                          {wallet.address} · {wallet.whitelistStatus}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-text-muted">{REGISTER_COPY.NO_WALLET}</p>
                  )}
                </div>
                {prepare && !holder.wallets.length && register.initialized && register.token.status === 'draft' && (
                  <PageLink
                    to={generatePath(DESTINATIONS.companyRegisterTransfer.path, { uuid: register.token.uuid })}
                    state={{ fromMember: member }}
                    label="Transfer shares"
                  />
                )}
              </section>
            ))}
            {former.map(({ register, row }) => (
              <p key={`${register.token.uuid}/${row.uuid}`} className="text-sm text-text-muted">
                {register.token.name} · {formatShareCount(row.sharesAtCessation)} shares, ceased{' '}
                {formatDate(row.ceasedOn, 'Not recorded')}
                {row.returnedOn ? ` · returned ${formatDate(row.returnedOn)}` : ''}
                {row.correctedBy ? ' · cessation corrected' : ''}
              </p>
            ))}
            {prepare && issueClass && recorded?.walletless && recorded.particularsRetained && (
              <PageLink
                to={DESTINATIONS.companyRegister.path}
                state={{ registerCompany: company, registerToken: issueClass, issueMember: member }}
                label="Issue shares to them"
              />
            )}
            {former.some(({ register }) => register.formerMembersStale) && (
              <p role="status" className="text-sm text-text-muted">
                The former-member history needs a refresh before relying on it.
              </p>
            )}
          </Section>
          <Section title="History">
            {privately(data.entries, () =>
              data.entries.data?.length ? (
                <ul className="divide-y divide-border-subtle">
                  {data.entries.data.map(({ token, entry }) => (
                    <li key={entry.uuid} className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3 text-sm">
                      <span className="text-text-primary">
                        {formatDate(entry.effectiveOn)} · {className(token)} ·{' '}
                        {REGISTER_CORRECTION_COPY.ENTRY_KINDS[entry.kind]}
                      </span>
                      <span className="tabular-nums text-text-primary">
                        {signed(
                          entry.changes
                            .filter((change) => change.member === member)
                            .reduce((sum, change) => sum + BigInt(change.shares), 0n),
                        )}{' '}
                        shares
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-muted">No recorded changes.</p>
              ),
            )}
          </Section>
          {authorised && data.awards.isError && (
            <Section title="Employee awards">
              <Unavailable retry={() => void data.awards.refetch()} busy={data.awards.isFetching} />
            </Section>
          )}
          {settled(data.awards) && !!data.awards.data?.length && (
            <Section title="Employee awards">
              <Rows>
                {data.awards.data.map((award) => (
                  <Row key={award.uuid} label={className(award.token)}>
                    {formatShareCount(award.shares)} promised · {formatShareCount(award.vestedShares)} vested ·{' '}
                    {formatShareCount(award.issuedShares)} issued
                  </Row>
                ))}
              </Rows>
              <PageLink
                to={`${DESTINATIONS.companyRegister.path}#awards`}
                state={{ registerCompany: company }}
                label="Open Employee awards"
              />
            </Section>
          )}
          {waiting.length > 0 && (
            <Section title="Requests from them">
              {waiting.map((row) => (
                <p key={row.uuid} className="text-sm text-text-primary">
                  {row.text}
                </p>
              ))}
              <PageLink to={SHAREHOLDERS} state={{ registerCompany: company }} label="Open member requests" />
            </Section>
          )}
          {access.access && (
            <Section title="Access to their own records">
              <p className="text-sm text-text-primary">
                {current
                  ? 'They can see their own holdings, history and certificates.'
                  : invited
                    ? `Invited, waiting for them to accept until ${formatDateTime(invited.acceptanceDeadline)}.`
                    : 'No access yet. An invitation lets them see their own holdings, history and certificates.'}
              </p>
              {!current && !invited && (
                <PageLink
                  to={SHAREHOLDERS}
                  state={{ registerCompany: company, inviteMember: member }}
                  label="Invite to their records"
                />
              )}
            </Section>
          )}
        </>
      );
  }
  return (
    <PageTitle.Provider value={title}>
      <Page narrow lede={data.company?.name} actions={back}>
        {content}
      </Page>
    </PageTitle.Provider>
  );
}
