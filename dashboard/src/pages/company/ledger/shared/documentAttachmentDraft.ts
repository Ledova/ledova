import type { RegisterMemberDocumentSnapshot, RegisterMemberDocumentCategory } from '@ledova/shared';

export const DOCUMENT_CATEGORIES: Record<RegisterMemberDocumentCategory, string> = {
  share_certificate: 'Share certificate',
  shareholder_agreement: 'Shareholder agreement',
  subscription_agreement: 'Subscription agreement',
  other: 'Other supporting document',
};

export type DocumentDraft = {
  id: string;
  category: RegisterMemberDocumentCategory;
  file: File | null;
  evidence?: string;
  snapshot?: RegisterMemberDocumentSnapshot;
};
