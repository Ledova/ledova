import type { DirectoryDocument } from '../types';
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
