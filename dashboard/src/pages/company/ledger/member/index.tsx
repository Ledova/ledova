import { useMemo, useState, type ReactNode } from 'react';
import { generatePath, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  HOLDER_TYPE_LABELS,
  REGISTER_COPY,
  REGISTER_CORRECTION_COPY,
  REGISTER_PARTICULARS_COPY,
  USER_PREFERENCES_QUERY_KEY,
  appointmentForParticularsEdit,
  appointmentForRegisterStep,
  formatDate,
  formatDateTime,
  awardSummary,
  formatShortDate,
  hasCurrentRegisterReadAuthority,
  holdingFacts,
  useCompanyMemberAccess,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
  type OwnCompanyAppointment,
  shareCount,
  signedShares,
  registerClassesKey,
  registersKey,
  ownAppointmentsKey,
  useOwnAppointments,
  useShareholder,
} from '@ledova/shared';
import { LinkRow, Section, LoadError, Loading, Failure } from '@components/Ledger';
import { Page, PageLink } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { ownerGuard } from '@pages/company/shared/ownerGuard';
import { MemberDocuments } from '@pages/company/ledger/shared/MemberDocuments';
import { awardPath } from '@pages/company/ledger/shared/awards';
import { AccountCheck } from '@components/AccountCheck';

const PRIVATE_NOTE =
  'Particulars, history and awards show only to someone with a current company register appointment.';

interface Read {
  isError: boolean;
  isSuccess: boolean;
  isFetching: boolean;
  fetchStatus: string;
  refetch: () => unknown;
}

export default function CompanyShareholderPage() {
  const { member = '' } = useParams();
  const [params] = useSearchParams();
  const company = params.get('company') ?? '';
  const { owner, boundary } = useSubmissionOwner();
  if (owner)
    return (
      <OwnShareholder
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${company}/${member}`}
        owner={owner}
        currentOwner={boundary.get}
        company={company}
        member={member}
      />
    );
  return (
    <Page back={{ state: company ? { registerCompany: company } : undefined }}>
      <AccountCheck />
    </Page>
  );
}

function OwnShareholder({
  owner,
  currentOwner,
  company,
  member,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
  member: string;
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
  const edit =
    appointments.isSuccess && !appointments.isFetching && !!appointmentForParticularsEdit(appointments.data, company);
  const guardEdit = () => {
    guard();
    for (const key of [
      USER_PREFERENCES_QUERY_KEY,
      registerClassesKey(owner),
      registersKey(owner, data.tokens),
      ownAppointmentsKey(owner),
    ]) {
      const current = client.getQueryState(key);
      if (current?.status !== 'success' || current.fetchStatus !== 'idle')
        throw new Error('Refresh the register and your current appointment.');
    }
    if (
      !appointmentForParticularsEdit(
        client.getQueryData<OwnCompanyAppointment[]>(ownAppointmentsKey(owner)) ?? [],
        company,
      )
    )
      throw new Error('A current company appointment that can change particulars is required.');
  };
  const authorised =
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle' &&
    hasCurrentRegisterReadAuthority(appointments.data, company);
  const settled = (query: Read) => authorised && query.isSuccess && query.fetchStatus === 'idle';
  const privately = (query: Read, noun: string, render: () => ReactNode) =>
    appointments.isError ? (
      <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
        Your appointments could not be loaded.
      </LoadError>
    ) : !appointments.isSuccess || appointments.fetchStatus !== 'idle' ? (
      <Loading>Loading your appointments…</Loading>
    ) : !authorised ? (
      <p className="text-sm text-text-muted">{PRIVATE_NOTE}</p>
    ) : query.isError ? (
      <LoadError retry={() => query.refetch()} busy={query.isFetching}>
        {noun} could not be loaded.
      </LoadError>
    ) : !settled(query) ? (
      <Loading>Loading {noun.toLowerCase()}…</Loading>
    ) : (
      render()
    );

  let title: string = DESTINATIONS.companyShareholder.title;
  let content: ReactNode;
  if (preferenceRead.isError)
    content = (
      <LoadError retry={() => preferenceRead.refetch()} busy={preferenceRead.isFetching}>
        Your account could not be loaded.
      </LoadError>
    );
  else if (data.classes.isPending) content = <Loading>Loading the register…</Loading>;
  else if (data.classes.isError || data.registers.isError)
    content = (
      <LoadError
        retry={() => {
          void data.classes.refetch();
          void data.registers.refetch();
        }}
        busy={data.classes.isFetching || data.registers.isFetching}
      >
        The register could not be loaded.
      </LoadError>
    );
  else if (!data.company)
    content = <p className="py-3 text-sm text-text-muted">This shareholder is not on a register you can read.</p>;
  else if (!sourceReady) content = <Loading>Loading the register…</Loading>;
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
    const issueClass = [...holdings.map(({ register }) => register), ...registers].find(
      (register) => register.initialized && register.token.status === 'draft',
    )?.token.uuid;
    const className = (token: string) => {
      const register = registers.find((item) => item.token.uuid === token);
      return register ? `${register.token.name} · ${register.token.symbol}` : 'Share class';
    };
    const absent = (
      <p className="py-3 text-sm text-text-muted">This shareholder is not on the register of {data.company.name}.</p>
    );
    content =
      !holdings.length && !former.length && !recorded ? (
        appointments.isSuccess && appointments.fetchStatus === 'idle' && !authorised ? (
          absent
        ) : (
          privately(data.particulars, 'Their particulars', () => absent)
        )
      ) : (
        <>
          <Section title="Particulars">
            {privately(data.particulars, 'Their particulars', () => (
              <div className="flex flex-col gap-1 text-sm">
                <p className="break-words text-text-primary">{recorded?.name || title}</p>
                <p className="whitespace-pre-line break-words text-text-muted">
                  {recorded?.residentialAddress ? (
                    <>
                      <span className="sr-only">Residential address: </span>
                      {recorded.residentialAddress}
                    </>
                  ) : (
                    'Residential address not recorded'
                  )}
                </p>
              </div>
            ))}
            {settled(data.particulars) &&
              (recorded?.followsProfile ? (
                <p className="text-sm text-text-muted">{REGISTER_PARTICULARS_COPY.FOLLOWS_PROFILE}</p>
              ) : (
                edit &&
                (holdings.length > 0 || recorded?.onRegister === false) && (
                  <div className="flex justify-end">
                    <PageLink
                      compact
                      to={generatePath(DESTINATIONS.companyRegisterParticulars.path, { member })}
                      label={REGISTER_PARTICULARS_COPY.PREPARE}
                      onClick={(event) => {
                        try {
                          guardEdit();
                          setNavigationError(false);
                        } catch {
                          event.preventDefault();
                          setNavigationError(true);
                        }
                      }}
                    />
                  </div>
                )
              ))}
            {navigationError && (
              <Failure>Refresh the register and your current appointment before changing particulars.</Failure>
            )}
          </Section>
          <Section title="Holdings">
            {!holdings.length && <p className="text-sm text-text-muted">No current holding.</p>}
            {holdings.length > 0 && (
              <ul aria-label="Current holdings" className="divide-y divide-border-subtle">
                {holdings.map(({ register, holder }) => (
                  <li key={register.token.uuid} className="flex flex-col gap-1 py-3 text-sm">
                    <div className="flex items-baseline justify-between gap-3 font-medium text-text-primary">
                      <h3 className="min-w-0 break-words">
                        {register.token.name} · {register.token.symbol}
                      </h3>
                      <span className="shrink-0 whitespace-nowrap tabular-nums">{shareCount(holder.balance)}</span>
                    </div>
                    <p className="break-words text-xs text-text-muted">{holdingFacts({ register, holder })}</p>
                    {holder.name && holder.name !== title && (
                      <p className="break-words text-xs text-text-muted">Name for this class: {holder.name}</p>
                    )}
                    {holder.holderType === 'ambiguous' && (
                      <p className="text-sm text-text-muted">{REGISTER_COPY.AMBIGUOUS_NOTE}</p>
                    )}
                    {holder.holderType === 'unidentified' && (
                      <p className="text-sm text-text-muted">{REGISTER_COPY.UNIDENTIFIED_NOTE}</p>
                    )}
                    {prepare && !holder.wallets.length && register.initialized && register.token.status === 'draft' && (
                      <div className="flex justify-end">
                        <PageLink
                          compact
                          to={generatePath(DESTINATIONS.companyRegisterTransfer.path, { uuid: register.token.uuid })}
                          state={{ fromMember: member }}
                          label="Transfer shares"
                          context={register.token.name}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {former.map(({ register, row }) => (
              <p key={`${register.token.uuid}/${row.uuid}`} className="text-sm text-text-muted">
                {register.token.name} · {shareCount(row.sharesAtCessation)}, ceased{' '}
                {formatShortDate(row.ceasedOn, 'Not recorded')}
                {row.returnedOn ? ` · returned ${formatShortDate(row.returnedOn)}` : ''}
                {row.correctedBy ? ' · cessation corrected' : ''}
              </p>
            ))}
            {prepare && issueClass && recorded?.walletless && recorded.particularsRetained && (
              <div className="flex justify-end">
                <PageLink
                  compact
                  to={`${DESTINATIONS.companyRegister.path}?company=${company}#issue`}
                  state={{ registerCompany: company, registerToken: issueClass, issueMember: member }}
                  label="Issue shares to them"
                />
              </div>
            )}
            {former.some(({ register }) => register.formerMembersStale) && (
              <p role="status" className="text-sm text-text-muted">
                The former-member history needs a refresh before relying on it.
              </p>
            )}
          </Section>
          <Section title="History">
            {privately(data.entries, 'Their history', () =>
              data.entries.data?.length ? (
                <ul className="divide-y divide-border-subtle">
                  {data.entries.data.map(({ token, entry }) => (
                    <li key={entry.uuid} className="flex flex-col gap-1 py-3 text-sm">
                      <p className="flex items-baseline justify-between gap-3 font-medium text-text-primary">
                        <span className="min-w-0 break-words">{REGISTER_CORRECTION_COPY.ENTRY_KINDS[entry.kind]}</span>
                        <span className="shrink-0 whitespace-nowrap tabular-nums">
                          {signedShares(
                            entry.changes
                              .filter((change) => change.member === member)
                              .reduce((sum, change) => sum + BigInt(change.shares), 0n),
                          )}{' '}
                          shares
                        </span>
                      </p>
                      <p className="break-words text-xs text-text-muted">
                        {formatShortDate(entry.effectiveOn)} · {className(token)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-text-muted">No changes yet.</p>
              ),
            )}
          </Section>
          {authorised && data.awards.isError && (
            <Section title="Employee awards">
              <LoadError retry={() => data.awards.refetch()} busy={data.awards.isFetching}>
                Employee awards could not be loaded.
              </LoadError>
            </Section>
          )}
          {settled(data.awards) && !!data.awards.data?.length && (
            <Section title="Employee awards">
              <ul aria-label="Employee awards" className="divide-y divide-border-subtle">
                {data.awards.data.map((award) => (
                  <li key={award.uuid}>
                    <LinkRow
                      to={awardPath(award.token, award.uuid, company)}
                      state={{ registerCompany: company, registerToken: award.token }}
                      label={className(award.token)}
                      context={`employee award, agreement ${formatDate(award.termsOn)}`}
                      figure={
                        <span className="shrink-0 whitespace-nowrap font-medium tabular-nums text-text-primary">
                          {awardSummary(award).figure}
                        </span>
                      }
                    >
                      <span className="block text-xs text-text-muted">{awardSummary(award).facts}</span>
                    </LinkRow>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <PageLink
                  compact
                  to={`${DESTINATIONS.companyRegister.path}?company=${company}#awards`}
                  state={{ registerCompany: company }}
                  label="Open Employee share scheme"
                />
              </div>
            </Section>
          )}
          {access.access && (
            <Section title="Access to their own records">
              <p className="text-sm text-text-primary">
                {current
                  ? 'They can see their own holdings and history.'
                  : invited
                    ? `Invited, waiting for them to accept until ${formatDateTime(invited.acceptanceDeadline)}.`
                    : 'No access yet. An invitation lets them see their own holdings and history.'}
              </p>
              {!current && !invited && (
                <div className="flex justify-end">
                  <PageLink
                    compact
                    to={`${DESTINATIONS.companyRegister.path}?company=${company}#member-access`}
                    state={{ registerCompany: company, inviteMember: member }}
                    label="Invite to their records"
                  />
                </div>
              )}
            </Section>
          )}
        </>
      );
  }
  return (
    <PageTitle.Provider value={title}>
      <Page
        documentTitle={DESTINATIONS.companyShareholder.title}
        back={{ state: company ? { registerCompany: company } : undefined }}
      >
        {content}
        {data.company && (
          <MemberDocuments
            owner={owner}
            guard={guard}
            company={company}
            member={member}
            sourceReady={sourceReady}
            holdings={(data.registers.data ?? []).flatMap((register) =>
              register.holders
                .filter((holder) => holder.member === member)
                .map(() => ({
                  member,
                  token: register.token.uuid,
                  label: `${register.token.name} · ${register.token.symbol}`,
                })),
            )}
          />
        )}
      </Page>
    </PageTitle.Provider>
  );
}
