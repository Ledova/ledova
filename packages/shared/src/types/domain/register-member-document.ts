import type { ApiRequest, ApiSchema } from '../contracts';

export type RegisterMemberDocumentCategory = ApiSchema<'RegisterMemberDocumentCategoryEnum'>;

export type RegisterMemberDocumentSnapshot = {
  providedBy: 'company';
  evidence: string;
  company: string;
  documentType: 'supporting';
  name: string;
  fileSize: number;
  mimeType: string;
  sha256: string;
};

export type RegisterImportMemberDocument = {
  evidence: string;
  category: RegisterMemberDocumentCategory;
  snapshot?: RegisterMemberDocumentSnapshot;
};

export type RegisterMemberDocumentRecord = ApiSchema<'RegisterMemberDocument'>;

export type RegisterMemberDocument = Omit<RegisterMemberDocumentRecord, 'snapshot' | 'category'> & {
  snapshot: RegisterMemberDocumentSnapshot;
  category: RegisterMemberDocumentCategory;
};

export type RegisterMemberDocumentRequest = ApiRequest<'api_v1_tokens_register_member_documents_create'>;

export type RegisterMemberDocumentQuery = {
  company: string;
  member?: string;
  token?: string;
  idempotencyKey?: string;
  page?: number;
};
