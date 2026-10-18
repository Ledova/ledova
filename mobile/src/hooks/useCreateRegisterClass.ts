import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiErrorSentence, createCompanyToken, failureStatus, wholeShares, type TokenType } from '@ledova/shared';
import { apiClient } from '../services/apiClient';
import type { useRegisterClassCreation } from './useRegisterClassCreation';

interface Props {
  target: { uuid: string; name: string };
  read: ReturnType<typeof useRegisterClassCreation>;
  onClose: () => void;
  onSuccess: () => Promise<unknown>;
  name: string;
  symbol: string;
  tokenType: TokenType;
  totalSupply: string;
}

export function useCreateRegisterClass({
  target,
  read,
  onClose,
  onSuccess,
  name,
  symbol,
  tokenType,
  totalSupply,
}: Props) {
  const quantity = wholeShares(totalSupply);
  const mounted = useRef(true);
  const [authority] = useState(() => read.assertCurrent);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [guard] = useState(() => () => {
    if (!mounted.current) throw new Error('This share class draft is no longer open.');
    authority(target.uuid);
  });
  const [config] = useState(() => ({ ...read.requestConfig(target.uuid), ledovaSubmissionGuard: guard }));
  const pending = useRef(false);
  const [uncertain, setUncertain] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const before = useRef<Set<string>>(new Set());
  const valid =
    read.companyUuid === target.uuid &&
    read.canPrepare &&
    !read.error &&
    !read.isRefreshing &&
    !uncertain &&
    name.trim() !== '' &&
    name.trim().length <= 100 &&
    /^[A-Z]{1,5}$/.test(symbol.trim()) &&
    !read.classes.data?.some((item) => item.companyUuid === target.uuid && item.symbol === symbol.trim()) &&
    quantity !== null &&
    quantity > 0n;
  const create = useMutation({
    mutationFn: async () => {
      guard();
      setRecoveryError(null);
      before.current = new Set(read.classes.data?.map(({ uuid }) => uuid));
      setUncertain(true);
      let result;
      try {
        result = await createCompanyToken(
          apiClient,
          {
            company: target.uuid,
            name: name.trim(),
            symbol: symbol.trim(),
            tokenType,
            totalSupply,
          },
          config,
        );
      } catch (cause) {
        const status = failureStatus(cause);
        if (status === 400 || status === 409) setUncertain(false);
        throw cause;
      }
      guard();
      if (
        !result.data.uuid ||
        before.current.has(result.data.uuid) ||
        result.data.company !== target.uuid ||
        result.data.companyUuid !== target.uuid ||
        result.data.name !== name.trim() ||
        result.data.symbol !== symbol.trim() ||
        result.data.tokenType !== tokenType ||
        result.data.totalSupply !== quantity?.toString() ||
        result.data.status !== 'draft' ||
        result.data.contractAddress !== null ||
        result.data.chain !== null ||
        result.data.deployedAt !== null ||
        result.data.deploymentTxHash !== null
      )
        throw new Error('The new share class could not be confirmed. Refresh share classes before continuing.');
      return result;
    },
    onSuccess: async () => {
      guard();
      await onSuccess();
      guard();
      onClose();
    },
    onSettled: () => {
      pending.current = false;
    },
  });
  const refreshClasses = () => {
    setRecoveryError(null);
    void read
      .refetch()
      .then(({ classes }) => {
        if (!mounted.current) return;
        const matches = classes.data?.filter(
          (item) =>
            !before.current.has(item.uuid) &&
            item.companyUuid === target.uuid &&
            item.name === name.trim() &&
            item.symbol === symbol.trim() &&
            item.tokenType === tokenType &&
            item.totalSupply === quantity?.toString() &&
            item.status === 'draft' &&
            item.contractAddress === null &&
            item.chain === null &&
            item.deployedAt === null,
        );
        if (uncertain && classes.isSuccess && matches?.length === 1) {
          setUncertain(false);
          onClose();
        }
      })
      .catch((cause) => {
        if (mounted.current) setRecoveryError(apiErrorSentence(cause, 'Share classes could not be refreshed.'));
      });
  };
  const close = () => {
    if (!create.isPending && !uncertain) onClose();
  };
  const submit = () => {
    if (valid && mounted.current && !pending.current) {
      pending.current = true;
      create.mutate();
    }
  };
  return { valid, create, uncertain, recoveryError, refreshClasses, close, submit };
}
