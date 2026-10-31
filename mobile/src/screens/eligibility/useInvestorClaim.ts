import { useEffect, useRef, useState } from 'react';
import {
  CATEGORIES,
  failureSentence,
  hasProblems,
  investorClaimChecks,
  investorClaimSubmission,
  submitInvestorClassification,
  uploadRefusal,
  type CertifierBody,
  type InvestorCategory,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { discardDocument, pickDocument, type PickedDocument } from '../../services/documentCopies';

export function useInvestorClaim({
  category,
  onSuccess,
  submissionBlockedReason,
}: {
  category: InvestorCategory | null;
  onSuccess: () => void;
  submissionBlockedReason: string | null;
}) {
  const [file, setFile] = useState<PickedDocument | null>(null);
  const [fileRefusal, setFileRefusal] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [declaredBasis, setDeclaredBasis] = useState('');
  const [certificateIssuedAt, setCertificateIssuedAt] = useState('');
  const [certifierName, setCertifierName] = useState('');
  const [certifierBody, setCertifierBody] = useState<CertifierBody | ''>('');
  const [certifierMembershipNumber, setCertifierMembershipNumber] = useState('');
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kept = useRef<PickedDocument | null>(null);
  useEffect(
    () => () => {
      if (kept.current) discardDocument(kept.current.uri);
    },
    [],
  );

  const spec = CATEGORIES.find((item) => item.category === category);

  const keep = (next: PickedDocument | null) => {
    if (kept.current && kept.current.uri !== next?.uri) discardDocument(kept.current.uri);
    kept.current = next;
    setFile(next);
  };

  const chooseFile = async () => {
    if (isPicking) return;
    setIsPicking(true);
    try {
      const candidate = await pickDocument();
      if (!candidate) return;
      const refusal = uploadRefusal(candidate);
      if (refusal) discardDocument(candidate.uri);
      setFileRefusal(refusal);
      keep(refusal ? null : candidate);
    } catch {
      setFileRefusal('The file could not be opened. Choose it again.');
    } finally {
      setIsPicking(false);
    }
  };

  const removeFile = () => {
    setFileRefusal(null);
    keep(null);
  };

  const reset = () => {
    removeFile();
    setDeclaredBasis('');
    setCertificateIssuedAt('');
    setCertifierName('');
    setCertifierBody('');
    setCertifierMembershipNumber('');
    setDeclarationAccepted(false);
    setError(null);
  };

  const draft = {
    category,
    declaredBasis,
    certificateIssuedAt,
    certifierName,
    certifierBody,
    certifierMembershipNumber,
    declarationAccepted,
  };
  const { needsCertifier, today, earliestCertificate, problems } = investorClaimChecks(draft, !!file);
  const available = !submissionBlockedReason && !!category;

  const handleSubmit = async () => {
    if (!available || hasProblems(problems) || !file || !category || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await submitInvestorClassification(
        apiClient,
        investorClaimSubmission({ ...draft, category }, { uri: file.uri, name: file.name, type: file.type }),
        { ledovaSessionEpoch: file.epoch },
      );
      reset();
      onSuccess();
    } catch (caught) {
      setError(failureSentence(caught, 'The claim was refused. Please check the details and try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    file,
    chooseFile,
    removeFile,
    fileRefusal,
    isPicking,
    declaredBasis,
    setDeclaredBasis,
    certificateIssuedAt,
    setCertificateIssuedAt,
    certifierName,
    setCertifierName,
    certifierBody,
    setCertifierBody,
    certifierMembershipNumber,
    setCertifierMembershipNumber,
    declarationAccepted,
    setDeclarationAccepted,
    isSubmitting,
    error,
    needsCertifier,
    spec,
    reset,
    today,
    earliestCertificate,
    available,
    problems,
    handleSubmit,
  };
}
