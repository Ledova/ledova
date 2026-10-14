import { formatShareCount, type RegisterImportMemberRow } from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';

export function MemberRecords({ members }: { members: RegisterImportMemberRow[] }) {
  return (
    <ul className="space-y-3">
      {members.map((member) => (
        <li key={member.member} className="rounded-lg border border-border-subtle p-4">
          <h3 className="mb-2 text-sm font-medium text-text-primary">{member.name}</h3>
          <Rows>
            <Row label="Address">{member.residentialAddress}</Row>
            <Row label="Date first added to register">{member.enteredOn}</Row>
            <Row label="Shares held">{formatShareCount(member.shares)} shares</Row>
          </Rows>
          {member.allotments ? (
            <ul className="mt-3 divide-y divide-border-subtle">
              {member.allotments.map((allotment, index) => (
                <li key={index} className="py-3">
                  <p className="mb-2 text-sm font-medium text-text-primary">Allotment {index + 1}</p>
                  <Rows>
                    <Row label="Allotment date">{allotment.allottedOn}</Row>
                    <Row label="Shares in allotment">{formatShareCount(allotment.shares)}</Row>
                    <Row label="Amount paid">{allotment.amountPaid}</Row>
                    <Row label="Amount unpaid">{allotment.amountUnpaid}</Row>
                    <Row label="Payment status">{allotment.fullyPaid ? 'Fully paid' : 'Not fully paid'}</Row>
                    <Row label="Held for someone else?">{allotment.beneficiallyHeld ? 'No' : 'Yes'}</Row>
                    {allotment.shareReference && <Row label="Share reference">{allotment.shareReference}</Row>}
                    {allotment.certificateReference && (
                      <Row label="Certificate reference">{allotment.certificateReference}</Row>
                    )}
                  </Rows>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-text-muted">
              Allotment particulars were not captured in this earlier snapshot.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
