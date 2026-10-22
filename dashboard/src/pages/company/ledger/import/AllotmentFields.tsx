import { useLayoutEffect, useRef, useState } from 'react';
import { FIELD_LIMITS, formatDate, formatShareCount, registerImportMoney, wholeShares } from '@ledova/shared';
import { Field, TextInput } from '@components/Field';
import { ErrorSummary } from '@components/ErrorSummary';
import { PageAction } from '@components/Page';
import { allotmentProblems, blankAllotment, type AllotmentDraft } from './preparation';

export function AllotmentFields({
  allotments,
  asAt,
  shareholder,
  validationAttempt,
  update,
}: {
  allotments: AllotmentDraft[];
  asAt: string;
  shareholder: number;
  validationAttempt: number;
  update: (allotments: AllotmentDraft[]) => void;
}) {
  const [editor, setEditor] = useState({
    selected: allotments[0]?.id,
    validationAttempt,
    check: { id: '', attempt: 0 },
  });
  const { selected, check } = editor;
  const focus = useRef(false);
  const dates = useRef(new Map<string, HTMLInputElement>());
  const active = allotments.some((row) => row.id === selected) ? selected : allotments[0]?.id;
  const money = (value: string) => {
    const amount = registerImportMoney(value.trim() || '0');
    return amount === null ? '—' : formatShareCount(amount);
  };
  if (editor.validationAttempt !== validationAttempt) {
    const invalid = allotments.find((row) => allotmentProblems(row, asAt).length > 0);
    setEditor({
      selected: invalid?.id ?? selected,
      validationAttempt,
      check: { id: invalid?.id ?? '', attempt: 0 },
    });
  }
  useLayoutEffect(() => {
    if (focus.current && active) {
      focus.current = false;
      dates.current.get(active)?.focus();
    }
  }, [active]);
  const edit = (id: string) => {
    focus.current = true;
    setEditor((current) => ({ ...current, selected: id, check: { id: '', attempt: 0 } }));
  };
  const remove = (id: string) => {
    const remaining = allotments.filter((row) => row.id !== id);
    if (active === id && remaining[0]) edit(remaining[0].id);
    update(remaining);
  };
  const add = () => {
    const current = allotments.find((row) => row.id === active);
    if (current && allotmentProblems(current, asAt).length > 0) {
      setEditor((prior) => ({ ...prior, check: { id: current.id, attempt: prior.check.attempt + 1 } }));
      return;
    }
    const unfinished = allotments.find((row) => allotmentProblems(row, asAt).length > 0);
    if (unfinished) edit(unfinished.id);
    else {
      const next = blankAllotment();
      update([...allotments, next]);
      edit(next.id);
    }
  };
  return (
    <section aria-label="Allocation history" className="space-y-3 border-t border-border-subtle pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="text-sm font-medium text-text-primary">Allocation history</h4>
        <PageAction label="Add allocation" context={`shareholder ${shareholder}`} onClick={add} />
      </div>
      {allotments.length > 0 && (
        <div className="divide-y divide-border-subtle">
          {allotments.map((allotment, at) => {
            const shown = active === allotment.id;
            const problems = allotmentProblems(allotment, asAt);
            const set = (patch: Partial<AllotmentDraft>) =>
              update(allotments.map((row) => (row.id === allotment.id ? { ...row, ...patch } : row)));
            return (
              <fieldset key={allotment.id} className="min-w-0 py-3 first:pt-0">
                <legend className="sr-only">Allocation {at + 1}</legend>
                {!shown && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 text-sm text-text-primary">
                      <p className="font-medium">
                        {formatDate(allotment.allottedOn, 'Date not entered')} ·{' '}
                        {wholeShares(allotment.shares.trim()) === null
                          ? 'Shares not entered'
                          : `${formatShareCount(allotment.shares.trim())} ${wholeShares(allotment.shares.trim()) === 1n ? 'share' : 'shares'}`}
                      </p>
                      <p className="mt-1 text-xs text-text-muted">
                        Paid {money(allotment.amountPaid)} · Unpaid {money(allotment.amountUnpaid)}
                      </p>
                      {problems.length > 0 && <p className="mt-1 text-xs text-error-light">Needs details</p>}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <PageAction label="Edit" context={`allocation ${at + 1}`} onClick={() => edit(allotment.id)} />
                      <PageAction
                        label="Remove"
                        context={`allocation ${at + 1}`}
                        onClick={() => remove(allotment.id)}
                      />
                    </div>
                  </div>
                )}
                <div hidden={!shown} className="space-y-3">
                  <ErrorSummary
                    attempt={check.id === allotment.id ? check.attempt : 0}
                    problems={check.id === allotment.id ? problems.map((message) => ({ message })) : []}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Date">
                      <TextInput
                        ref={(element) => {
                          if (element) dates.current.set(allotment.id, element);
                          else dates.current.delete(allotment.id);
                        }}
                        type="date"
                        max={asAt}
                        value={allotment.allottedOn}
                        onChange={(event) => set({ allottedOn: event.target.value })}
                      />
                    </Field>
                    <Field label="Shares">
                      <TextInput
                        maxLength={FIELD_LIMITS.REGISTER_SHARES}
                        inputMode="numeric"
                        value={allotment.shares}
                        onChange={(event) => set({ shares: event.target.value })}
                      />
                    </Field>
                    <Field label="Amount paid">
                      <TextInput
                        maxLength={FIELD_LIMITS.AMOUNT}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={allotment.amountPaid}
                        onChange={(event) => set({ amountPaid: event.target.value })}
                        onBlur={() => {
                          if (!allotment.amountPaid.trim()) set({ amountPaid: '0.00' });
                        }}
                      />
                    </Field>
                    <Field label="Amount unpaid">
                      <TextInput
                        maxLength={FIELD_LIMITS.AMOUNT}
                        inputMode="decimal"
                        placeholder="0.00"
                        value={allotment.amountUnpaid}
                        onChange={(event) =>
                          set({
                            amountUnpaid: event.target.value,
                            fullyPaid: registerImportMoney(event.target.value.trim() || '0') === '0.00',
                          })
                        }
                        onBlur={() => {
                          if (!allotment.amountUnpaid.trim()) set({ amountUnpaid: '0.00', fullyPaid: true });
                        }}
                      />
                    </Field>
                  </div>
                  <div className="flex justify-end">
                    <PageAction label="Remove" context={`allocation ${at + 1}`} onClick={() => remove(allotment.id)} />
                  </div>
                </div>
              </fieldset>
            );
          })}
        </div>
      )}
    </section>
  );
}
