import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import {
  OFFERING_PUBLISHED_STATUSES,
  OFFER_DOCUMENT_COPY,
  addOfferingDocuments,
  apiErrorSentence,
  attachableDocuments,
  type Company,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { CustomModal, ModalActions } from '../../components/modal';
import { CompanyReadNotice, type CompanyActionRead } from '../company/CompanyState';
import { useCompanyStyles } from '../company-register/styles';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch } from '../../services/sessionScope';
import { DocumentChoices } from './DocumentChoices';
import { OfferingReadNotice } from './OfferingReadNotice';
import { useOwnedOffering } from './useOfferings';

export function OfferingDocumentsEditor({
  uuid,
  targetCompany,
  company,
  companyRead,
  refresh,
  onClose,
}: {
  uuid: string;
  targetCompany: string;
  company: Company | null;
  companyRead: CompanyActionRead;
  refresh: () => Promise<unknown>;
  onClose: () => void;
}) {
  const styles = useCompanyStyles();
  const detail = useOwnedOffering(companyRead, uuid);
  const mounted = useRef(true);
  const pending = useRef(false);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const [authority] = useState(() => companyRead.assertCurrent);
  const [guard] = useState(() => () => {
    if (!mounted.current) throw new Error('This offering draft is no longer open.');
    authority(targetCompany, 'owner');
  });
  const [config] = useState(() => ({
    ...companyRead.requestConfig(targetCompany, 'owner'),
    ledovaSubmissionGuard: guard,
  }));
  const [chosen, setChosen] = useState<string[]>([]);
  const kept = detail.data?.documents ?? [];
  const documents = company?.uuid === targetCompany ? attachableDocuments(company.documents, kept) : [];
  const published = !!detail.data && OFFERING_PUBLISHED_STATUSES.includes(detail.data.status);
  const blocked =
    company?.uuid !== targetCompany ||
    !!companyRead.error ||
    companyRead.isRefreshing ||
    detail.isError ||
    detail.isFetching ||
    !published;
  const request = useMutation({
    mutationFn: async ({ added, epoch }: { added: string[]; epoch: number }) => {
      assertSessionEpoch(epoch);
      guard();
      const response = await addOfferingDocuments(apiClient, uuid, added, { ...config, ledovaSessionEpoch: epoch });
      assertSessionEpoch(epoch);
      guard();
      return response;
    },
    onSuccess: async (_, { epoch }) => {
      assertSessionEpoch(epoch);
      guard();
      await refresh();
      assertSessionEpoch(epoch);
      guard();
      onClose();
    },
    onSettled: () => {
      pending.current = false;
    },
  });
  const addable = chosen.filter((document) => !kept.includes(document));
  const close = () => {
    if (!request.isPending) onClose();
  };
  return (
    <CustomModal visible title={OFFER_DOCUMENT_COPY.ADD} onClose={close} busy={request.isPending}>
      <View style={styles.group}>
        <CompanyReadNotice read={companyRead} />
        <OfferingReadNotice
          read={{ error: detail.error, isRefreshing: detail.isFetching, refetch: detail.refetch }}
          label="Current offering"
        />
        <Text style={styles.muted}>{OFFER_DOCUMENT_COPY.ADD_HELP}</Text>
        {request.isError && request.variables?.epoch === getSessionEpoch() && (
          <Text accessibilityRole="alert" style={styles.error}>
            {apiErrorSentence(request.error, OFFER_DOCUMENT_COPY.ADD_FAILED)}
          </Text>
        )}
        {!!detail.data && !published && (
          <Text accessibilityRole="alert" style={styles.error}>
            {OFFER_DOCUMENT_COPY.ADD_UNAVAILABLE}
          </Text>
        )}
        {!!detail.data && published && (
          <>
            {documents.every((document) => kept.includes(document.uuid)) && (
              <Text style={styles.muted}>{OFFER_DOCUMENT_COPY.ADD_NONE}</Text>
            )}
            <DocumentChoices
              documents={documents}
              chosen={chosen}
              kept={kept}
              busy={request.isPending}
              onChange={(document, attached) =>
                setChosen((current) =>
                  attached ? [...current, document] : current.filter((each) => each !== document),
                )
              }
            />
          </>
        )}
        <ModalActions>
          <Action label="Cancel" disabled={request.isPending} onPress={close} />
          <Action
            label={OFFER_DOCUMENT_COPY.ADD}
            primary
            disabled={blocked || addable.length === 0 || request.isPending}
            onPress={() => {
              if (!blocked && addable.length > 0 && mounted.current && !pending.current) {
                pending.current = true;
                request.mutate({ added: addable, epoch: getSessionEpoch() });
              }
            }}
          />
        </ModalActions>
      </View>
    </CustomModal>
  );
}
