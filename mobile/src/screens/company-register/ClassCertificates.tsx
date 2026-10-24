import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import {
  formatDate,
  formatRegisterChanges,
  hasCurrentRegisterReadAuthority,
  useSubmissionOwner,
  USER_PREFERENCES_QUERY_KEY,
  REGISTER_CORRECTION_COPY as COPY,
  type OwnCompanyAppointment,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { registerAppointmentsKey, useRegisterEntries } from '../../hooks/useCompanyRegister';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { RegisterCertificate } from './RegisterCertificate';

export function ClassCertificates({
  epoch,
  company,
  register,
  sourceReady,
}: {
  epoch: number;
  company: string;
  register: TokenHoldersResponse;
  sourceReady: boolean;
}) {
  const styles = useCompanyStyles();
  const client = useQueryClient();
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const certificateGuard = () => {
    const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
    const state = client.getQueryState<OwnCompanyAppointment[]>(registerAppointmentsKey(epoch));
    if (
      !owner ||
      boundary.get() !== owner ||
      preferences?.status !== 'success' ||
      preferences.fetchStatus !== 'idle' ||
      state?.status !== 'success' ||
      state.fetchStatus !== 'idle' ||
      !hasCurrentRegisterReadAuthority(state.data ?? [], company)
    )
      throw new Error('Refresh current company register authority before preparing a certificate.');
  };
  const name = register.token.name;
  const { entries, listed, hasError, moreFailed, loadMore } = useRegisterEntries(epoch, register.token.uuid);
  const eligible = listed.filter(
    ({ kind, correctedBy }) => ['issue', 'transfer'].includes(kind) && correctedBy === null,
  );
  const more = entries.isFetchingNextPage ? 'Loading entries…' : 'Load more entries';
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        Certificates
      </Text>
      {entries.isPending ? (
        <Text style={styles.muted}>Loading register entries…</Text>
      ) : hasError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            The register entries could not be loaded.
          </Text>
          <Action
            label="Retry register entries"
            accessibilityLabel={`Retry register entries for ${name} certificates`}
            disabled={entries.isFetching}
            onPress={() => void entries.refetch()}
          />
        </View>
      ) : (
        <>
          {eligible.length === 0 && (
            <Text style={styles.muted}>No eligible issues or transfers in the loaded records.</Text>
          )}
          {eligible.map((entry, index) => (
            <View key={entry.uuid} style={[styles.entry, index === eligible.length - 1 && styles.lastEntry]}>
              <Text style={styles.heading}>
                Entry {entry.sequence} · {COPY.ENTRY_KINDS[entry.kind]}
              </Text>
              <Text style={styles.muted}>
                Company event date {entry.companyEventOn ? formatDate(entry.companyEventOn) : 'Not recorded'}
              </Text>
              {formatRegisterChanges(entry.changes).map((line, number) => (
                <Text key={number} style={styles.text}>
                  {line}
                </Text>
              ))}
              <RegisterCertificate
                epoch={epoch}
                register={register}
                entry={entry}
                disabled={!sourceReady || entries.isFetching || moreFailed}
                authorityGuard={certificateGuard}
              />
            </View>
          ))}
          {moreFailed ? (
            <View style={styles.group}>
              <Text accessibilityRole="alert" style={styles.error}>
                More register entries could not be loaded. The certificates above are incomplete.
              </Text>
              <Action
                label="Try more entries again"
                accessibilityLabel={`Try more entries again for ${name} certificates`}
                disabled={entries.isFetching}
                onPress={() => void loadMore()}
              />
            </View>
          ) : (
            entries.hasNextPage && (
              <Action
                label={more}
                accessibilityLabel={`${more} for ${name} certificates`}
                disabled={entries.isFetching}
                onPress={() => void loadMore()}
              />
            )
          )}
        </>
      )}
    </View>
  );
}
