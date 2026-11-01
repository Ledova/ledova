import { useState } from 'react';
import {
  CATEGORIES,
  failureSentence,
  hasProblems,
  investorClaimChecks,
  investorClaimSubmission,
  submitInvestorClassification,
  type CertifierBody,
  type InvestorCategory,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { usePickedDocument } from './usePickedDocument';

export function useInvestorClaim({
  category,
  onSuccess,
  submissionBlockedReason,
}: {
  category: InvestorCategory | null;
  onSuccess: () => void;
  submissionBlockedReason: string | null;
}) {
  const picked = usePickedDocument();
  const file = picked.file;
  const [declaredBasis, setDeclaredBasis] = useState('');
  const [certificateIssuedAt, setCertificateIssuedAt] = useState('');
  const [certifierName, setCertifierName] = useState('');
  const [certifierBody, setCertifierBody] = useState<CertifierBody | ''>('');
  const [certifierMembershipNumber, setCertifierMembershipNumber] = useState('');
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spec = CATEGORIES.find((item) => item.category === category);

  const reset = () => {
    picked.remove();
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
    chooseFile: picked.choose,
    removeFile: picked.remove,
    fileRefusal: picked.refusal,
    isPicking: picked.isPicking,
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
