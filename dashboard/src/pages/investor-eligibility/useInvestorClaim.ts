import { useCallback, useRef, useState } from 'react';
import { isUuid, submitInvestorClassification, type InvestorCategory, failureSentence } from '@ledova/shared';
import apiClient from '@services/apiClient';
import { CATEGORIES } from './constants';

export function useInvestorClaim({
  category,
  userAccount,
  onSuccess,
  submissionBlockedReason,
}: {
  category: InvestorCategory | null;
  userAccount: string | null;
  onSuccess: () => void;
  submissionBlockedReason: string | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [declaredBasis, setDeclaredBasis] = useState('');
  const [company, setCompany] = useState('');
  const [certificateIssuedAt, setCertificateIssuedAt] = useState('');
  const [certifierName, setCertifierName] = useState('');
  const [certifierBody, setCertifierBody] = useState('');
  const [certifierMembershipNumber, setCertifierMembershipNumber] = useState('');
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const needsCompany = category === 'associated_person';
  const needsCertifier = category === 'accountant_certificate';

  const spec = CATEGORIES.find((item) => item.category === category);

  const reset = () => {
    setFile(null);
    setDeclaredBasis('');
    setCompany('');
    setCertificateIssuedAt('');
    setCertifierName('');
    setCertifierBody('');
    setCertifierMembershipNumber('');
    setDeclarationAccepted(false);
    setError(null);
  };

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  }, []);

  const isComplete =
    !submissionBlockedReason &&
    !!file &&
    !!category &&
    !!userAccount &&
    declarationAccepted &&
    declaredBasis.trim() !== '' &&
    (!needsCompany || isUuid(company.trim())) &&
    (!needsCertifier ||
      (certificateIssuedAt !== '' &&
        certifierName.trim() !== '' &&
        certifierBody !== '' &&
        certifierMembershipNumber.trim() !== ''));

  const handleSubmit = async () => {
    if (!isComplete || !file || !category || !userAccount) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await submitInvestorClassification(apiClient, {
        category,
        declaredBasis: declaredBasis.trim(),
        file,
        company: needsCompany ? company.trim() : undefined,
        certificateIssuedAt: needsCertifier ? certificateIssuedAt : undefined,
        certifierName: needsCertifier ? certifierName.trim() : undefined,
        certifierBody: needsCertifier ? (certifierBody as 'ca_anz' | 'cpa_australia' | 'ipa') : undefined,
        certifierMembershipNumber: needsCertifier ? certifierMembershipNumber.trim() : undefined,
      });
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
    setFile,
    declaredBasis,
    setDeclaredBasis,
    company,
    setCompany,
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
    needsCompany,
    needsCertifier,
    spec,
    reset,
    handleDrop,
    isComplete,
    handleSubmit,
  };
}
