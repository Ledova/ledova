import type { ApiResponse, ApiSchema } from '../contracts';

export type UserDocumentType = ApiSchema<'UserDocumentTypeEnum'>;
export type ExtractionStatus = ApiSchema<'DocumentExtractionStatusEnum'>;
export type Document = ApiResponse<'api_v1_documents_retrieve'>;
