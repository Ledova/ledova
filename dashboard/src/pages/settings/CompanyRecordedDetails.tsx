import { Row, Rows, Section } from '@components/Ledger';
import { MemberRecordsContent } from '@components/member-records/MemberRecordsContent';
import { useMemberWorkspace } from '@components/member-records/useMemberWorkspace';
import { useCompanyContext } from '@hooks/useCompanyContext';

export function CompanyRecordedDetails() {
  const { read } = useMemberWorkspace();
  const company = useCompanyContext()?.company?.name ?? 'the company';
  return (
    <Section title={`How ${company} records you`}>
      <MemberRecordsContent>
        {read.record && (
          <>
            <Rows>
              <Row label="Name">{read.record.name}</Row>
              <Row label="Residential address">
                <span className="whitespace-pre-line break-words">{read.record.residentialAddress}</span>
              </Row>
            </Rows>
            <p className="text-sm text-text-muted">Wrong? Contact the company.</p>
          </>
        )}
      </MemberRecordsContent>
    </Section>
  );
}
