import { formatShareCount, HOLDER_TYPE_LABELS, REGISTER_COPY, type TokenHoldersResponse } from '@ledova/shared';
import { Rows, Row, Status } from '@components/Ledger';

export function ClassRegister({ register }: { register: TokenHoldersResponse }) {
  return (
    <div className="flex flex-col gap-4">
      <Rows>
        <Row label="Issued shares">
          <span className="break-all">
            {register.issuedSupply === null ? 'Not recorded' : formatShareCount(register.issuedSupply)}
          </span>
        </Row>
        <Row label="Authorised shares">
          <span className="break-all">{formatShareCount(register.token.totalSupply)}</span>
        </Row>
        <Row label="Register">
          <Status tone={register.initialized ? 'done' : 'waiting'}>
            {register.initialized ? 'Opened' : 'Not opened'}
          </Status>
        </Row>
      </Rows>
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
          <h3 className="text-sm font-medium text-text-primary">Current members · {register.totalHolders}</h3>
          {register.holders.length === 0 ? (
            <p className="text-sm text-text-muted">No current members are recorded for this class.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {register.holders.map((holder) => (
                <li key={holder.member} className="flex flex-col gap-2 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="min-w-0 break-words text-base text-text-primary">
                      {holder.name || HOLDER_TYPE_LABELS[holder.holderType]}
                    </span>
                    <span className="ml-auto break-all text-right text-sm tabular-nums text-text-primary">
                      {formatShareCount(holder.balance)} {holder.balance === '1' ? 'share' : 'shares'}
                    </span>
                  </div>
                  <p className="text-xs text-text-muted">
                    {HOLDER_TYPE_LABELS[holder.holderType]} · Entered {holder.enteredOn}
                  </p>
                  {holder.holderType === 'ambiguous' && (
                    <p className="text-sm text-text-muted">{REGISTER_COPY.AMBIGUOUS_NOTE}</p>
                  )}
                  {holder.holderType === 'unidentified' && (
                    <p className="text-sm text-text-muted">{REGISTER_COPY.UNIDENTIFIED_NOTE}</p>
                  )}
                  {holder.wallets.length === 0 ? (
                    <p className="text-xs text-text-muted">{REGISTER_COPY.NO_WALLET}</p>
                  ) : (
                    <ul className="flex flex-col gap-1 text-xs text-text-muted">
                      {holder.wallets.map((wallet) => (
                        <li key={wallet.address} className="break-all">
                          {wallet.address} · {wallet.whitelistStatus}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
