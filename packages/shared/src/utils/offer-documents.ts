import { OFFER_DOCUMENT_TYPES } from '../constants';
import type { CompanyDocument, DirectoryDocument } from '../types';
import { formatDate } from './date';
import { formatFileSize } from './formatting';

export function describeOfferDocument(document: DirectoryDocument): string {
  return [
    document.documentTypeDisplay,
    formatFileSize(document.fileSize),
    `Uploaded ${formatDate(document.createdAt)}`,
    ...(document.validFrom ? [`Valid from ${formatDate(document.validFrom)}`] : []),
    ...(document.validUntil ? [`Valid until ${formatDate(document.validUntil)}`] : []),
  ].join(' · ');
}

export function attachableDocuments(documents: CompanyDocument[], attached: readonly string[]): CompanyDocument[] {
  return documents.filter(
    (document) => OFFER_DOCUMENT_TYPES.includes(document.documentType) || attached.includes(document.uuid),
  );
}
