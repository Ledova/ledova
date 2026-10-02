import { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import {
  OFFERING_PUBLISHED_STATUSES,
  OFFER_DOCUMENT_COPY,
  addOfferingDocuments,
  apiErrorSentence,
  attachableDocuments,
  useOfferingUnderEdit,
  type Company,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { CustomModal, ModalActions } from '../../components/modal';
import { CompanyReadNotice, type CompanyRead } from '../company/CompanyState';
import { useCompanyStyles } from '../company-register/styles';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch } from '../../services/sessionScope';
import { DocumentChoices } from './DocumentChoices';
import { OfferingReadNotice } from './OfferingReadNotice';

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
  companyRead: CompanyRead;
  refresh: () => Promise<unknown>;
  onClose: () => void;
}) {
  const styles = useCompanyStyles();
  const detail = useOfferingUnderEdit(uuid);
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
      const response = await addOfferingDocuments(apiClient, uuid, added, { ledovaSessionEpoch: epoch });
      assertSessionEpoch(epoch);
      return response;
    },
    onSuccess: async (_, { epoch }) => {
      assertSessionEpoch(epoch);
      await refresh();
      assertSessionEpoch(epoch);
      onClose();
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
              if (!blocked && addable.length > 0 && !request.isPending)
                request.mutate({ added: addable, epoch: getSessionEpoch() });
            }}
          />
        </ModalActions>
      </View>
    </CustomModal>
  );
}
