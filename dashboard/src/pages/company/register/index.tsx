import { CaretRightIcon } from '@phosphor-icons/react';
import { formatShareCount, HOLDER_TYPE_LABELS, REGISTER_COPY, type TokenHoldersResponse } from '@ledova/shared';
import { Section, Rows, Row, Status } from '@components/Ledger';
import { Page, PageAction } from '@components/Page';
import { useCompanyRegister } from './useCompanyRegister';

function ClassRegister({ register }: { register: TokenHoldersResponse }) {
  return (
    <div className="flex flex-col gap-4 pb-6">
      <Rows>
        <Row label="Issued shares">
          {register.issuedSupply === null ? 'Not recorded' : formatShareCount(register.issuedSupply)}
        </Row>
        <Row label="Authorised shares">{formatShareCount(register.token.totalSupply)}</Row>
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

export default function CompanyRegisterPage() {
  const { data: classes = [], isPending, isError, isFetching, refetch } = useCompanyRegister();

  return (
    <Page>
      <p className="text-sm text-text-muted">
        The stored register records your company&apos;s members and their shares. Wallet balances do not replace it.
      </p>
      <Section title="Share classes">
        {isPending ? (
          <p role="status" className="py-6 text-sm text-text-muted">
            Loading your register…
          </p>
        ) : isError ? (
          <div role="alert" className="flex flex-col items-start gap-3 py-6">
            <p className="text-sm text-text-muted">We couldn&apos;t load the complete register.</p>
            <PageAction label="Try again" onClick={() => void refetch()} disabled={isFetching} />
          </div>
        ) : classes.length === 0 ? (
          <p className="py-6 text-sm text-text-muted">Your company has no share classes yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {classes.map(({ companyName, register }) => (
              <li key={register.token.uuid}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-2 py-4 marker:hidden">
                    <CaretRightIcon aria-hidden="true" className="shrink-0 text-text-muted group-open:rotate-90" />
                    <span className="min-w-0 flex-1 basis-40 break-words">
                      <span className="block text-sm text-text-muted">{companyName}</span>
                      <span className="block text-base text-text-primary">{register.token.name}</span>
                    </span>
                    <span className="ml-auto text-sm text-text-muted">{register.token.symbol}</span>
                  </summary>
                  <ClassRegister register={register} />
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Register instructions">
        <p className="text-sm text-text-muted">
          The company owner submits written register instructions. Staff verify and apply them. Certificates, inspection
          copies, publications and the company pack are prepared by staff on written instruction.
        </p>
      </Section>
    </Page>
  );
}
