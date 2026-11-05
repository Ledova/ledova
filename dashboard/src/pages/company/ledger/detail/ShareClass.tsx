import { useRecordCompany } from '@pages/company/ledger/shared/useRecordCompany';
import { PreparationNotice } from '@pages/company/ledger/shared/PreparationShell';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  DESTINATIONS,
  REGISTER_COPY,
  TECHNICAL_SHARE_LIMIT,
  USER_PREFERENCES_QUERY_KEY,
  formatShareCount,
  useClassRights,
  useShareClass,
  useUserPreferences,
} from '@ledova/shared';
import { Page } from '@components/Page';
import { PageTitle } from '@components/PageTitle';
import { LoadError, Loading, Row, Rows, Section, Status } from '@components/Ledger';
import { registerPlace } from '@pages/company/ledger/shared/registerPlace';
import { ClassRights } from './ClassRights';
import { MemberDocuments } from '@pages/company/ledger/shared/MemberDocuments';
import { BROWSER_FILES } from '@utils/saveFile';

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
  const [scope, setScope] = useState({ owner: data.owner, version: 0 });
  if (scope.owner !== data.owner) {
    setScope({ owner: data.owner, version: scope.version + 1 });
    return null;
  }
  return <ShareClassRights key={`${uuid}/${scope.version}`} data={data} uuid={uuid} />;
}

function ShareClassRights({ data, uuid }: { data: ReturnType<typeof useShareClass>; uuid: string }) {
  const rights = useClassRights(
    uuid,
    data.token.isSuccess && data.token.fetchStatus === 'idle',
    data.token.data?.companyUuid,
    BROWSER_FILES,
    () => crypto.randomUUID(),
  );
  useEffect(() => {
    data.holdReads('class-rights', !!rights.editor || rights.pending || rights.busy);
    return () => data.holdReads('class-rights', false);
  }, [rights.editor, rights.pending, rights.busy, data.holdReads]);
  return (
    <ShareClassDetails
      key={`${data.tokenKey.join('/')}/${data.token.data?.companyUuid}/${data.token.data?.isOwner === true}`}
      data={data}
      rights={<ClassRights rights={rights} />}
    />
  );
}

function ShareClassDetails({ data, rights }: { data: ReturnType<typeof useShareClass>; rights: ReactNode }) {
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
  if (data.token.isPending)
    return (
      <>
        <Loading>Loading the share class…</Loading>
        {rights}
      </>
    );
  if (data.token.isError || !token)
    return (
      <>
        <LoadError retry={data.token.refetch} busy={data.token.isFetching}>
          This share class could not be loaded. It may be unavailable to this account.
        </LoadError>
        {rights}
      </>
    );
  const register = registerReady ? data.register.data : undefined;
  return (
    <>
      <Section title="Summary">
        <p className="text-sm text-text-muted">
          {token.symbol} · {token.tokenTypeDisplay}
        </p>
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
      {rights}
      {data.owner && (
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
