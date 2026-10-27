import { useMemo, useRef, useEffect } from 'react';
import { generatePath, Link } from 'react-router-dom';
import {
  DESTINATIONS,
  formatShareCount,
  sharePercentage,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { Page, PageAction } from '@components/Page';
import { LoadError, Loading, Row, Rows, Section } from '@components/Ledger';
import { ListSearch, Pager } from '@components/List';
import { OwnershipMetrics } from './OwnershipMetrics';
import { ownershipColor } from './ownershipColors';
import { useCompanyContext } from '@hooks/useCompanyContext';
import { useOwnershipMember } from './useOwnershipMember';
import { useCompanyOwnership } from './useCompanyOwnership';
import { ownershipView } from './ownershipView';
import { OwnershipCompanies } from './OwnershipCompanies';
import { OwnershipClasses } from './OwnershipClasses';
import { OwnershipHolders } from './OwnershipHolders';
import { OwnershipLoading } from './OwnershipLoading';
import { MemberAwards } from './MemberAwards';
import { GettingStarted } from './GettingStarted';

export function OwnershipBrowser() {
  const { owner, boundary } = useSubmissionOwner();
  const preferences = useUserPreferences();
  return owner ? (
    <SignedInOwnership key={`${owner.userUuid}/${owner.ownerAccountUuid}`} owner={owner} currentOwner={boundary.get} />
  ) : (
    <Page>
      {preferences.isLoading || preferences.isFetching ? (
        <Loading>Loading your account…</Loading>
      ) : (
        <LoadError retry={() => preferences.refetch()} busy={preferences.isFetching}>
          Your account could not be loaded.
        </LoadError>
      )}
    </Page>
  );
}

function SignedInOwnership({
  owner,
  currentOwner,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
}) {
  const context = useCompanyContext();
  const directory = context?.directory;
  const company = context?.company;
  const companyUuid = context?.companyUuid ?? '';
  const current =
    !!directory &&
    directory.owner?.userUuid === owner.userUuid &&
    directory.owner?.ownerAccountUuid === owner.ownerAccountUuid &&
    !directory.hasError &&
    !directory.isLoading &&
    !directory.isRefreshing;
  const guard = useMemo(
    () => () => {
      if (currentOwner() !== owner) throw new Error('Your signed-in account changed. Reopen your dashboard.');
    },
    [owner, currentOwner],
  );
  const ownership = useCompanyOwnership(owner, guard, company?.uuid ?? '', current && !!company?.canReadRegister);
  const memberSummary = directory?.members.find(
    (row) => row.company.uuid === company?.uuid && company?.memberUuids.includes(row.uuid),
  );
  const member = useOwnershipMember(company?.uuid ?? '', memberSummary, current && !!company);
  const memberInvalid =
    member.isSuccess &&
    !member.isFetching &&
    !!memberSummary &&
    (member.data.uuid !== memberSummary.uuid ||
      member.data.member !== memberSummary.member ||
      member.data.company.uuid !== company?.uuid ||
      member.data.identitySource !== 'company_recorded');
  const memberReady = !memberSummary || (member.isSuccess && !member.isFetching);
  const registerReady =
    !company?.canReadRegister ||
    (ownership.classes.isSuccess &&
      !ownership.classes.isFetching &&
      ownership.overview.isSuccess &&
      !ownership.overview.isFetching);
  const ready = current && !!company && memberReady && registerReady;
  const record = ready && !memberInvalid && memberSummary ? member.data : undefined;
  const summary = ready && company?.canReadRegister ? ownership.overview.data : undefined;
  const view = useMemo(() => ownershipView(summary, record), [summary, record]);
  const activated = !['draft', 'submitted', 'review', 'info_required', 'approved'].includes(company?.status ?? '');
  const registered = !!summary?.classes.some(({ initialized }) => initialized);
  const selected = ownership.list.filters.class;
  const selectedClass = view?.classes.find(({ uuid }) => uuid === selected);
  const details = useRef<HTMLHeadingElement>(null);
  const previous = useRef(selected);
  useEffect(() => {
    if (previous.current === selected) return;
    const returned = previous.current;
    previous.current = selected;
    if (selected) details.current?.focus();
    else {
      const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-class-uuid]'));
      const target =
        rows.find((row) => row.dataset.classUuid === returned) ??
        document.querySelector<HTMLInputElement>('input[type="search"][aria-label="Search share classes"]') ??
        document.querySelector<HTMLInputElement>('label + div input[type="search"]') ??
        rows[0];
      target?.focus();
    }
  }, [selected, ready]);
  const failed =
    directory?.hasError ||
    memberInvalid ||
    (company?.canReadRegister && (ownership.classes.isError || ownership.overview.isError || ownership.scopeError)) ||
    (!!memberSummary && member.isError);
  const retry = () =>
    Promise.all([
      directory?.retry(),
      ...(company?.canReadRegister ? [ownership.recover()] : []),
      ...(memberSummary ? [member.refetch()] : []),
    ]);
  return (
    <Page lede="Explore your companies and their share ownership.">
      {!directory || directory.hasError ? (
        <LoadError retry={retry} busy={directory?.isRefreshing}>
          Your ownership records could not be loaded.
        </LoadError>
      ) : !current ? (
        <OwnershipLoading />
      ) : directory.companies.length === 0 ? (
        <Section title="Your companies">
          <p className="text-sm text-text-muted">
            No company relationships yet. Open an invitation email from your company to access your shares or employee
            awards.
          </p>
        </Section>
      ) : (
        <>
          <nav aria-label="Ownership trail" className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            {directory.companies.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => context?.selectCompany(null)}
                  className="text-text-muted hover:text-text-primary"
                >
                  Your companies
                </button>
                {company && (
                  <span aria-hidden className="text-text-muted">
                    /
                  </span>
                )}
              </>
            )}
            {company &&
              (selected ? (
                <button
                  type="button"
                  onClick={() => ownership.select(null)}
                  className="max-w-full break-words text-text-muted hover:text-text-primary"
                >
                  {company.name}
                </button>
              ) : (
                <span className="break-words font-medium">{company.name}</span>
              ))}
            {selectedClass && (
              <>
                <span aria-hidden className="text-text-muted">
                  /
                </span>
                <span className="break-words font-medium">{selectedClass.symbol}</span>
              </>
            )}
          </nav>
          <div
            className={
              directory.companies.length > 1
                ? 'grid min-w-0 items-start gap-5 xl:grid-cols-[14rem_minmax(0,1fr)]'
                : 'min-w-0'
            }
          >
            {directory.companies.length > 1 && (
              <div className={companyUuid ? 'hidden min-w-0 xl:block' : 'min-w-0'}>
                <OwnershipCompanies
                  companies={directory.companies}
                  selected={companyUuid}
                  onSelect={(uuid) => context?.selectCompany(uuid)}
                />
              </div>
            )}
            <div className="flex min-w-0 flex-col gap-5">
              {!company ? (
                <Section title={companyUuid ? 'Company unavailable' : 'Ownership overview'}>
                  <p role={companyUuid ? 'alert' : undefined} className="text-sm text-text-muted">
                    {companyUuid
                      ? 'This company is no longer available to your account.'
                      : 'Choose a company to explore its shares and your position.'}
                  </p>
                </Section>
              ) : failed ? (
                <LoadError retry={retry} busy={directory.isRefreshing}>
                  Your ownership records could not be loaded.
                </LoadError>
              ) : !ready ? (
                <OwnershipLoading />
              ) : (
                <>
                  {company.canManage && (!activated || !registered) && (
                    <GettingStarted activated={activated} registered={registered} />
                  )}
                  {view ? (
                    <>
                      <Section title={company.name}>
                        <p className="text-sm text-text-muted">
                          {[
                            company.canManage
                              ? 'Company administrator'
                              : company.canReadRegister
                                ? 'Company access'
                                : null,
                            record ? 'Member' : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        {view.summary ? (
                          <OwnershipMetrics summary={view.summary} />
                        ) : (
                          <dl className="grid grid-cols-2 gap-4 border-b border-border-subtle pb-4">
                            <div>
                              <dt className="text-sm text-text-muted">Your issued shares</dt>
                              <dd className="mt-1 text-2xl font-medium tabular-nums">
                                {formatShareCount(view.total ?? '0')}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-sm text-text-muted">Classes held</dt>
                              <dd className="mt-1 text-2xl font-medium tabular-nums">
                                {
                                  view.classes.filter(({ ownShares }) => ownShares !== null && BigInt(ownShares) > 0n)
                                    .length
                                }
                              </dd>
                            </div>
                          </dl>
                        )}
                        <OwnershipClasses
                          classes={view.classes}
                          total={view.total}
                          complete={view.complete}
                          personalOnly={view.personalOnly}
                          hasMember={!!record}
                          selected={selected || null}
                          onSelect={ownership.select}
                          list={ownership.list}
                        />
                      </Section>
                      {selected && (
                        <Section
                          title="Class details"
                          header={
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <h2 ref={details} tabIndex={-1} className="font-display text-xl focus:outline-none">
                                {selectedClass?.name ?? 'Class unavailable'}
                              </h2>
                              <PageAction label="All classes" onClick={() => ownership.select(null)} />
                            </div>
                          }
                        >
                          {!selectedClass ? (
                            <p role="status" className="text-sm text-text-muted">
                              This share class is no longer available in the company overview.
                            </p>
                          ) : (
                            <>
                              <Rows>
                                <Row label="Share class">{selectedClass.symbol}</Row>
                                {!view.personalOnly && (
                                  <Row label="Issued shares">
                                    {selectedClass.issuedSupply === null
                                      ? 'Not recorded'
                                      : formatShareCount(selectedClass.issuedSupply)}
                                  </Row>
                                )}
                                {record && (
                                  <Row label="Your shares">
                                    {selectedClass.ownShares === null
                                      ? 'Not recorded'
                                      : formatShareCount(selectedClass.ownShares)}
                                  </Row>
                                )}
                                {record &&
                                  !view.personalOnly &&
                                  selectedClass.issuedSupply !== null &&
                                  selectedClass.issuedSupply !== '0' &&
                                  selectedClass.ownShares !== null && (
                                    <Row label="Your share of this class">
                                      {sharePercentage(selectedClass.ownShares, selectedClass.issuedSupply)}
                                    </Row>
                                  )}
                              </Rows>
                              {company.canReadRegister ? (
                                <>
                                  {!selectedClass.initialized ? (
                                    <p role="status" className="text-sm text-text-muted">
                                      Current ownership is not available for this class. Its ledger must be opened and
                                      its figures confirmed.
                                    </p>
                                  ) : (
                                    <>
                                      <ListSearch
                                        label="Search shareholders"
                                        list={ownership.list}
                                        noun={['shareholder', 'shareholders']}
                                        count={
                                          ownership.holders.isSuccess && !ownership.holders.isFetching
                                            ? ownership.holders.data.count
                                            : undefined
                                        }
                                      />
                                      <div
                                        className="min-h-48"
                                        aria-busy={ownership.holders.isPending || ownership.holders.isFetching}
                                      >
                                        {ownership.holders.isPending || ownership.holders.isFetching ? (
                                          <Loading>Loading shareholders…</Loading>
                                        ) : ownership.holders.isError ? (
                                          <LoadError retry={() => ownership.holders.refetch()}>
                                            The class’s shareholders could not be confirmed.
                                          </LoadError>
                                        ) : ownership.holders.data.count === 0 ? (
                                          <p className="text-sm text-text-muted">
                                            {ownership.list.search
                                              ? 'No shareholders match your search.'
                                              : 'No current shareholders yet.'}
                                          </p>
                                        ) : (
                                          <OwnershipHolders
                                            holders={ownership.holders.data}
                                            name={selectedClass.name}
                                            symbol={selectedClass.symbol}
                                            color={ownershipColor(view.classes, selectedClass.uuid)}
                                          />
                                        )}
                                      </div>
                                      {ownership.holders.isSuccess && !ownership.holders.isFetching && (
                                        <Pager
                                          label="Class shareholders"
                                          list={ownership.list}
                                          noun={['shareholder', 'shareholders']}
                                          count={ownership.holders.data.count}
                                        />
                                      )}
                                    </>
                                  )}
                                  <Link
                                    to={
                                      context?.companyPath(
                                        generatePath(DESTINATIONS.companyClass.path, { uuid: selectedClass.uuid }),
                                      ) ?? generatePath(DESTINATIONS.companyClass.path, { uuid: selectedClass.uuid })
                                    }
                                    state={{ registerCompany: company.uuid }}
                                    className="w-fit text-sm text-brand-light underline"
                                  >
                                    Class rights and documents
                                  </Link>
                                </>
                              ) : (
                                <p className="text-sm text-text-muted">
                                  Only your own holdings and awards are shown. Other shareholders’ records are private.
                                </p>
                              )}
                            </>
                          )}
                        </Section>
                      )}
                    </>
                  ) : (
                    <Section title="Ownership overview">
                      <p role="status" className="text-sm text-text-muted">
                        The current ownership figures could not be confirmed.
                      </p>
                    </Section>
                  )}
                  {record && <MemberAwards record={record} token={selected || null} />}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
