import { FileField } from '@components/Field';
import { SelectField } from '@components/SelectField';
import { PageAction } from '@components/Page';
import type { RegisterMemberDocumentCategory } from '@ledova/shared';
import { DOCUMENT_CATEGORIES, type DocumentDraft } from './documentAttachmentDraft';

export function DocumentAttachments({
  documents,
  update,
  disabled = false,
  heading = true,
}: {
  documents: DocumentDraft[];
  update: (documents: DocumentDraft[]) => void;
  disabled?: boolean;
  heading?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className={heading ? 'space-y-3 border-t border-border-subtle pt-4' : 'space-y-3'}>
      <legend className="sr-only">Documents (optional)</legend>
      {heading && <h3 className="text-sm font-medium text-text-primary">Documents (optional)</h3>}
      {documents.map((document, index) => (
        <fieldset key={document.id} className="space-y-3 rounded-lg border border-border-subtle p-3">
          <legend className="sr-only">Document {index + 1}</legend>
          <SelectField
            label="Category"
            options={Object.entries(DOCUMENT_CATEGORIES).map(([value, label]) => ({ value, label }))}
            value={document.category}
            disabled={!!document.evidence}
            onChange={(value) =>
              update(
                documents.map((row) =>
                  row.id === document.id ? { ...row, category: value as RegisterMemberDocumentCategory } : row,
                ),
              )
            }
          />
          {document.file || document.evidence ? (
            <p className="break-words text-sm text-text-primary">
              {document.file?.name || document.snapshot?.name || 'Retained supporting document'}
            </p>
          ) : (
            <FileField
              label="File"
              onFile={(file) => update(documents.map((row) => (row.id === document.id ? { ...row, file } : row)))}
            />
          )}
          <PageAction
            label="Remove"
            context={`document ${index + 1}`}
            disabled={disabled}
            onClick={() => update(documents.filter((row) => row.id !== document.id))}
          />
        </fieldset>
      ))}
      <PageAction
        label={documents.length ? 'Add another document' : 'Add document'}
        disabled={disabled}
        onClick={() => update([...documents, { id: crypto.randomUUID(), category: 'other', file: null }])}
      />
    </fieldset>
  );
}
