import { FileField } from '@components/Field';
import { SelectField } from '@components/SelectField';
import type { RegisterMemberDocumentCategory } from '@ledova/shared';
import { DOCUMENT_CATEGORIES, type DocumentDraft } from './documentAttachmentDraft';
import { RecordAction } from './RecordAction';

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
      <legend className="sr-only">Documents</legend>
      <div className={`flex items-center gap-3 ${heading ? 'justify-between' : 'justify-end'}`}>
        {heading && <h3 className="text-sm font-medium text-text-primary">Documents</h3>}
        <RecordAction
          action="add"
          text="Add"
          label="Add document"
          disabled={disabled}
          onClick={() => update([...documents, { id: crypto.randomUUID(), category: 'other', file: null }])}
        />
      </div>
      {documents.length > 0 && (
        <div className="divide-y divide-border-subtle">
          {documents.map((document, index) => (
            <fieldset key={document.id} className="flex min-w-0 items-start gap-2 py-3 first:pt-0">
              <legend className="sr-only">Document {index + 1}</legend>
              <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
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
              </div>
              <RecordAction
                action="remove"
                label={`Remove document ${index + 1}`}
                disabled={disabled}
                onClick={() => update(documents.filter((row) => row.id !== document.id))}
              />
            </fieldset>
          ))}
        </div>
      )}
    </fieldset>
  );
}
