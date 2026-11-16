import { useId, useState } from 'react';
import { generatePath } from 'react-router-dom';
import {
  DESTINATIONS,
  classFacts,
  formatShareCount,
  type CompanyShareTokenListItem,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { CheckboxField } from '@components/Field';
import { Failure, LinkRow, Outcome, Section } from '@components/Ledger';
import { Actions, PageAction, PageLink } from '@components/Page';
import { Modal, ModalActions } from '@components/Modal';
import { useClassDeletion } from './useClassDeletion';

export function ShareClasses({
  owner,
  company,
  classes,
  registers,
  guard,
  available,
  ready,
  visible,
  blocked,
  canAdd,
  onHeldChange,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  classes: CompanyShareTokenListItem[];
  registers: TokenHoldersResponse[];
  guard: () => void;
  available: boolean;
  ready: boolean;
  visible: boolean;
  blocked: boolean;
  canAdd: boolean;
  onHeldChange: (held: boolean) => void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const reasonId = useId();
  const listed = classes.filter((row) => row.companyUuid === company);
  const hasControls = listed.some((row) => row.canDelete || row.deletionBlockedReason);
  const selectedCount = listed.filter(({ uuid }) => selected.has(uuid)).length;
  const deletableCount = listed.filter((row) => row.canDelete && selected.has(row.uuid)).length;
  const deletion = useClassDeletion({ owner, company, classes, guard, available: available && visible, onHeldChange });
  const operation = deletion.removal;
  const locked = blocked || !!operation || !available || !ready;
  const close = async () => {
    if (await deletion.close()) setSelected(new Set());
  };
  return (
    <div hidden={!visible || !available} className="space-y-4">
      <div hidden={!ready} className="space-y-4">
        <Section title="Share classes">
          {hasControls && (
            <CheckboxField
              ref={(input) => {
                if (input) input.indeterminate = selectedCount > 0 && selectedCount < listed.length;
              }}
              label="Select all"
              checked={listed.length > 0 && selectedCount === listed.length}
              disabled={locked || listed.length === 0}
              onChange={(event) => setSelected(new Set(event.target.checked ? listed.map(({ uuid }) => uuid) : []))}
            />
          )}
          {registers.length === 0 ? (
            <p className="text-sm text-text-muted">No share classes yet.</p>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {registers.map((register) => {
                const lifecycle = classes.find(({ uuid }) => uuid === register.token.uuid);
                const description = `${reasonId}-${register.token.uuid}`;
                return (
                  <li key={register.token.uuid} className="flex items-start gap-3">
                    {hasControls && (
                      <div className="shrink-0 py-3">
                        <CheckboxField
                          label={<span className="sr-only">Select {register.token.name}</span>}
                          checked={selected.has(register.token.uuid)}
                          disabled={locked}
                          aria-describedby={lifecycle?.deletionBlockedReason ? description : undefined}
                          onChange={(event) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(register.token.uuid);
                              else next.delete(register.token.uuid);
                              return next;
                            })
                          }
                        />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <LinkRow
                        to={`${generatePath(DESTINATIONS.companyClass.path, { uuid: register.token.uuid })}?company=${company}`}
                        label={register.token.name}
                        context="class details"
                        figure={
                          <span className="shrink-0 font-medium tabular-nums text-text-primary">
                            {register.issuedSupply === null ? (
                              <>
                                <span className="sr-only">Issued shares </span>Not recorded
                              </>
                            ) : (
                              <>
                                {formatShareCount(register.issuedSupply)}
                                <span className="sr-only"> issued shares</span>
                              </>
                            )}
                          </span>
                        }
                        disabled={locked}
                      >
                        <span className="block break-words text-xs text-text-muted">{classFacts(register)}</span>
                        {lifecycle?.deletionBlockedReason && (
                          <span id={description} className="block break-words text-xs text-text-muted">
                            {lifecycle.deletionBlockedReason}
                          </span>
                        )}
                      </LinkRow>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
        <Actions>
          {hasControls && (
            <PageAction
              label="Delete selected"
              destructive
              disabled={locked || deletableCount === 0}
              onClick={() => deletion.open(selected)}
            />
          )}
          {canAdd && (
            <PageLink
              primary
              to={`${DESTINATIONS.companyRegisterSetup.path}?company=${company}`}
              label="Add share class"
            />
          )}
        </Actions>
      </div>
      <Outcome>{deletion.outcome}</Outcome>
      {!operation && <Failure>{deletion.error}</Failure>}
      {operation && (
        <Modal
          isOpen={!!operation && available && visible}
          onClose={() => {
            void close();
          }}
          title={`Delete ${operation.targets.length} ${operation.targets.length === 1 ? 'share class' : 'share classes'}?`}
          busy={deletion.busy}
        >
          <div className="space-y-4">
            <p className="text-sm text-text-muted">
              Unused classes are removed from active use. Their drafts and audit history are retained. Each class is
              checked separately; deletion stops if a result cannot be confirmed.
            </p>
            <ul className="space-y-2 text-sm text-text-primary">
              {operation.targets.map((target, index) => (
                <li key={target.uuid} className="break-words">
                  {target.name} · {target.symbol}
                  {index < operation.next ? ' — deleted' : ''}
                </li>
              ))}
            </ul>
            {operation.kept.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-text-primary">Will be kept</h3>
                <ul className="space-y-2 text-sm text-text-primary">
                  {operation.kept.map((target) => (
                    <li key={target.uuid} className="break-words">
                      {target.name} · {target.symbol}
                      <p className="text-xs text-text-muted">
                        {target.deletionBlockedReason ?? 'This class cannot be deleted.'}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(operation.finished || operation.pending) && (
              <p role="status" className="text-sm text-text-muted">
                {operation.next} deleted · {operation.targets.length - operation.next} not confirmed
              </p>
            )}
            <Failure>{deletion.error}</Failure>
            <ModalActions>
              <PageAction
                label={operation.finished ? 'Close' : 'Cancel'}
                disabled={deletion.busy || operation.pending}
                onClick={() => {
                  void close();
                }}
              />
              {!operation.finished && (
                <PageAction
                  label={
                    operation.pending
                      ? operation.retry
                        ? 'Retry original deletion'
                        : 'Check original deletion'
                      : 'Delete selected'
                  }
                  destructive
                  busy={deletion.busy}
                  busyLabel={operation.pending ? 'Checking…' : 'Deleting…'}
                  disabled={!available}
                  onClick={() => {
                    void (operation.pending ? deletion.recover() : deletion.execute());
                  }}
                />
              )}
            </ModalActions>
          </div>
        </Modal>
      )}
    </div>
  );
}
