import { OFFER_DOCUMENT_COPY, type CompanyDocument } from '@ledova/shared';

export function DocumentChoices({
  documents,
  chosen,
  kept = [],
  onToggle,
}: {
  documents: CompanyDocument[];
  chosen: string[];
  kept?: string[];
  onToggle: (uuid: string) => void;
}) {
  return (
    <>
      {documents.map((document) => {
        const stays = kept.includes(document.uuid);
        return (
          <label key={document.uuid} className="flex items-start gap-3">
            <input
              type="checkbox"
              aria-label={`${OFFER_DOCUMENT_COPY.ATTACH} ${document.name}`}
              checked={stays || chosen.includes(document.uuid)}
              disabled={stays}
              onChange={() => onToggle(document.uuid)}
              className="mt-0.5 h-4 w-4 rounded border-border"
            />
            <span className="min-w-0">
              <span className="block break-all text-sm text-text-primary">{document.name}</span>
              <span className="block text-sm text-text-muted">
                {stays
                  ? `${document.documentTypeDisplay} · ${OFFER_DOCUMENT_COPY.ATTACHED}`
                  : document.documentTypeDisplay}
              </span>
            </span>
          </label>
        );
      })}
    </>
  );
}
