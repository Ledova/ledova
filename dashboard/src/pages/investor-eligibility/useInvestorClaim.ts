import { useCallback, useRef, useState } from 'react';
import {
  addCalendarDays,
  addCalendarYears,
  isCalendarDate,
  isUuid,
  submitInvestorClassification,
  type InvestorCategory,
  failureSentence,
  uploadRefusal,
  utcToday,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { hasProblems, type Problems } from '@hooks/useErrorSummary';
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
  const [fileRefusal, setFileRefusal] = useState<string | null>(null);
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

  const chooseFile = useCallback((candidate: File | null) => {
    const refusal = candidate && uploadRefusal(candidate);
    setFileRefusal(refusal);
    setFile(refusal ? null : candidate);
  }, []);

  const reset = () => {
    chooseFile(null);
    setDeclaredBasis('');
    setCompany('');
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

  const today = utcToday();
  const earliestCertificate = addCalendarYears(addCalendarDays(today, 1), -2);
  const available = !submissionBlockedReason && !!category && !!userAccount;
  const problems: Problems<
    | 'company'
    | 'certificateIssuedAt'
    | 'certifierBody'
    | 'certifierName'
    | 'certifierMembershipNumber'
    | 'declaredBasis'
    | 'file'
    | 'declaration'
  > = {
    company: needsCompany && !isUuid(company.trim()) && 'Enter the exact company UUID provided by the issuer.',
    certificateIssuedAt:
      needsCertifier &&
      (!isCalendarDate(certificateIssuedAt) ||
        certificateIssuedAt < earliestCertificate ||
        certificateIssuedAt > today) &&
      'Enter a certificate date within the last two years, no later than today (UTC).',
    certifierBody: needsCertifier && !certifierBody && 'Choose the professional body.',
    certifierName: needsCertifier && !certifierName.trim() && 'Give the accountant’s name.',
    certifierMembershipNumber: needsCertifier && !certifierMembershipNumber.trim() && 'Give the membership number.',
    declaredBasis: !declaredBasis.trim() && 'Give the basis for the claim.',
    file: !file && 'Choose the evidence file.',
    declaration: !declarationAccepted && 'Accept the declaration.',
  };

  const handleSubmit = async () => {
    if (!available || hasProblems(problems) || !file || !category || !userAccount) return;
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
    chooseFile,
    fileRefusal,
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
    today,
    earliestCertificate,
    available,
    problems,
    handleSubmit,
  };
}
