import { LoadError, Loading, Section } from '@components/Ledger';
import { FormActions, PageAction } from '@components/Page';
import { SearchSelect } from '@components/SearchSelect';
import { REGISTER_MEMBER_DOCUMENT_CATEGORIES, type OrderSubmissionOwner } from '@ledova/shared';
import { DocumentAttachments } from './DocumentAttachments';
import { useMemberDocuments, type DocumentHolding } from './useMemberDocuments';

export function MemberDocuments(props: {
  owner: OrderSubmissionOwner;
  guard: () => void;
  company: string;
  member?: string;
  token?: string;
  sourceReady: boolean;
  holdings: DocumentHolding[];
  title?: string;
}) {
  return (
    <OwnMemberDocuments
      key={`${props.owner.userUuid}/${props.owner.ownerAccountUuid}/${props.company}/${props.member ?? ''}/${props.token ?? ''}`}
      {...props}
    />
  );
}

function OwnMemberDocuments(props: Parameters<typeof useMemberDocuments>[0] & { title?: string }) {
  const documents = useMemberDocuments(props);
  const editor = documents.editor;
  return (
    <Section title={props.title ?? 'Documents'}>
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
                  <PageAction
                    label="Download"
                    context={document.snapshot.name}
                    disabled={documents.busy}
                    onClick={() => void documents.download(document)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-muted">No supporting documents attached.</p>
          )}
          {!editor && documents.appointment && props.holdings.length > 0 && (
            <PageAction label="Add documents" onClick={documents.open} disabled={documents.busy} />
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
                label={props.member ? 'Share class' : 'Shareholder'}
                choices={props.holdings.map((holding) => ({
                  value: `${holding.member}/${holding.token}`,
                  label: holding.label,
                }))}
                value={`${editor.member}/${editor.token}`}
                noun={props.member ? ['share class', 'share classes'] : ['shareholder', 'shareholders']}
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
              label={documents.held ? 'Recover original save' : 'Save documents'}
              primary
              busy={documents.busy}
              busyLabel="Saving documents…"
              disabled={!documents.ready}
            />
          </FormActions>
        </form>
      )}
      {documents.error && (
        <p role="alert" className="text-sm text-error-light">
          {documents.error}
        </p>
      )}
    </Section>
  );
}
