import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Text, View, RefreshControl, Pressable } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  formatShareCount,
  REGISTER_COPY,
  useUserPreferences,
  USER_PREFERENCES_QUERY_KEY,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action, Choice, LinkRow, Row, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { CompanySelection } from '../company/CompanySelection';
import { useCompanyRegister } from './useCompanyRegister';
import { useCompanyStyles } from './styles';
import { ClassRecords } from './ClassRecords';
import { CompanyLinks } from './CompanyLinks';
import { CompanyMemberAccess } from './CompanyMemberAccess';
import { CompanyPack } from './CompanyPack';
import { CompanyParticulars } from './CompanyParticulars';
import { RegisterDownload } from './RegisterDownload';
import { RegisterInspectionCopy } from './RegisterInspectionCopy';

export function CompanyRegisterScreen() {
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  return <CompanyRegister key={epoch} epoch={epoch} />;
}

export type CompanyRegisterSection = 'register' | 'awards' | 'documents' | 'company';

function CompanyRegister({ epoch }: { epoch: number }) {
  const route = useRoute();
  const params = route.params as
    | { section?: CompanyRegisterSection; companyUuid?: string; tokenUuid?: string }
    | undefined;
  const section = params?.section ?? 'register';
  const preferred =
    params?.companyUuid && params.tokenUuid
      ? { companyUuid: params.companyUuid, tokenUuid: params.tokenUuid }
      : undefined;
  const [held, setHeld] = useState<Record<string, boolean>>({});
  const [retained, setRetained] = useState<ReturnType<typeof useCompanyRegister>['company']>();
  const holding = Object.values(held).some(Boolean);
  const { classes, companies, company, selectCompany, registers, isFetching, refresh } = useCompanyRegister(
    epoch,
    holding ? retained : undefined,
    preferred,
  );
  const currentCompany = useRef(company);
  useLayoutEffect(() => {
    currentCompany.current = company;
  }, [company]);
  const heldFlags = useRef<Record<string, boolean>>({});
  const onHeldChange = useCallback((key: string, value: boolean) => {
    if (heldFlags.current[key] === value) return;
    const next = { ...heldFlags.current, [key]: value };
    heldFlags.current = next;
    if (value) setRetained((previous) => previous ?? currentCompany.current);
    else if (!Object.values(next).some(Boolean)) setRetained(undefined);
    setHeld(next);
  }, []);
  const memberHeld = useCallback((value: boolean) => onHeldChange('members', value), [onHeldChange]);
  const client = useQueryClient();
  const preferenceRead = useUserPreferences();
  const refreshAll = () => Promise.all([preferenceRead.refetch(), refresh()]);
  const preferences = client.getQueryState(USER_PREFERENCES_QUERY_KEY);
  const sourceReady =
    preferences?.status === 'success' &&
    preferences.fetchStatus === 'idle' &&
    classes.isSuccess &&
    registers.isSuccess &&
    !isFetching &&
    !!company &&
    company.classes.every((token) =>
      classes.data.some((item) => item.uuid === token.uuid && item.companyUuid === company.uuid),
    );
  const shownRegisters: TokenHoldersResponse[] = registers.data ?? [];
  const styles = useCompanyStyles();
  const navigation = useNavigation<NativeStackNavigationProp<CompanyStackParamList>>();
  const [expanded, setExpanded] = useState<string[]>([]);
  return (
    <Page
      testID="register-screen"
      title={{ register: 'Register', awards: 'Employee awards', documents: 'Documents', company: 'Company' }[section]}
      refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => void refreshAll()} />}
    >
      {classes.isSuccess && !classes.isFetching && preferences?.status === 'success' && (
        <CompanySelection
          read={{
            companies,
            companyUuid: company?.uuid,
            selectionBlocked: isFetching || holding,
            selectCompany: (uuid) => {
              navigation.setParams({ companyUuid: undefined, tokenUuid: undefined });
              selectCompany(uuid);
            },
          }}
        />
      )}
      <View style={styles.choices}>
        {(['register', 'awards', 'documents', 'company'] as const).map((value) => (
          <Choice
            key={value}
            label={
              { register: 'Register', awards: 'Employee awards', documents: 'Documents', company: 'Company' }[value]
            }
            selected={section === value}
            onPress={() => navigation.setParams({ section: value })}
          />
        ))}
      </View>
      {(classes.isPending || registers.isPending) && <Text style={styles.muted}>Loading your register…</Text>}
      {(classes.isError || registers.isError || preferences?.status === 'error') && (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            We couldn’t load the complete register.
          </Text>
          <Action label="Retry register" disabled={isFetching} onPress={() => void refreshAll()} />
        </View>
      )}
      {classes.isSuccess && !classes.isFetching && companies.length === 0 && (
        <Text style={styles.muted}>{REGISTER_COPY.NO_REGISTER}</Text>
      )}
      {!company && companies.length > 0 && !classes.isPending && (
        <Text style={styles.muted}>Choose a company above.</Text>
      )}
      <View style={section === 'company' ? { display: 'none' } : undefined}>
        <Section title="Share classes">
          {company &&
            shownRegisters.map((register, index) => {
              const uuid = register.token.uuid;
              const open =
                expanded.includes(uuid) || (preferred?.companyUuid === company.uuid && preferred.tokenUuid === uuid);
              return (
                <View key={uuid} style={[styles.entry, index === shownRegisters.length - 1 && styles.lastEntry]}>
                  {sourceReady && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      accessibilityLabel={`${register.token.name} register`}
                      onPress={() =>
                        setExpanded((values) => (open ? values.filter((value) => value !== uuid) : [...values, uuid]))
                      }
                    >
                      <Text style={styles.heading}>{register.token.name}</Text>
                      <Text style={styles.muted}>
                        {company.name} · {register.token.symbol}
                      </Text>
                      <Text style={styles.muted}>{open ? 'Hide details' : 'Show details'}</Text>
                    </Pressable>
                  )}
                  {sourceReady && section === 'register' && (
                    <Rows>
                      <Row label="Issued shares">
                        {register.issuedSupply === null ? 'Not recorded' : formatShareCount(register.issuedSupply)}
                      </Row>
                    </Rows>
                  )}
                  {sourceReady && (
                    <LinkRow
                      label="Share class"
                      accessibilityLabel={`Open ${register.token.name}`}
                      onPress={() => navigation.navigate('TokenDetail', { uuid, name: register.token.name })}
                    />
                  )}
                  <View style={open || section !== 'register' ? undefined : { display: 'none' }}>
                    <View style={section === 'documents' && sourceReady ? styles.group : { display: 'none' }}>
                      {sourceReady && (
                        <>
                          <RegisterDownload
                            uuid={uuid}
                            disabled={!register.initialized || !sourceReady}
                            accessibilityLabel={`${REGISTER_COPY.DOWNLOAD} for ${register.token.name}`}
                          />
                          <RegisterInspectionCopy
                            uuid={uuid}
                            name={register.token.name}
                            epoch={epoch}
                            disabled={!register.initialized || !sourceReady}
                          />
                        </>
                      )}
                    </View>
                    <ClassRecords
                      epoch={epoch}
                      company={company.uuid}
                      register={register}
                      refreshHolders={registers.refetch}
                      sourceReady={sourceReady}
                      section={section}
                      onHeldChange={onHeldChange}
                      onPrepareAwardGrant={(awardUuid) =>
                        navigation.navigate('PrepareRegisterGrant', {
                          tokenUuid: uuid,
                          companyUuid: company.uuid,
                          awardUuid,
                        })
                      }
                      onOpen={() =>
                        navigation.navigate('PrepareRegisterOpening', { tokenUuid: uuid, companyUuid: company.uuid })
                      }
                      onPrepareImport={(correctionOf) =>
                        navigation.navigate('PrepareRegisterImport', {
                          tokenUuid: uuid,
                          companyUuid: company.uuid,
                          correctionOf,
                        })
                      }
                      onPrepareGrant={() =>
                        navigation.navigate('PrepareRegisterGrant', { tokenUuid: uuid, companyUuid: company.uuid })
                      }
                      onPrepareTransfer={() =>
                        navigation.navigate('PrepareRegisterTransfer', { tokenUuid: uuid, companyUuid: company.uuid })
                      }
                      onCorrect={(entry) =>
                        navigation.navigate('PrepareRegisterCorrection', {
                          tokenUuid: uuid,
                          companyUuid: company.uuid,
                          entryUuid: entry.uuid,
                        })
                      }
                      onChangeParticulars={(member) =>
                        navigation.navigate('PrepareRegisterParticulars', {
                          tokenUuid: uuid,
                          companyUuid: company.uuid,
                          memberUuid: member,
                        })
                      }
                    />
                  </View>
                </View>
              );
            })}
        </Section>
      </View>
      {company && (
        <>
          <View style={section === 'documents' && sourceReady ? undefined : { display: 'none' }}>
            {sourceReady && (
              <CompanyPack
                key={`pack/${epoch}/${company.uuid}`}
                epoch={epoch}
                company={company.uuid}
                name={company.name}
                disabled={!sourceReady}
              />
            )}
          </View>
          <View style={section === 'company' ? undefined : { display: 'none' }}>
            {sourceReady && (
              <Action
                label="Company information and team"
                disabled={holding}
                onPress={() => navigation.getParent()?.navigate('Company', { screen: 'CompanyDetails' })}
              />
            )}
            <CompanyMemberAccess
              key={`members/${epoch}/${company.uuid}`}
              epoch={epoch}
              company={company.uuid}
              sourceReady={sourceReady}
              registers={sourceReady ? shownRegisters : []}
              onHeldChange={memberHeld}
            />
            <>
              <CompanyParticulars
                epoch={epoch}
                company={company.uuid}
                registers={sourceReady ? shownRegisters : []}
                sourceReady={sourceReady}
                onHeldChange={onHeldChange}
                refreshHolders={registers.refetch}
              />
              <CompanyLinks
                epoch={epoch}
                company={company.uuid}
                registers={sourceReady ? shownRegisters : []}
                sourceReady={sourceReady}
                onHeldChange={onHeldChange}
                refreshHolders={registers.refetch}
                onPrepare={() => navigation.navigate('PrepareRegisterLink', { company: company.uuid })}
              />
            </>
          </View>
        </>
      )}
    </Page>
  );
}
