import { useRecordCompany } from '@pages/company/ledger/shared/useRecordCompany';
import { PreparationNotice } from '@pages/company/ledger/shared/PreparationShell';
import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { matchPath, useLocation } from 'react-router-dom';
import {
  DESTINATIONS,
  REGISTER_COPY,
  TECHNICAL_SHARE_LIMIT,
  USER_PREFERENCES_QUERY_KEY,
  formatShareCount,
  useClassRights,
  useShareClass,
  useUserPreferences,
  useOwnAppointments,
  registerSteps,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { Actions, Page } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { LoadError, Loading, Row, Rows, Section, Status } from '@components/Ledger';
import { registerPlace } from '@pages/company/ledger/shared/registerPlace';
import { ClassRights, RightsSummary } from './ClassRights';
import { MemberDocuments } from '@pages/company/ledger/shared/MemberDocuments';
import { BROWSER_FILES } from '@utils/saveFile';
import { AccountCheck } from '@components/AccountCheck';
import { ClassSetup } from './ClassSetup';
import { ClassDeleteAction, ClassDetails, ClassDetailsEditAction, ClassDetailsContent } from './ClassDetails';
import { useClassDetails } from './useClassDetails';
import { useLedgerNavigation } from '@components/LedgerNavigation';

export function ShareClass({ uuid }: { uuid: string }) {
  const data = useShareClass(uuid);
  const companyMatches = useRecordCompany(data.token.data?.companyUuid, data.guard);
  if (!companyMatches)
    return (
      <Page>
        <PreparationNotice />
      </Page>
    );
  return (
    <PageTitle.Provider value={data.token.data?.name ?? DESTINATIONS.companyClass.title}>
      <Page back={{ ...registerPlace({ company: data.token.data?.companyUuid }), label: 'Back to Ledger' }}>
        <ShareClassRecord data={data} uuid={uuid} />
      </Page>
    </PageTitle.Provider>
  );
}

function ShareClassRecord({ data, uuid }: { data: ReturnType<typeof useShareClass>; uuid: string }) {
  const location = useLocation();
  const requested =
    !!matchPath(DESTINATIONS.companyRegisterImport.path, location.pathname) ||
    new URLSearchParams(location.search).has('record');
  const [scope, setScope] = useState({ owner: data.owner, version: 0 });
  if (scope.owner !== data.owner) {
    setScope({ owner: data.owner, version: scope.version + 1 });
    return null;
  }
  return data.owner ? (
    <ShareClassWorkspace
      key={`${uuid}/${scope.version}/${requested ? 'opening' : 'summary'}`}
      data={data}
      uuid={uuid}
      owner={data.owner}
      requested={requested}
    />
  ) : (
    <AccountCheck />
  );
}

function ShareClassWorkspace({
  data,
  uuid,
  owner,
  requested,
}: {
  data: ReturnType<typeof useShareClass>;
  uuid: string;
  owner: OrderSubmissionOwner;
  requested: boolean;
}) {
  const { setState: setLedgerNavigation } = useLedgerNavigation();
  const appointments = useOwnAppointments(owner, data.guard, { enabled: data.token.isSuccess });
  const [setup, setSetup] = useState<boolean | null>(null);
  const [setupHeld, setSetupHeld] = useState(false);
  const [detailsHeld, setDetailsHeld] = useState(false);
  const steps =
    data.token.data && appointments.data ? registerSteps(appointments.data, data.token.data.companyUuid) : null;
  const canSetUp = !!(steps?.prepare || steps?.approve || steps?.apply);
  const ready =
    data.token.isSuccess &&
    data.token.fetchStatus === 'idle' &&
    data.register.isSuccess &&
    data.register.fetchStatus === 'idle' &&
    appointments.isSuccess &&
    appointments.fetchStatus === 'idle';
  if (setup === null && ready) setSetup(canSetUp && (requested || !data.register.data?.initialized));
  const heldSetup = useCallback(
    (held: boolean) => {
      setSetupHeld(held);
      data.holdReads('class-setup', held);
    },
    [data.holdReads],
  );
  const heldDetails = useCallback(
    (held: boolean) => {
      setDetailsHeld(held);
      data.holdReads('class-details', held);
    },
    [data.holdReads],
  );
  const detailsAvailable = ready && !setupHeld && (!data.readingPaused || detailsHeld);
  const details = useClassDetails(data, owner, detailsAvailable, heldDetails);
  const company = data.token.data?.companyUuid;
  const recordsChanged = useCallback(() => {
    void data.token.refetch();
  }, [data.token.refetch]);
  const classDetailsVisible = !!(
    data.token.data?.canEditDetails ||
    data.token.data?.canDelete ||
    data.token.data?.deletionBlockedReason ||
    details.held ||
    details.outcome
  );
  const rights = useClassRights(
    uuid,
    data.token.isSuccess && data.token.fetchStatus === 'idle' && !detailsHeld,
    data.token.data?.companyUuid,
    BROWSER_FILES,
    () => crypto.randomUUID(),
  );
  const rightsHeld = !!rights.editor || rights.pending || rights.busy;
  const navigationHeld = details.busy || details.pending || rightsHeld;
  useLayoutEffect(() => {
    setLedgerNavigation({ company, token: uuid, blocked: navigationHeld, held: navigationHeld });
    return () => setLedgerNavigation((current) => (current?.token === uuid ? null : current));
  }, [setLedgerNavigation, company, uuid, navigationHeld]);
  useEffect(() => {
    data.holdReads('class-rights', !!rights.editor || rights.pending || rights.busy);
    return () => data.holdReads('class-rights', false);
  }, [rights.editor, rights.pending, rights.busy, data.holdReads]);
  return (
    <>
      {setup === false && data.token.data && classDetailsVisible && (
        <div hidden={data.token.isError || data.register.isError || appointments.isError}>
          <ClassDetails token={data.token.data} details={details} available={detailsAvailable} />
        </div>
      )}
      <ShareClassDetails
        key={`${data.tokenKey.join('/')}/${data.token.data?.companyUuid}/${data.token.data?.isOwner === true}`}
        data={data}
        showClassDetails={!classDetailsVisible}
        setup={
          setup === null ? (
            data.register.isError ? (
              <LoadError retry={() => data.register.refetch()} busy={data.register.isFetching}>
                The current ownership could not be loaded.
              </LoadError>
            ) : appointments.isError ? (
              <LoadError retry={() => appointments.refetch()} busy={appointments.isFetching}>
                Your class setup access could not be loaded.
              </LoadError>
            ) : (
              <Loading>Loading the share class…</Loading>
            )
          ) : setup ? (
            <ClassSetup
              uuid={uuid}
              owner={owner}
              guard={data.guard}
              available={data.token.isSuccess && !data.register.isError && !appointments.isError}
              externalHeld={data.readingPaused && !setupHeld && !detailsHeld && !details.held}
              classHeld={details.held}
              onHeldChange={heldSetup}
              classActions={
                data.token.data && (
                  <>
                    <ClassDetailsEditAction token={data.token.data} details={details} available={detailsAvailable} />
                    <ClassDeleteAction token={data.token.data} details={details} available={detailsAvailable} />
                  </>
                )
              }
              classDetails={(recordFields) =>
                data.token.data && (
                  <ClassDetailsContent token={data.token.data} details={details} available={detailsAvailable}>
                    {recordFields}
                  </ClassDetailsContent>
                )
              }
              classContent={<ClassRights rights={rights} embedded blocked={setupHeld || detailsHeld} />}
              classContentHeld={rightsHeld}
              classReview={
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-text-primary">Class rights</h3>
                  {rights.current ? (
                    <RightsSummary revision={rights.current} rights={rights} />
                  ) : (
                    <p className="text-sm text-text-muted">
                      {rights.ready ? 'No rights recorded.' : 'Class rights are not currently available.'}
                    </p>
                  )}
                </div>
              }
              onRecordsChanged={recordsChanged}
            />
          ) : undefined
        }
        rights={setup === false ? <ClassRights rights={rights} /> : null}
      />
      {setup === false && data.token.data && (data.token.data.canDelete || data.token.data.deletionBlockedReason) && (
        <div
          hidden={data.token.isError || data.register.isError || appointments.isError || !!details.editor || rightsHeld}
        >
          <Actions>
            <ClassDeleteAction token={data.token.data} details={details} available={detailsAvailable} />
          </Actions>
        </div>
      )}
    </>
  );
}

function ShareClassDetails({
  data,
  rights,
  setup,
  showClassDetails,
}: {
  data: ReturnType<typeof useShareClass>;
  rights: ReactNode;
  setup?: ReactNode;
  showClassDetails: boolean;
}) {
  const preferences = useUserPreferences();
  const preferencesRead = useQueryClient().getQueryState(USER_PREFERENCES_QUERY_KEY);
  const onDocumentsHeld = useCallback((held: boolean) => data.holdReads('member-documents', held), [data.holdReads]);
  const registerReady =
    !!preferences.preferences &&
    preferencesRead?.status === 'success' &&
    preferences.fetchStatus === 'idle' &&
    data.token.isSuccess &&
    data.token.fetchStatus === 'idle' &&
    data.register.isSuccess &&
    data.register.fetchStatus === 'idle';
  const token = data.token.data;
  const unavailable = data.token.isPending || data.token.isError || !token;
  const register = registerReady ? data.register.data : undefined;
  return (
    <>
      {data.token.isPending ? (
        <Loading>Loading the share class…</Loading>
      ) : unavailable ? (
        <LoadError retry={data.token.refetch} busy={data.token.isFetching}>
          This share class could not be loaded. It may be unavailable to this account.
        </LoadError>
      ) : null}
      <div hidden={unavailable}>
        {setup ??
          (token && (
            <Section title="Summary">
              {showClassDetails && (
                <p className="text-sm text-text-muted">
                  {token.symbol} · {token.tokenTypeDisplay}
                </p>
              )}
              {preferencesRead?.status === 'error' ? (
                <LoadError retry={() => preferences.refetch()} busy={preferences.isFetching}>
                  Your account could not be loaded.
                </LoadError>
              ) : data.register.isError ? (
                <LoadError retry={data.register.refetch} busy={data.register.isFetching}>
                  The current ownership could not be loaded.
                </LoadError>
              ) : !register ? (
                <Loading>Loading current ownership…</Loading>
              ) : (
                <section aria-label="Current ownership" className="space-y-3">
                  <Rows>
                    <Row inline label="Issued shares">
                      {register.issuedSupply === null ? 'Not recorded' : formatShareCount(register.issuedSupply)}
                    </Row>
                    <Row inline label="Current shareholders">
                      {register.initialized ? formatShareCount(String(register.totalHolders)) : 'Not recorded'}
                    </Row>
                    {token.totalSupply !== TECHNICAL_SHARE_LIMIT && (
                      <Row inline label="Authorised shares">
                        {formatShareCount(token.totalSupply)}
                      </Row>
                    )}
                  </Rows>
                  {!register.initialized && (
                    <p className="text-xs text-text-muted">
                      <Status tone="waiting">Ledger not opened</Status>
                    </p>
                  )}
                  {!token.isTransferable && (
                    <p className="text-sm text-text-muted">This share class is recorded as non-transferable.</p>
                  )}
                  {!register.initialized ? (
                    <p className="text-sm text-text-muted">{REGISTER_COPY.NOT_OPENED_NOTE}</p>
                  ) : register.waitingEffects === null ? (
                    <p role="status" className="text-sm text-text-muted">
                      {REGISTER_COPY.WAITING_UNKNOWN_NOTE}
                    </p>
                  ) : register.waitingEffects > 0 ? (
                    <p role="status" className="text-sm text-text-muted">
                      {REGISTER_COPY.WAITING_NOTE(register.waitingEffects)}
                    </p>
                  ) : null}
                </section>
              )}
            </Section>
          ))}
      </div>
      {rights}
      {!unavailable && data.owner && token && (
        <MemberDocuments
          title="Shareholder documents"
          readsPaused={data.readingPaused}
          onHeldChange={onDocumentsHeld}
          owner={data.owner}
          guard={data.guard}
          company={token.companyUuid}
          token={token.uuid}
          sourceReady={registerReady}
          holdings={(data.register.data?.holders ?? []).map((holder) => ({
            member: holder.member,
            token: token.uuid,
            label: holder.name || 'Unnamed shareholder',
          }))}
        />
      )}
    </>
  );
}
