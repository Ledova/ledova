import type { ApiResponse, ApiSchema } from '@ledova/shared';

export type DocumentType = ApiSchema<'UserDocumentTypeEnum'>;
export type ExtractionStatus = ApiSchema<'DocumentExtractionStatusEnum'>;
export type DocumentExtraction = ApiSchema<'DocumentExtraction'>;
export type Document = ApiResponse<'api_v1_documents_retrieve'>;
