import {
  DESTINATIONS,
  HOLDER_TYPE_LABELS,
  REGISTER_COPY,
  REGISTER_PARTICULARS_COPY,
  formatShareCount,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { LinkRow, Rows, Row, Status } from '@components/Ledger';

export function ClassRegister({ register, prepare = false }: { register: TokenHoldersResponse; prepare?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <section aria-label={`${register.token.name} share summary`}>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="col-span-2 rounded-xl bg-surface-tertiary p-4 sm:col-span-1">
            <dt className="text-xs text-text-muted">Issued shares</dt>
            <dd className="mt-2 break-all text-2xl font-medium tabular-nums">
              {register.issuedSupply === null ? 'Not recorded' : formatShareCount(register.issuedSupply)}
            </dd>
          </div>
          <div className="rounded-xl bg-surface-tertiary p-4">
            <dt className="text-xs text-text-muted">Current shareholders</dt>
            <dd className="mt-2 text-2xl font-medium tabular-nums">
              {register.initialized ? register.totalHolders : 'Not recorded'}
            </dd>
          </div>
          <div className="rounded-xl bg-surface-tertiary p-4">
            <dt className="text-xs text-text-muted">Register</dt>
            <dd className="mt-2 text-sm">
              <Status tone={register.initialized ? 'done' : 'waiting'}>
                {register.initialized ? 'Opened' : 'Not opened'}
              </Status>
            </dd>
          </div>
        </dl>
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
          <h3 className="text-sm font-medium text-text-primary">Shareholders</h3>
          {register.holders.length === 0 ? (
            <p className="text-sm text-text-muted">No current members are recorded for this class.</p>
          ) : (
            <table className="w-full table-fixed text-sm">
              <caption className="sr-only">Current ownership in {register.token.name}</caption>
              <thead className="border-b border-border-subtle text-text-muted">
                <tr>
                  <th scope="col" className="w-1/2 py-2 text-left font-normal">
                    Member
                  </th>
                  <th scope="col" className="w-[30%] px-2 py-2 text-right font-normal">
                    Issued shares
                  </th>
                  <th scope="col" className="w-[20%] py-2 text-right font-normal">
                    % of class
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {register.holders.map((holder) => (
                  <tr key={holder.member}>
                    <th scope="row" className="min-w-0 py-3 pr-3 text-left font-normal">
                      <p className="break-words font-medium text-text-primary">
                        {holder.name || HOLDER_TYPE_LABELS[holder.holderType]}
                      </p>
                      <p className="mt-1 text-xs text-text-muted">
                        {HOLDER_TYPE_LABELS[holder.holderType]} · Entered {holder.enteredOn}
                      </p>
                      {holder.holderType === 'ambiguous' && (
                        <p className="mt-1 text-xs text-text-muted">{REGISTER_COPY.AMBIGUOUS_NOTE}</p>
                      )}
                      {holder.holderType === 'unidentified' && (
                        <p className="mt-1 text-xs text-text-muted">{REGISTER_COPY.UNIDENTIFIED_NOTE}</p>
                      )}
                      <details className="mt-1 text-xs text-text-muted">
                        <summary className="cursor-pointer py-1">Optional wallet links</summary>
                        {holder.wallets.length === 0 ? (
                          <p>{REGISTER_COPY.NO_WALLET}</p>
                        ) : (
                          <ul className="flex flex-col gap-1">
                            {holder.wallets.map((wallet) => (
                              <li key={wallet.address} className="break-all">
                                {wallet.address} · {wallet.whitelistStatus}
                              </li>
                            ))}
                          </ul>
                        )}
                      </details>
                      {prepare && (
                        <LinkRow
                          to={DESTINATIONS.companyRegisterParticulars.path.replace(':member', holder.member)}
                          label={REGISTER_PARTICULARS_COPY.PREPARE}
                          context={holder.name || HOLDER_TYPE_LABELS[holder.holderType]}
                        />
                      )}
                    </th>
                    <td className="break-all px-2 py-3 text-right align-top tabular-nums text-text-primary">
                      {formatShareCount(holder.balance)} {holder.balance === '1' ? 'share' : 'shares'}
                    </td>
                    <td className="break-words py-3 text-right align-top tabular-nums text-text-primary">
                      {register.issuedSupply === null ||
                      register.issuedSupply === '0' ||
                      !Number.isFinite(holder.percentage)
                        ? '—'
                        : `${holder.percentage.toFixed(2)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
