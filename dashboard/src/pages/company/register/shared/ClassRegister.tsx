import { useState } from 'react';
import { REGISTER_COPY, TECHNICAL_SHARE_LIMIT, formatShareCount, type TokenHoldersResponse } from '@ledova/shared';
import { LoadMore } from '@components/List';
import { PAGE_SIZE } from '@hooks/useListParams';
import { Rows, Row, Section, Status, type Tone } from '@components/Ledger';
import { PageAction, PageLink } from '@components/Page';
import { shareholderPath } from './shareholders';

const REGISTER_INITIALIZATION_TONES = new Map<boolean, Tone>([
  [true, 'done'],
  [false, 'waiting'],
]);

export function ClassRegister({ register, former = true }: { register: TokenHoldersResponse; former?: boolean }) {
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
          <Status tone={REGISTER_INITIALIZATION_TONES.get(!!register.initialized)!}>
            {register.initialized ? 'Register opened' : 'Register not opened'}
          </Status>
        </p>
      </section>
      {register.token.totalSupply !== TECHNICAL_SHARE_LIMIT ? (
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
          {former && <FormerMembers register={register} />}
        </>
      )}
    </div>
  );
}

export function FormerMembers({
  register,
  company,
  blocked = false,
}: {
  register: TokenHoldersResponse;
  company?: string;
  blocked?: boolean;
}) {
  const [shown, setShown] = useState(PAGE_SIZE);
  if (!register.formerMembers?.length) return null;
  return (
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
        {register.formerMembers.slice(0, shown).map((former) => (
          <li key={former.uuid} className="flex flex-col gap-2 py-4">
            <p className="text-base text-text-primary">{former.name || 'Name not recorded'}</p>
            {company && former.member && blocked && (
              <PageAction
                label="Details"
                context={former.name || 'Name not recorded'}
                disabled
                onClick={() => undefined}
              />
            )}
            {company && former.member && !blocked && (
              <PageLink
                to={shareholderPath(former.member, company)}
                label="Details"
                context={former.name || 'Name not recorded'}
              />
            )}
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
              {former.ceasedAtBlock !== null && <Row label="Recorded cessation block">{former.ceasedAtBlock}</Row>}
            </Rows>
          </li>
        ))}
      </ul>
      <LoadMore
        noun={['former shareholder', 'former shareholders']}
        hasMore={register.formerMembers.length > shown}
        failed={false}
        loading={false}
        onLoad={() => setShown(shown + PAGE_SIZE)}
      />
    </details>
  );
}

export function FormerShareholders({
  registers,
  company,
  blocked = false,
}: {
  registers: TokenHoldersResponse[];
  company: string;
  blocked?: boolean;
}) {
  const classes = registers.filter((register) => register.initialized && register.formerMembers?.length);
  if (!classes.length) return null;
  return (
    <Section title="Former shareholders">
      {classes.map((register) => (
        <div key={register.token.uuid} className="space-y-2">
          <h3 className="break-words text-base font-medium text-text-primary">
            {register.token.name} · {register.token.symbol}
          </h3>
          <FormerMembers register={register} company={company} blocked={blocked} />
        </div>
      ))}
    </Section>
  );
}
