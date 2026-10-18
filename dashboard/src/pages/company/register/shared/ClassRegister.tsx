import { REGISTER_COPY, formatShareCount, type TokenHoldersResponse } from '@ledova/shared';
import { Rows, Row, Status } from '@components/Ledger';

export function ClassRegister({ register }: { register: TokenHoldersResponse }) {
  return (
    <div className="flex flex-col gap-4">
      <section aria-label={`${register.token.name} share summary`}>
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
              {register.initialized ? register.totalHolders : 'Not recorded'}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-text-muted">
          <Status tone={register.initialized ? 'done' : 'waiting'}>
            {register.initialized ? 'Register opened' : 'Register not opened'}
          </Status>
        </p>
      </section>
      {register.token.totalSupply !== (2n ** 256n - 1n).toString() ? (
        <p className="text-sm text-text-muted">
          Authorised shares ·{' '}
          <span className="break-all font-medium text-text-primary">
            {formatShareCount(register.token.totalSupply)}
          </span>
        </p>
      ) : (
        <details className="text-xs text-text-muted">
          <summary className="cursor-pointer">Technical share limit</summary>
          <p className="mt-2 break-all">{formatShareCount(register.token.totalSupply)}</p>
        </details>
      )}
      {!register.initialized ? (
        <p className="text-sm text-text-muted">{REGISTER_COPY.NOT_OPENED_NOTE}</p>
      ) : (
        <>
          {register.waitingEffects === null ? (
            <p role="status" className="text-sm text-text-muted">
              {REGISTER_COPY.WAITING_UNKNOWN_NOTE}
            </p>
          ) : register.waitingEffects > 0 ? (
            <p role="status" className="text-sm text-text-muted">
              {REGISTER_COPY.WAITING_NOTE(register.waitingEffects)}
            </p>
          ) : null}
          {register.holders.length === 0 ? (
            <p className="text-sm text-text-muted">No current members are recorded for this class.</p>
          ) : null}
          {!!register.formerMembers?.length && (
            <details className="space-y-3 border-t border-border-subtle pt-4">
              <summary className="cursor-pointer text-sm font-medium text-text-primary">
                {REGISTER_COPY.FORMER_TITLE} · {register.formerMembers.length}
              </summary>
              <p className="text-sm text-text-muted">{REGISTER_COPY.FORMER_NOTE}</p>
              {register.formerMembersStale && (
                <p role="status" className="text-sm text-text-muted">
                  The former-member history needs a refresh before relying on it.
                </p>
              )}
              <ul className="divide-y divide-border-subtle">
                {register.formerMembers.map((former) => (
                  <li key={former.uuid} className="flex flex-col gap-2 py-4">
                    <p className="text-base text-text-primary">{former.name || 'Name not recorded'}</p>
                    <Rows>
                      {former.member && <Row label="Member ID">{former.member}</Row>}
                      <Row label="Shares at cessation">{formatShareCount(former.sharesAtCessation)}</Row>
                      <Row label="Ceased on">{former.ceasedOn}</Row>
                      <Row label="Identity source">{former.identitySourceDisplay}</Row>
                      {former.sourceEntry && <Row label="Cessation entry">{former.sourceEntry}</Row>}
                      {former.sourceEntrySequence !== null && (
                        <Row label="Cessation entry sequence">{former.sourceEntrySequence}</Row>
                      )}
                      {former.sourceEntryKind && <Row label="Cessation entry kind">{former.sourceEntryKind}</Row>}
                      {former.sourceEffectiveOn && <Row label="Source effective date">{former.sourceEffectiveOn}</Row>}
                      {former.corrects && <Row label="Corrects entry">{former.corrects}</Row>}
                      {former.correctedBy && <Row label="Corrected by entry">{former.correctedBy}</Row>}
                      {former.returnedOn && <Row label="Returned on">{former.returnedOn}</Row>}
                      {former.returnedEntry && <Row label="Return entry">{former.returnedEntry}</Row>}
                      {former.walletAddress && <Row label="Recorded wallet">{former.walletAddress}</Row>}
                      {former.ceasedAtBlock !== null && (
                        <Row label="Recorded cessation block">{former.ceasedAtBlock}</Row>
                      )}
                    </Rows>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
