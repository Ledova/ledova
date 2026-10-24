import type { RegisterMemberDocumentSnapshot, RegisterMemberDocumentCategory } from '@ledova/shared';

export type DocumentDraft = {
  id: string;
  category: RegisterMemberDocumentCategory;
  file: File | null;
  evidence?: string;
  snapshot?: RegisterMemberDocumentSnapshot;
};
