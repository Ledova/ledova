import type { ClassRightsDraft } from '@ledova/shared';

export function rightsDetailsRecorded(editor: ClassRightsDraft) {
  return (
    Object.keys(editor.attributes).length > 0 ||
    !!editor.summary.trim() ||
    !!editor.effectiveDate ||
    editor.documents.some((row) => row.file || row.snapshot)
  );
}
