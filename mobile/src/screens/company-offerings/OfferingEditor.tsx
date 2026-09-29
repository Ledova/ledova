import { Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { apiErrorSentence, createOffering, updateOffering, type Company, type OfferingInput } from '@ledova/shared';
import { CustomModal } from '../../components/modal';
import { CompanyReadNotice, type CompanyRead } from '../company/CompanyState';
import { useCompanyStyles } from '../company-register/styles';
import { apiClient } from '../../services/apiClient';
import { assertSessionEpoch, getSessionEpoch } from '../../services/sessionScope';
import { OfferingForm } from './OfferingForm';
import { OfferingReadNotice } from './OfferingReadNotice';
import { useOfferingUnderEdit, type useOfferings } from './useOfferings';

export function OfferingEditor({
  uuid,
  targetCompany,
  company,
  companyRead,
  data,
  onClose,
}: {
  uuid?: string;
  targetCompany: string;
  company: Company | null;
  companyRead: CompanyRead;
  data: ReturnType<typeof useOfferings>;
  onClose: () => void;
}) {
  const styles = useCompanyStyles();
  const detail = useOfferingUnderEdit(uuid);
  const belongs = company?.uuid === targetCompany;
  const editable =
    !uuid || (detail.data?.canBeEdited && data.tokens.some((token) => token.uuid === detail.data?.tokenUuid));
  const blocked =
    !belongs ||
    !editable ||
    !!companyRead.error ||
    companyRead.isRefreshing ||
    !!data.error ||
    data.isRefreshing ||
    (uuid !== undefined && (detail.isError || detail.isFetching));
  const request = useMutation({
    mutationFn: async ({ input, epoch }: { input: OfferingInput; epoch: number }) => {
      assertSessionEpoch(epoch);
      const config = { ledovaSessionEpoch: epoch };
      const response = await (uuid
        ? updateOffering(apiClient, uuid, input, config)
        : createOffering(apiClient, input, config));
      assertSessionEpoch(epoch);
      return response;
    },
    onSuccess: async (_, { epoch }) => {
      assertSessionEpoch(epoch);
      await data.refresh();
      assertSessionEpoch(epoch);
      onClose();
    },
  });
  const close = () => {
    if (!request.isPending) onClose();
  };
  return (
    <CustomModal visible title={uuid ? 'Edit offering' : 'New offering'} onClose={close} busy={request.isPending}>
      <View style={styles.group}>
        <CompanyReadNotice read={companyRead} />
        <OfferingReadNotice read={data} />
        {uuid && (
          <OfferingReadNotice
            read={{ error: detail.error, isRefreshing: detail.isFetching, refetch: detail.refetch }}
            label="Current offering"
          />
        )}
        {!belongs && (
          <Text accessibilityRole="alert" style={styles.error}>
            This draft belongs to a company that is no longer selected.
          </Text>
        )}
        {uuid && detail.data && !editable && !detail.isFetching && !detail.isError && (
          <Text accessibilityRole="alert" style={styles.error}>
            This offering can no longer be edited.
          </Text>
        )}
        {(!uuid || detail.data) && (
          <OfferingForm
            tokens={data.tokens.filter((token) =>
              uuid ? token.uuid === detail.data?.tokenUuid : token.status === 'deployed',
            )}
            busy={request.isPending}
            error={
              request.isError && request.variables?.epoch === getSessionEpoch()
                ? apiErrorSentence(request.error, 'The offering could not be saved. Try again.')
                : undefined
            }
            blocked={blocked}
            settlementAssets={data.settlementAssets}
            operatorName={data.operatorName}
            editing={uuid ? detail.data : undefined}
            onSubmit={(input) => {
              if (!blocked && !request.isPending) request.mutate({ input, epoch: getSessionEpoch() });
            }}
            onClose={close}
          />
        )}
      </View>
    </CustomModal>
  );
}
