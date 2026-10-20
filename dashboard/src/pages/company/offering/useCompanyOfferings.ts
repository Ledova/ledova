import {
  OFFERING_WITHDRAWABLE_STATUSES,
  apiErrorSentence,
  createUserFriendlyError,
  updateCompany,
  useCompanySelection,
} from '@ledova/shared';
import apiClient from '@services/apiClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useOfferingActions, useOfferings } from './useOffering';

export function useCompanyOfferings({ companyRead }: { companyRead: ReturnType<typeof useCompanySelection> }) {
  const { company } = companyRead;
  const data = useOfferings(companyRead.retainedCompany?.uuid, companyRead);
  const client = useQueryClient();
  const [editor, setEditor] = useState<{ company: string; uuid?: string } | null>(null);
  const [documentsEditor, setDocumentsEditor] = useState<{ company: string; uuid: string } | null>(null);
  const [actionError, setActionError] = useState<{ listing: boolean; message: string } | null>(null);
  const [notice, setNotice] = useState('');
  const listingPendingRef = useRef(false);
  const actionPending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const ownerGuard = () => {
    if (!mounted.current || !company) throw createUserFriendlyError('This company action is closed.');
    companyRead.assertCurrent(company.uuid, 'owner');
  };
  const actions = useOfferingActions(
    async () => {
      ownerGuard();
      await data.refresh();
      ownerGuard();
    },
    (uuid, action) => {
      const guard = () => {
        ownerGuard();
        data.assertOffering(uuid, action);
      };
      return { ...companyRead.requestConfig(company!.uuid, 'owner'), ledovaSubmissionGuard: guard };
    },
  );
  const listing = useMutation({
    mutationFn: async ({
      uuid,
      isOpen,
      guard,
      config,
    }: {
      uuid: string;
      isOpen: boolean;
      guard: () => void;
      config: ReturnType<typeof companyRead.requestConfig>;
    }) => {
      guard();
      const result = await updateCompany(apiClient, uuid, { isOpenToInvestors: isOpen }, config);
      guard();
      if (
        result.data.uuid !== uuid ||
        result.data.isOpenToInvestors !== isOpen ||
        !Array.isArray(result.data.documents)
      )
        throw createUserFriendlyError('Directory visibility could not be confirmed. Refresh before retrying.');
      return result;
    },
    onSuccess: async (_, { guard }) => {
      guard();
      await client.invalidateQueries({ queryKey: companyRead.companyKey });
    },
    onSettled: () => {
      listingPendingRef.current = false;
    },
    onMutate: () => setActionError(null),
    onError: (error) =>
      setActionError({
        listing: true,
        message: apiErrorSentence(
          error,
          'Directory visibility could not be changed. Try again.',
          'Directory visibility could not be confirmed. Refresh before retrying.',
        ),
      }),
  });
  const busy = actions.submit.isPending || actions.withdraw.isPending || actions.remove.isPending || listing.isPending;
  const ready =
    !!company && !companyRead.error && !companyRead.isRefreshing && !data.error && !data.isRefreshing && !busy;
  const run = async (action: 'submit' | 'withdraw' | 'remove', uuid: string) => {
    const offering = data.offerings.find((row) => row.uuid === uuid);
    if (!ready || !offering || actionPending.current) return;
    if (action === 'submit' && !offering.canBeEdited) return;
    if (action === 'remove' && !offering.canBeDeleted) return;
    if (action === 'withdraw' && !OFFERING_WITHDRAWABLE_STATUSES.includes(offering.status)) return;
    setActionError(null);
    setNotice('');
    actionPending.current = true;
    try {
      ownerGuard();
      if (action === 'withdraw') await actions.withdraw.mutateAsync({ uuid, reason: 'Withdrawn by the issuer' });
      else await actions[action].mutateAsync(uuid);
      setNotice(
        action === 'submit'
          ? `The ${offering.tokenName} offering was submitted for review.`
          : action === 'withdraw'
            ? `The ${offering.tokenName} offering was withdrawn.`
            : `The ${offering.tokenName} draft offering was deleted.`,
      );
    } catch (error) {
      setActionError({
        listing: false,
        message: apiErrorSentence(error, 'The request could not be completed. Try again.'),
      });
    } finally {
      actionPending.current = false;
    }
  };
  return {
    company: company!,
    data,
    editor,
    setEditor,
    documentsEditor,
    setDocumentsEditor,
    actionError,
    listingPendingRef,
    mounted,
    listing,
    ready,
    run,
    notice,
    pending: actions.withdraw.isPending ? 'withdraw' : actions.remove.isPending ? 'remove' : null,
  };
}
