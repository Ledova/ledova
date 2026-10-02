import { OFFER_DOCUMENT_TYPES } from '../../src/constants';
import { attachableDocuments, describeOfferDocument, formatFileSize } from '../../src/utils';
import type { CompanyDocument, DirectoryDocument } from '../../src/types';

const memorandum: DirectoryDocument = {
  uuid: 'memorandum',
  name: 'Information memorandum',
  documentType: 'prospectus',
  documentTypeDisplay: 'Prospectus or Information Memorandum',
  fileSize: 2_621_440,
  mimeType: 'application/pdf',
  validFrom: null,
  validUntil: null,
  createdAt: '2026-09-01T00:00:00Z',
  fileUrl: 'https://api.example.test/api/v1/directory/tokens/class-a/documents/memorandum/file/',
};

it.each([
  [0, '0 B'],
  [1023, '1023 B'],
  [1024, '1.0 KB'],
  [24_576, '24.0 KB'],
  [1_048_576, '1.0 MB'],
])('writes %d bytes as %s', (bytes, written) => {
  expect(formatFileSize(bytes)).toBe(written);
});

it('describes a document by its type, size and upload day', () => {
  expect(describeOfferDocument(memorandum)).toBe(
    'Prospectus or Information Memorandum · 2.5 MB · Uploaded 1 September 2026',
  );
});

it('adds the validity the issuer recorded, on the calendar day it names', () => {
  expect(describeOfferDocument({ ...memorandum, validFrom: '2026-09-01', validUntil: '2026-11-30' })).toBe(
    'Prospectus or Information Memorandum · 2.5 MB · Uploaded 1 September 2026 · ' +
      'Valid from 1 September 2026 · Valid until 30 November 2026',
  );
});

const companyDocument = (uuid: string, documentType: CompanyDocument['documentType']) =>
  ({ uuid, name: `${uuid}.pdf`, documentType }) as CompanyDocument;

it('offers every offer document type for attaching, and no other company record', () => {
  const offer = OFFER_DOCUMENT_TYPES.map((type) => companyDocument(type, type));
  const records = (['cert_inc', 'share_register', 'director_id', 'beneficial_ownership', 'other'] as const).map(
    (type) => companyDocument(type, type),
  );

  expect(attachableDocuments([...records, ...offer], [])).toEqual(offer);
});

it('keeps listing a document already attached, whatever its type, so a save never drops it', () => {
  const documents = [companyDocument('passport', 'director_id'), companyDocument('memorandum', 'prospectus')];

  expect(attachableDocuments(documents, ['passport'])).toEqual(documents);
});
