import { useEffect, useRef, useState } from 'react';
import { getClassRights, recordClassRights } from '../services/class-rights';
import { uploadRegisterEvidence } from '../services/register-commands';
import type {
  ClassRightsAttributes,
  ClassRightsDocument,
  ClassRightsRequest,
  ClassRightsRevision,
  RegisterDocumentFile,
  RegisterEvidence,
} from '../types';
import { cleanRightsAttributes, isRightsAttributes, sameRightsAttributes } from '../utils/class-rights';
import { createUserFriendlyError, failureSentence, failureStatus } from '../utils/errors';
import { isRegisterEvidenceReceipt } from '../utils/register-commands';
import { useApiClient } from './useApiClient';
import type { OrderSubmissionSession } from './useSubmissionOwner';

type ClassRightsDraft = {
  appointment: string;
  previousRevision: number;
  attributes: ClassRightsAttributes;
  effectiveDate: string;
  summary: string;
  documents: { id: string; file: RegisterDocumentFile | null; snapshot?: ClassRightsDocument }[];
};
type ClassRightsTarget = {
  token: string;
  company: string;
  appointment: string;
  previousRevision: number;
};
type Upload = { file: RegisterDocumentFile; key: string; receipt?: RegisterEvidence };
type Preparation = { source: ClassRightsDraft; target?: ClassRightsTarget };
type Pending = { target: ClassRightsTarget; request: ClassRightsRequest; documents: ClassRightsDocument[] };

function matchesDocument(actual: ClassRightsDocument, expected: ClassRightsDocument) {
  return (
    actual.evidence === expected.evidence &&
    actual.company === expected.company &&
    actual.name === expected.name &&
    actual.fileSize === expected.fileSize &&
    actual.mimeType === expected.mimeType &&
    actual.sha256 === expected.sha256 &&
    actual.documentType === expected.documentType &&
    actual.providedBy === expected.providedBy
  );
}

function matchesReceipt(receipt: ClassRightsRevision, { target, request, documents }: Pending) {
  return (
    receipt.token === target.token &&
    receipt.idempotencyKey === request.idempotencyKey &&
    receipt.appointment === request.appointment &&
    receipt.revision === request.previousRevision + 1 &&
    receipt.summary === request.summary &&
    receipt.effectiveDate === (request.effectiveDate ?? null) &&
    isRightsAttributes(receipt.attributes) &&
    sameRightsAttributes(receipt.attributes, request.attributes ?? {}) &&
    receipt.documentReference === (request.documentReference ?? '') &&
    Array.isArray(receipt.documents) &&
    receipt.documents.length === documents.length &&
    receipt.documents.every((document, index) => {
      const expected = documents[index];
      return !!expected && matchesDocument(document, expected);
    })
  );
}

export function useClassRightsWriter({
  guard,
  newKey,
  session,
  resolveTarget,
  checkTarget,
  onSaved,
  onRefused,
}: {
  guard: () => void;
  newKey: () => string;
  session?: OrderSubmissionSession;
  resolveTarget: (draft: ClassRightsDraft) => ClassRightsTarget | Promise<ClassRightsTarget>;
  checkTarget: (target: ClassRightsTarget, draft: ClassRightsDraft) => boolean | void;
  onSaved?: (revision: ClassRightsRevision) => void | Promise<void>;
  onRefused?: () => void;
}) {
  const apiClient = useApiClient();
  const mounted = useRef(true);
  const preparation = useRef<Preparation | null>(null);
  const pending = useRef<Pending | null>(null);
  const uploads = useRef(new Map<string, Upload>());
  const running = useRef(false);
  const [editor, setEditor] = useState<ClassRightsDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState('');
  const [saved, setSaved] = useState<ClassRightsRevision | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const check = () => {
    if (!mounted.current) throw createUserFriendlyError('Reopen the class rights before saving.');
    guard();
  };
  const config = (ledovaSubmissionGuard: () => void) => ({ ...session?.requestConfig(), ledovaSubmissionGuard });
  const clearPending = () => {
    pending.current = null;
    preparation.current = null;
    uploads.current.clear();
    if (mounted.current) setHeld(false);
  };
  const open = (draft: ClassRightsDraft) => {
    check();
    if (running.current || pending.current || preparation.current) return;
    setError('');
    setOutcome('');
    setEditor(draft);
  };
  const close = () => {
    if (running.current || pending.current || preparation.current) return;
    clearPending();
    setEditor(null);
    setError('');
  };
  const save = async () => {
    if (running.current || !editor) return;
    running.current = true;
    setBusy(true);
    setError('');
    setOutcome('');
    try {
      check();
      let operation = pending.current;
      let receipt: ClassRightsRevision | undefined;
      if (operation) {
        const { data } = await getClassRights(
          apiClient,
          operation.target.token,
          { idempotency_key: operation.request.idempotencyKey },
          config(check),
        );
        check();
        receipt = data.results.find((revision) => matchesReceipt(revision, operation!));
        if (!receipt && data.results.length)
          throw createUserFriendlyError('The original class rights receipt did not match. Retry the original save.');
        if (!receipt && data.administrationAppointment !== operation.request.appointment) {
          clearPending();
          throw createUserFriendlyError(
            'The original save was not found and your administrator access changed. Close this form and reopen the current details.',
          );
        }
      } else {
        if (!preparation.current) {
          preparation.current = {
            source: { ...editor, documents: editor.documents.filter((row) => row.file || row.snapshot) },
          };
          setHeld(true);
        }
        const prepared = preparation.current;
        const source = prepared.source;
        if (!prepared.target) prepared.target = await resolveTarget(source);
        check();
        const target = prepared.target;
        const checkPreparation = () => {
          check();
          if (checkTarget(target, source) === false) {
            clearPending();
            throw createUserFriendlyError('The class rights changed. Close this form and reopen the current details.');
          }
        };
        checkPreparation();
        const documents: ClassRightsDocument[] = [];
        for (const document of source.documents) {
          if (document.snapshot) {
            documents.push(document.snapshot);
            continue;
          }
          const file = document.file!;
          let upload = uploads.current.get(document.id);
          if (!upload || upload.file !== file) {
            upload = { file, key: newKey() };
            uploads.current.set(document.id, upload);
          }
          const uploadRequest = {
            companyId: target.company,
            appointment: target.appointment,
            kind: 'class_rights' as const,
            idempotencyKey: upload.key,
          };
          checkPreparation();
          if (!upload.receipt) {
            const { data } = await uploadRegisterEvidence(
              apiClient,
              { ...uploadRequest, file },
              config(checkPreparation),
            );
            checkPreparation();
            if (!isRegisterEvidenceReceipt(data, uploadRequest, file.size))
              throw createUserFriendlyError(
                'The class document upload could not be confirmed. Retry the original save.',
              );
            upload.receipt = data;
          }
          const evidence = upload.receipt;
          documents.push({
            evidence: evidence.uuid,
            company: target.company,
            providedBy: 'company',
            documentType: 'class_rights',
            name: evidence.originalFilename,
            fileSize: evidence.fileSize,
            mimeType: evidence.mimeType,
            sha256: evidence.sha256,
          });
        }
        documents.sort((left, right) => left.evidence.localeCompare(right.evidence));
        operation = {
          target,
          documents,
          request: {
            appointment: target.appointment,
            previousRevision: target.previousRevision,
            summary: source.summary.trim(),
            attributes: cleanRightsAttributes(source.attributes),
            effectiveDate: source.effectiveDate || null,
            documents: documents.map((document) => document.evidence),
            idempotencyKey: newKey(),
          },
        };
        pending.current = operation;
      }
      if (!receipt) {
        check();
        ({ data: receipt } = await recordClassRights(
          apiClient,
          operation.target.token,
          operation.request,
          config(check),
        ));
        check();
        if (!matchesReceipt(receipt, operation))
          throw createUserFriendlyError('The class rights receipt could not be confirmed. Retry the original save.');
      }
      clearPending();
      setEditor(null);
      setSaved(receipt);
      setOutcome('Class rights saved.');
      await onSaved?.(receipt);
    } catch (failure) {
      if (!pending.current && !preparation.current?.target) clearPending();
      try {
        check();
        const status = failureStatus(failure);
        if (status !== undefined && status >= 400 && status < 500) {
          clearPending();
          onRefused?.();
        }
        setError(failureSentence(failure, 'The class rights could not be saved. Retry the original save.'));
      } catch {
        return;
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return { editor, setEditor, open, close, save, busy, pending: held, error, setError, outcome, saved, running };
}
