import { formatDate, formatShareCount, type OwnMemberRecord } from '@ledova/shared';
import { Disclosure, Section } from '@components/Ledger';
import { AwardStatus } from '@components/AwardStatus';

function vestingLabel(award: OwnMemberRecord['awards'][number], uuid: string) {
  const vesting = award.vestings.find((item) => item.uuid === uuid);
  return vesting
    ? `from ${formatShareCount(vesting.shares)} vested ${formatDate(vesting.vestedOn)}`
    : 'from an earlier vesting';
}

export function MemberAwards({ record, token }: { record: OwnMemberRecord; token: string | null }) {
  const awards = record.awards.filter((award) => !token || award.token === token);
  if (!awards.length) return null;
  return (
    <Section title="Your employee awards">
      <div className="divide-y divide-border-subtle">
        {awards.map((award) => (
          <div key={award.uuid} className="space-y-3 py-3">
            <h3 className="text-sm font-medium">
              {record.classes.find(({ uuid }) => uuid === award.token)?.name ?? 'Employee award'} ·{' '}
              {formatDate(award.termsOn)}
            </h3>
            <AwardStatus {...award} compact />
            <Disclosure summary="Award details">
              <div className="space-y-2 text-sm text-text-muted">
                <p>{award.terms}</p>
                <p>{award.schedule}</p>
                <p>Dates do not vest an award automatically.</p>
                {award.vestings.map((vesting) => (
                  <p key={vesting.uuid}>
                    {formatDate(vesting.vestedOn)} · {formatShareCount(vesting.shares)} recorded vested
                  </p>
                ))}
                {award.ends.map((event) => (
                  <p key={event.uuid}>
                    {formatDate(event.companyEventOn)} · {formatShareCount(event.unvestedShares)} unvested and{' '}
                    {formatShareCount(event.vestedShares)} vested unissued rights ended · {event.reason}
                  </p>
                ))}
                {award.vestingReversals.map((event) => (
                  <p key={event.uuid}>
                    {formatDate(event.companyEventOn)} · {formatShareCount(event.reversedShares)} vesting reversed ·{' '}
                    {vestingLabel(award, event.vesting)} · {event.reason}
                  </p>
                ))}
              </div>
            </Disclosure>
          </div>
        ))}
      </div>
    </Section>
  );
}
