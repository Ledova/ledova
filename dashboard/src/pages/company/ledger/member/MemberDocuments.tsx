import { LoadError, Loading, Section, Failure } from '@components/Ledger';
import { Modal } from '@components/Modal';
import { Actions, FormActions, PageAction } from '@components/Page';
import { SearchSelect } from '@components/SearchSelect';
import {
  REGISTER_MEMBER_DOCUMENT_CATEGORIES,
  useMemberDocuments,
  type DocumentHolding,
  type OrderSubmissionOwner,
  type RegisterMemberDocument,
} from '@ledova/shared';
import { BROWSER_FILES } from '@utils/saveFile';
import { DocumentAttachments } from '@pages/company/ledger/shared/DocumentAttachments';
import { useId, useState } from 'react';

export function MemberDocuments(props: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  member: string;
  sourceReady: boolean;
  holdings: DocumentHolding[];
}) {
  return (
    <OwnMemberDocuments
      key={`${props.owner.userUuid}/${props.owner.ownerAccountUuid}/${props.company}/${props.member}`}
      {...props}
    />
  );
}

function OwnMemberDocuments(props: Parameters<typeof MemberDocuments>[0]) {
  const documents = useMemberDocuments({ ...props, files: BROWSER_FILES, newKey: () => crypto.randomUUID() });
  const targetReasonId = useId();
  const editor = documents.editor;
  const [deleting, setDeleting] = useState<RegisterMemberDocument | null>(null);
  return (
    <Section title="Documents">
      {documents.appointments.isError ? (
        <LoadError retry={() => documents.appointments.refetch()} busy={documents.appointments.isFetching}>
          Your company appointments could not be loaded.
        </LoadError>
      ) : !props.sourceReady || !documents.appointments.isSuccess || documents.appointments.isFetching ? (
        <Loading>Loading document access…</Loading>
      ) : !documents.authorised ? (
        <p className="text-sm text-text-muted">Documents are private to current company register appointees.</p>
      ) : documents.query.isError ? (
        <LoadError retry={() => documents.query.refetch()} busy={documents.query.isFetching}>
          Documents could not be loaded.
        </LoadError>
      ) : !documents.ready ? (
        <Loading>Loading documents…</Loading>
      ) : (
        <>
          {documents.query.data?.length ? (
            <ul className="divide-y divide-border-subtle">
              {documents.query.data.map((document) => (
                <li key={document.uuid} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-text-primary">{document.snapshot.name}</p>
                    <p className="mt-1 text-xs text-text-muted">
                      {REGISTER_MEMBER_DOCUMENT_CATEGORIES[document.category]}
                      {props.holdings.find(
                        (holding) => holding.member === document.member && holding.token === document.token,
                      )?.label &&
                        ` · ${props.holdings.find((holding) => holding.member === document.member && holding.token === document.token)!.label}`}
                    </p>
                  </div>
                  <Actions>
                    <PageAction
                      label="Download"
                      context={document.snapshot.name}
                      disabled={documents.busy}
                      onClick={() => void documents.download(document)}
                    />
                    {documents.appointment && (
                      <PageAction
                        destructive
                        label="Delete"
                        context={document.snapshot.name}
                        disabled={documents.busy}
                        onClick={() => setDeleting(document)}
                      />
                    )}
                  </Actions>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-muted">No supporting documents attached.</p>
          )}
          {!editor && documents.appointment && (
            <FormActions>
              <PageAction
                label="Add"
                context="documents"
                onClick={documents.open}
                disabled={documents.busy || !props.holdings.length}
                describedBy={!props.holdings.length ? targetReasonId : undefined}
              />
              {!props.holdings.length && (
                <p id={targetReasonId} className="order-last basis-full text-right text-sm text-text-muted">
                  Record a shareholding before adding documents.
                </p>
              )}
            </FormActions>
          )}
        </>
      )}
      {editor && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void documents.save();
          }}
        >
          <fieldset disabled={documents.busy || documents.held || !documents.ready} className="space-y-4">
            {props.holdings.length > 1 && (
              <SearchSelect
                label="Share class"
                choices={props.holdings.map((holding) => ({
                  value: `${holding.member}/${holding.token}`,
                  label: holding.label,
                }))}
                value={`${editor.member}/${editor.token}`}
                noun={['share class', 'share classes']}
                onChange={(value) => {
                  if (editor.documents.some((row) => row.file || row.evidence)) return;
                  const holding = props.holdings.find((row) => `${row.member}/${row.token}` === value);
                  if (holding) documents.setEditor({ ...editor, member: holding.member, token: holding.token });
                }}
                disabled={editor.documents.some((row) => row.file || row.evidence)}
              />
            )}
            <DocumentAttachments
              heading={false}
              documents={editor.documents}
              update={(drafts) => documents.setEditor({ ...editor, documents: drafts })}
            />
          </fieldset>
          {documents.held && (
            <p className="text-sm text-text-muted">
              Keep these details and recover the original save before changing documents.
            </p>
          )}
          <FormActions>
            <PageAction label="Cancel" disabled={documents.busy || documents.held} onClick={documents.close} />
            <PageAction
              type="submit"
              label={documents.held ? 'Recover original save' : 'Save'}
              context="documents"
              primary
              busy={documents.busy}
              busyLabel="Saving…"
              disabled={!documents.ready}
            />
          </FormActions>
        </form>
      )}
      <Failure>{documents.error}</Failure>
      <Modal
        isOpen={!!deleting}
        onClose={() => {
          if (!documents.busy) setDeleting(null);
        }}
        title="Delete this document?"
        showFooter
        confirmLabel="Delete"
        destructive
        busy={documents.busy}
        busyLabel="Deleting…"
        onConfirm={() => {
          if (deleting) void documents.remove(deleting).finally(() => setDeleting(null));
        }}
      >
        <p className="break-words text-sm text-text-primary">
          {deleting?.snapshot.name} is removed for everyone. This can’t be undone.
        </p>
      </Modal>
    </Section>
  );
}
