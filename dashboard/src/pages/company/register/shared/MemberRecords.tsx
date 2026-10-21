import { useState } from 'react';
import {
  formatDate,
  formatShareCount,
  registerImportTotals,
  sharePercentage,
  type RegisterImportMemberRow,
} from '@ledova/shared';
import { Table } from '@components/List';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
import { Row, Rows } from '@components/Ledger';

export function MemberRecords({ members }: { members: RegisterImportMemberRow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = members.find((member) => member.member === selectedId);
  const total = registerImportTotals(members).total;
  return (
    <>
      <Table
        caption="Shareholders"
        columns={[
          { label: 'Shareholder' },
          { label: 'Shares held', align: 'right' },
          { label: '% of class', align: 'right' },
          { label: 'Date added' },
          { label: 'Allotments', hidden: true },
        ]}
      >
        {members.map((member) => {
          return (
            <tr key={member.member}>
              <th scope="row" className="px-4 py-4 text-left font-normal">
                <p className="font-medium text-text-primary">{member.name}</p>
                <p className="mt-1 max-w-64 truncate text-xs text-text-muted">{member.residentialAddress}</p>
              </th>
              <td className="px-4 py-4 text-right font-medium tabular-nums">{formatShareCount(member.shares)}</td>
              <td className="whitespace-nowrap px-4 py-4 text-right tabular-nums text-text-muted">
                {/^\d+$/.test(member.shares) ? sharePercentage(member.shares, total) : 'Not recorded'}
              </td>
              <td className="whitespace-nowrap px-4 py-4 text-text-muted">{formatDate(member.enteredOn, '—')}</td>
              <td className="px-4 py-4">
                <PageAction label="Allotments" context={member.name} onClick={() => setSelectedId(member.member)} />
              </td>
            </tr>
          );
        })}
      </Table>
      <Modal
        isOpen={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected?.name ?? 'Shareholder details'}
        size="2xl"
        showFooter
        cancelLabel="Close"
      >
        {selected && (
          <div className="space-y-6">
            <Rows>
              {[
                ['Address', selected.residentialAddress],
                ['Date first added to register', formatDate(selected.enteredOn, '—')],
                ['Shares held', formatShareCount(selected.shares)],
              ].map(([label, value]) => (
                <Row key={label} label={label}>
                  {value}
                </Row>
              ))}
            </Rows>
            {selected.allotments ? (
              <div className="space-y-4">
                {selected.allotments.map((allotment, index) => (
                  <section key={index} className="space-y-3 border-t border-border-subtle pt-4">
                    <h3 className="text-sm font-medium text-text-primary">Allotment {index + 1}</h3>
                    <Rows>
                      {[
                        ['Allotment date', formatDate(allotment.allottedOn, '—')],
                        ['Shares in allotment', formatShareCount(allotment.shares)],
                        ['Amount paid', allotment.amountPaid],
                        ['Amount unpaid', allotment.amountUnpaid],
                        ['Payment status', allotment.fullyPaid ? 'Fully paid' : 'Not fully paid'],
                        ['Held for someone else?', allotment.beneficiallyHeld ? 'No' : 'Yes'],
                        ...(allotment.shareReference ? [['Share reference', allotment.shareReference]] : []),
                        ...(allotment.certificateReference
                          ? [['Certificate reference', allotment.certificateReference]]
                          : []),
                      ].map(([label, value]) => (
                        <Row key={label} label={label}>
                          {value}
                        </Row>
                      ))}
                    </Rows>
                  </section>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted">
                Allotment particulars were not captured in this earlier snapshot.
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
