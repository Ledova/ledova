import { useCallback, useRef, useState } from 'react';
import {
  investorClaimChecks,
  investorClaimSubmission,
  submitInvestorClassification,
  type CertifierBody,
  type InvestorCategory,
  failureSentence,
  uploadRefusal,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { hasProblems } from '@hooks/useErrorSummary';
import { CATEGORIES } from './constants';

export function useInvestorClaim({
  category,
  onSuccess,
  submissionBlockedReason,
}: {
  category: InvestorCategory | null;
  onSuccess: () => void;
  submissionBlockedReason: string | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [fileRefusal, setFileRefusal] = useState<string | null>(null);
  const [declaredBasis, setDeclaredBasis] = useState('');
  const [certificateIssuedAt, setCertificateIssuedAt] = useState('');
  const [certifierName, setCertifierName] = useState('');
  const [certifierBody, setCertifierBody] = useState<CertifierBody | ''>('');
  const [certifierMembershipNumber, setCertifierMembershipNumber] = useState('');
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const spec = CATEGORIES.find((item) => item.category === category);

  const chooseFile = useCallback((candidate: File | null) => {
    const refusal = candidate && uploadRefusal(candidate);
    setFileRefusal(refusal);
    setFile(refusal ? null : candidate);
  }, []);

  const reset = () => {
    chooseFile(null);
    setDeclaredBasis('');
    setCertificateIssuedAt('');
    setCertifierName('');
    setCertifierBody('');
    setCertifierMembershipNumber('');
    setDeclarationAccepted(false);
    setError(null);
  };

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      const dropped = event.dataTransfer.files?.[0];
      if (dropped) chooseFile(dropped);
    },
    [chooseFile],
  );

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
    if (!available || hasProblems(problems) || !file || !category) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await submitInvestorClassification(apiClient, investorClaimSubmission({ ...draft, category }, file));
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
    fileRefusal,
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
    isDragging,
    setIsDragging,
    error,
    fileInputRef,
    needsCertifier,
    spec,
    reset,
    handleDrop,
    today,
    earliestCertificate,
    available,
    problems,
    handleSubmit,
  };
}
