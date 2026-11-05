import { useState } from 'react';
import {
  REGISTER_COPY,
  REGISTER_CORRECTION_COPY,
  type RegisterEntryKind,
  formatShareCount,
  type TokenHoldersResponse,
  formatDate,
  PAGE_SIZE,
} from '@ledova/shared';
import { LoadMore } from '@components/List';
import { Rows, Row, Section, ShowMore } from '@components/Ledger';
import { PageLink } from '@components/Page';
import { shareholderPath } from './shareholders';

function FormerMembers({
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
    <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
      <ShowMore
        show={`Show ${REGISTER_COPY.FORMER_TITLE.toLowerCase()} (${register.formerMembers.length})`}
        hide={`Hide ${REGISTER_COPY.FORMER_TITLE.toLowerCase()}`}
      >
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
              {company && former.member && (
                <PageLink
                  to={shareholderPath(former.member, company)}
                  label="Details"
                  context={former.name || 'Name not recorded'}
                  disabled={blocked}
                />
              )}
              <Rows>
                <Row label="Shares at cessation">{formatShareCount(former.sharesAtCessation)}</Row>
                <Row label="Ceased on">{formatDate(former.ceasedOn)}</Row>
                <Row label="Identity source">{former.identitySourceDisplay}</Row>
                {former.sourceEntrySequence !== null && <Row label="Cessation entry">{former.sourceEntrySequence}</Row>}
                {former.sourceEntryKind && (
                  <Row label="Cessation entry kind">
                    {REGISTER_CORRECTION_COPY.ENTRY_KINDS[former.sourceEntryKind as RegisterEntryKind]}
                  </Row>
                )}
                {former.sourceEffectiveOn && (
                  <Row label="Source effective date">{formatDate(former.sourceEffectiveOn)}</Row>
                )}
                {former.correctedBy && <Row label="Correction">Cessation corrected by a later entry</Row>}
                {former.returnedOn && <Row label="Returned on">{formatDate(former.returnedOn)}</Row>}
                {former.walletAddress && <Row label="Recorded wallet">{former.walletAddress}</Row>}
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
      </ShowMore>
    </div>
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
