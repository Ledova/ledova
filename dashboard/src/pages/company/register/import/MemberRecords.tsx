import { formatShareCount, type RegisterImportMemberRow } from '@ledova/shared';
import { Row, Rows } from '@components/Ledger';

export function MemberRecords({ members }: { members: RegisterImportMemberRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Shareholders</caption>
        <thead className="text-text-muted">
          <tr>
            <th scope="col" className="py-2 pr-4 font-medium">
              Shareholder
            </th>
            <th scope="col" className="py-2 pr-4 text-right font-medium">
              Shares held
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Date first added to register
            </th>
            <th scope="col" className="py-2 font-medium">
              Details
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {members.map((member) => (
            <tr key={member.member} className="align-top">
              <th scope="row" className="py-3 pr-4 font-normal">
                <p className="font-medium text-text-primary">{member.name}</p>
                <p className="mt-1 text-xs text-text-muted">{member.residentialAddress}</p>
              </th>
              <td className="py-3 pr-4 text-right tabular-nums">{formatShareCount(member.shares)}</td>
              <td className="whitespace-nowrap py-3 pr-4">{member.enteredOn}</td>
              <td className="py-3">
                <details>
                  <summary className="cursor-pointer text-text-muted">Details</summary>
                  {member.allotments ? (
                    <ul className="min-w-64 divide-y divide-border-subtle">
                      {member.allotments.map((allotment, index) => (
                        <li key={index} className="py-3">
                          <p className="mb-2 font-medium text-text-primary">Allotment {index + 1}</p>
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
                    <p className="mt-3 text-xs text-text-muted">
                      Allotment particulars were not captured in this earlier snapshot.
                    </p>
                  )}
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
