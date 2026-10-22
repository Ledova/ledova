import type {
  RegisterImportMemberDocument,
  RegisterMemberDocument,
  RegisterMemberDocumentCategory,
  RegisterMemberDocumentRequest,
  RegisterMemberDocumentSnapshot,
} from '../types';
import { isUuid } from './validation';

const CATEGORIES: RegisterMemberDocumentCategory[] = [
  'share_certificate',
  'shareholder_agreement',
  'subscription_agreement',
  'other',
];

function isSnapshot(value: unknown, evidence: string, company: string): value is RegisterMemberDocumentSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<RegisterMemberDocumentSnapshot>;
  return (
    snapshot.evidence === evidence &&
    snapshot.company === company &&
    snapshot.documentType === 'supporting' &&
    snapshot.providedBy === 'company' &&
    typeof snapshot.name === 'string' &&
    !!snapshot.name.trim() &&
    typeof snapshot.fileSize === 'number' &&
    Number.isSafeInteger(snapshot.fileSize) &&
    snapshot.fileSize > 0 &&
    typeof snapshot.mimeType === 'string' &&
    !!snapshot.mimeType.trim() &&
    typeof snapshot.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(snapshot.sha256)
  );
}

export function isRegisterImportMemberDocuments(
  value: unknown,
  company: string,
): value is RegisterImportMemberDocument[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row: Partial<RegisterImportMemberDocument> | null) =>
        !!row &&
        typeof row === 'object' &&
        typeof row.evidence === 'string' &&
        isUuid(row.evidence) &&
        CATEGORIES.includes(row.category as RegisterMemberDocumentCategory) &&
        isSnapshot(row.snapshot, row.evidence, company),
    ) &&
    new Set(value.map((row) => row.evidence)).size === value.length
  );
}

export function isRegisterMemberDocument(value: unknown): value is RegisterMemberDocument {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<RegisterMemberDocument>;
  return (
    ['uuid', 'company', 'member', 'token', 'evidence', 'appointment', 'idempotencyKey'].every((key) => {
      const entry = row[key as keyof RegisterMemberDocument];
      return typeof entry === 'string' && isUuid(entry);
    }) &&
    (row.sourceImport === null || (typeof row.sourceImport === 'string' && isUuid(row.sourceImport))) &&
    CATEGORIES.includes(row.category as RegisterMemberDocumentCategory) &&
    typeof row.createdAt === 'string' &&
    Number.isFinite(Date.parse(row.createdAt)) &&
    isSnapshot(row.snapshot, row.evidence!, row.company!)
  );
}

export function isRegisterMemberDocumentReceipt(value: unknown, request: RegisterMemberDocumentRequest) {
  return (
    isRegisterMemberDocument(value) &&
    value.company === request.companyId &&
    value.member === request.member &&
    value.token === request.token &&
    value.evidence === request.evidence &&
    value.category === request.category &&
    value.appointment === request.appointment &&
    value.idempotencyKey === request.idempotencyKey &&
    value.sourceImport === null
  );
}
