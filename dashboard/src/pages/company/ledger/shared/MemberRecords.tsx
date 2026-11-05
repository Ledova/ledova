import { useState, type ReactNode } from 'react';
import {
  REGISTER_MEMBER_DOCUMENT_CATEGORIES,
  formatDate,
  formatShareCount,
  memberRecordFacts,
  registerImportTotals,
  shareCount,
  type RegisterImportMemberRow,
} from '@ledova/shared';
import { Modal } from '@components/Modal';
import { PageAction } from '@components/Page';
import { Row, Rows } from '@components/Ledger';

export function MemberRow({
  name,
  shares,
  address,
  facts,
  children,
}: {
  name: string;
  shares: string;
  address?: string;
  facts: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-1 py-3 text-sm">
      <p className="flex items-baseline justify-between gap-3 font-medium text-text-primary">
        <span className="min-w-0 break-words">{name}</span>
        <span className="shrink-0 whitespace-nowrap tabular-nums">{shares}</span>
      </p>
      {address && <p className="break-words text-xs text-text-muted">{address}</p>}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 break-words text-xs tabular-nums text-text-muted">{facts}</p>
        {children && <span className="ml-auto flex gap-4">{children}</span>}
      </div>
    </li>
  );
}

export function MemberRecords({ members }: { members: RegisterImportMemberRow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = members.find((member) => member.member === selectedId);
  const total = registerImportTotals(members).total;
  return (
    <>
      <ul aria-label="Shareholders" className="divide-y divide-border-subtle">
        {members.map((member) => (
          <MemberRow
            key={member.member}
            name={member.name}
            shares={shareCount(member.shares)}
            address={member.residentialAddress}
            facts={memberRecordFacts(member, total)}
          >
            <PageAction compact label="Allotments" context={member.name} onClick={() => setSelectedId(member.member)} />
          </MemberRow>
        ))}
      </ul>
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
                <Row key={label} label={label} inline>
                  {value}
                </Row>
              ))}
            </Rows>
            {selected.allotments?.length ? (
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
                        [
                          'Held for someone else?',
                          allotment.beneficiallyHeld === null
                            ? 'Not recorded'
                            : allotment.beneficiallyHeld
                              ? 'No'
                              : 'Yes',
                        ],
                        ...(allotment.shareReference ? [['Share reference', allotment.shareReference]] : []),
                        ...(allotment.certificateReference
                          ? [['Certificate reference', allotment.certificateReference]]
                          : []),
                      ].map(([label, value]) => (
                        <Row key={label} label={label} inline>
                          {value}
                        </Row>
                      ))}
                    </Rows>
                  </section>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted">
                {selected.allotments
                  ? 'No allotment history recorded.'
                  : 'Allotment particulars were not captured in this earlier snapshot.'}
              </p>
            )}
            {!!selected.documents?.length && (
              <section className="space-y-3 border-t border-border-subtle pt-4">
                <h3 className="text-sm font-medium text-text-primary">Documents</h3>
                <ul className="space-y-2 text-sm text-text-primary">
                  {selected.documents.map((document) => (
                    <li key={document.evidence}>
                      {document.snapshot?.name || 'Retained supporting document'}
                      <p className="mt-1 text-xs text-text-muted">
                        {REGISTER_MEMBER_DOCUMENT_CATEGORIES[document.category]}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
