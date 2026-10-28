import { useRecordCompany } from '@pages/company/ledger/shared/useRecordCompany';
import { PreparationNotice } from '@pages/company/ledger/shared/PreparationShell';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  REGISTER_COPY,
  TECHNICAL_SHARE_LIMIT,
  USER_PREFERENCES_QUERY_KEY,
  formatShareCount,
  useUserPreferences,
  wholeShares,
} from '@ledova/shared';
import { Page } from '@components/Page';
import { LinkRow, LoadError, Loading, Section, Status } from '@components/Ledger';
import { classPath, registerPlace } from '@pages/company/ledger/shared/registerPlace';
import { useShareClass } from '@pages/company/ledger/shared/useShareClass';
import { ClassRights } from './ClassRights';
import { useClassRights } from './useClassRights';
import { MemberDocuments } from '@pages/company/ledger/shared/MemberDocuments';
import { OnChain } from './OnChain';

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
    <Page back={{ ...registerPlace({ company: data.token.data?.companyUuid }), label: 'Back to Ledger' }}>
      <ShareClassRecord data={data} uuid={uuid} />
    </Page>
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
      <Section title={token.name}>
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
          <section aria-label="Current ownership" className="space-y-4">
            <dl className="grid grid-cols-2 gap-4">
              <div className="min-w-0">
                <dt className="text-xs text-text-muted">Issued shares</dt>
                <dd className="mt-1 break-all text-xl font-medium tabular-nums">
                  {register.issuedSupply === null ? 'Not recorded' : formatShareCount(register.issuedSupply)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-text-muted">Current shareholders</dt>
                <dd className="mt-1 text-xl font-medium tabular-nums">
                  {register.initialized ? formatShareCount(String(register.totalHolders)) : 'Not recorded'}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-text-muted">
              <Status tone={register.initialized ? 'done' : 'waiting'}>
                {register.initialized ? 'Ledger opened' : 'Ledger not opened'}
              </Status>
            </p>
            {token.totalSupply !== TECHNICAL_SHARE_LIMIT && (
              <p className="text-sm text-text-muted">
                Authorised shares ·{' '}
                <span className="break-all font-medium text-text-primary">{formatShareCount(token.totalSupply)}</span>
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
        {token.status === 'draft' && register?.initialized && wholeShares(register.issuedSupply ?? '') === 0n && (
          <LinkRow to={classPath('companyClassChain', token.uuid, token.companyUuid)} label="Put this class on chain">
            <span className="block text-xs text-text-muted">
              Creates its contract. It issues no shares and changes no holding.
            </span>
          </LinkRow>
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
      {token.status !== 'draft' && <OnChain token={token} />}
    </>
  );
}
