import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Text, View, RefreshControl, type ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  companiesAwaitingActivation,
  DESTINATIONS,
  isLedgerTask,
  ownershipSummary,
  REGISTER_COPY,
  useUserPreferences,
  USER_PREFERENCES_QUERY_KEY,
  type LedgerTask,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action, Choice, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { useLedgerNavigation } from '../../navigation/LedgerNavigation';
import { getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { CompanySelection } from '../../components/company/CompanySelection';
import { useCompanyRegister } from '../../hooks/useCompanyRegister';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { useThemedStyles } from '../../contexts';
import { ClassCertificates } from './ClassCertificates';
import { ClassRecords } from './ClassRecords';
import { CreateClassForm } from './CreateClassForm';
import { CompanyLinks } from './CompanyLinks';
import { CompanyMemberAccess } from './CompanyMemberAccess';
import { CompanyPeople } from './CompanyPeople';
import { CompanyPack } from './CompanyPack';
import { GettingStarted } from './GettingStarted';
import { CompanyParticulars } from './CompanyParticulars';
import { ClassSummary } from '../../components/register/ClassSummary';
import { RegisterDownload } from '../../components/register/RegisterDownload';
import { RegisterInspectionCopy } from './RegisterInspectionCopy';
import { useRegisterClassCreation } from './useRegisterClassCreation';

export function CompanyRegisterScreen() {
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  return <CompanyRegister key={epoch} epoch={epoch} />;
}

export type CompanyRegisterSection = 'ledger' | LedgerTask | 'shareholders' | 'awards' | 'documents' | 'company';

const SECTION_TITLES: Record<CompanyRegisterSection, string> = {
  ledger: DESTINATIONS.companyRegister.title,
  ...DESTINATIONS.companyRegister.tasks,
  ...DESTINATIONS.companyRegister.views,
  company: DESTINATIONS.company.title,
};

const CLASS_SECTIONS: readonly CompanyRegisterSection[] = ['issue', 'transfer', 'history', 'corrections'];

const HELD_TASKS: Record<string, LedgerTask> = {
  allotments: 'issue',
  grants: 'issue',
  transfer: 'transfer',
  corrections: 'corrections',
};

const HIDDEN = { display: 'none' } as const;

function CompanyRegister({ epoch }: { epoch: number }) {
  const route = useRoute();
  const params = route.params as
    | { section?: CompanyRegisterSection; companyUuid?: string; tokenUuid?: string }
    | undefined;
  const section = params?.section ?? 'ledger';
  const preferred =
    params?.companyUuid && params.tokenUuid
      ? { companyUuid: params.companyUuid, tokenUuid: params.tokenUuid }
      : undefined;
  const [held, setHeld] = useState<Record<string, boolean>>({});
  const [retained, setRetained] = useState<ReturnType<typeof useCompanyRegister>['company']>();
  const holding = Object.values(held).some(Boolean);
  const { classes, appointments, companies, company, selectCompany, registers, isFetching, refresh } =
    useCompanyRegister(epoch, holding ? retained : undefined, preferred);
  const creation = useRegisterClassCreation(epoch, company?.uuid);
  const [creating, setCreating] = useState<{ uuid: string; name: string } | null>(null);
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
  const peopleHeld = useCallback((value: boolean) => onHeldChange('people', value), [onHeldChange]);
  const companyCorrectionHeld = useCallback(
    (key: string, value: boolean) => onHeldChange(`corrections/company/${key}`, value),
    [onHeldChange],
  );
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
  let ownershipReady = false;
  let ownershipInvalid = false;
  if (sourceReady && company) {
    try {
      if (shownRegisters.length !== company.classes.length)
        throw new Error('The company register did not include every share class.');
      ownershipSummary(shownRegisters);
      ownershipReady = true;
    } catch {
      ownershipInvalid = true;
    }
  }
  const styles = useCompanyStyles();
  const layout = useThemedStyles((theme) => ({ stack: { gap: theme.spacing.lg } }));
  const navigation = useNavigation<NativeStackNavigationProp<CompanyStackParamList>>();
  const routeToken = params?.tokenUuid;
  const [chosenToken, setChosenToken] = useState(routeToken);
  const [seenRouteToken, setSeenRouteToken] = useState(routeToken);
  if (routeToken !== seenRouteToken) {
    setSeenRouteToken(routeToken);
    if (routeToken && !holding) setChosenToken(routeToken);
  }
  const selectedToken = shownRegisters.some(({ token }) => token.uuid === chosenToken)
    ? chosenToken
    : shownRegisters[0]?.token.uuid;
  const heldTask = Object.keys(held)
    .filter((key) => held[key])
    .map((key) => HELD_TASKS[key.split('/')[0] ?? ''])
    .find(Boolean);
  const shownTask = heldTask ?? (isLedgerTask(section) ? section : undefined);
  const shown = shownTask && (section === 'ledger' || isLedgerTask(section)) ? shownTask : section;
  const [peopleOpened, setPeopleOpened] = useState(false);
  if (shown === 'shareholders' && !peopleOpened) setPeopleOpened(true);
  const page = useRef<ScrollView>(null);
  useEffect(() => {
    page.current?.scrollTo({ y: 0, animated: false });
  }, [shown]);
  const { setState: setLedgerNavigation } = useLedgerNavigation();
  useEffect(() => {
    setLedgerNavigation({ task: shownTask, blocked: holding || !sourceReady });
  }, [setLedgerNavigation, shownTask, holding, sourceReady]);
  useEffect(() => () => setLedgerNavigation(null), [setLedgerNavigation]);
  const own = appointments.data ?? [];
  const status = own.find((appointment) => appointment.company === company?.uuid)?.companyStatusDisplay;
  const activated = companiesAwaitingActivation(own).length === 0;
  const registered = shownRegisters.some(({ initialized }) => initialized);
  const gettingStarted =
    shown === 'ledger' &&
    !!company &&
    appointments.isSuccess &&
    classes.isSuccess &&
    registers.isSuccess &&
    own.some(
      (appointment) =>
        appointment.company === company.uuid && appointment.isEffective && appointment.capabilities.includes('admin'),
    ) &&
    (!activated || !registered);
  const unopened = shownRegisters.find(({ initialized }) => !initialized);
  const setUp = () => {
    if (!company || holding) return;
    if (unopened) {
      navigation.setParams({ section: 'corrections', companyUuid: company.uuid, tokenUuid: unopened.token.uuid });
    } else if (company.classes.length === 0 && creation.canPrepare && sourceReady) {
      onHeldChange('class-creation', true);
      setCreating({ uuid: company.uuid, name: company.name });
    }
  };
  return (
    <Page
      ref={page}
      testID="register-screen"
      title={SECTION_TITLES[shown]}
      lede={company ? [company.name, status].filter(Boolean).join(' · ') : undefined}
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
      {gettingStarted && <GettingStarted activated={activated} registered={registered} onSetUp={setUp} />}
      {(classes.isPending || appointments.isPending || (!!company && registers.isPending)) && (
        <Text style={styles.muted}>Loading your register…</Text>
      )}
      {(classes.isError || appointments.isError || registers.isError || preferences?.status === 'error') && (
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
      {ownershipInvalid && (shown === 'ledger' || shown === 'shareholders') && (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            We couldn’t load the complete register.
          </Text>
          <Action label="Retry register" disabled={isFetching} onPress={() => void refreshAll()} />
        </View>
      )}
      {company && held.people && shown !== 'shareholders' && (
        <View style={styles.group}>
          <Text style={styles.muted}>A person save is unfinished. Return to its original form to finish it.</Text>
          <Action label="Return to person form" onPress={() => navigation.setParams({ section: 'shareholders' })} />
        </View>
      )}
      <View style={shown === 'ledger' ? layout.stack : HIDDEN}>
        {company && ownershipReady && company.classes.length === 0 && (
          <Section title="Share classes">
            <Text style={styles.muted}>No share classes yet.</Text>
          </Section>
        )}
        {company &&
          ownershipReady &&
          shownRegisters.map((register) => (
            <Section key={register.token.uuid} title={`${register.token.name} · ${register.token.symbol}`}>
              <ClassSummary register={register} />
              <Action
                label="Class details"
                accessibilityLabel={`Class details (${register.token.name})`}
                disabled={holding}
                onPress={() =>
                  navigation.navigate('TokenDetail', { uuid: register.token.uuid, name: register.token.name })
                }
              />
            </Section>
          ))}
        {company && creation.canPrepare && sourceReady && !holding && (
          <View style={styles.actions}>
            <Action
              primary
              label="Add share class"
              onPress={() => {
                onHeldChange('class-creation', true);
                setCreating({ uuid: company.uuid, name: company.name });
              }}
            />
          </View>
        )}
      </View>
      {company &&
        sourceReady &&
        company.classes.length === 0 &&
        !['ledger', 'shareholders', 'company'].includes(shown) && (
          <Text style={styles.muted}>No share classes recorded for {company.name}.</Text>
        )}
      {company && sourceReady && CLASS_SECTIONS.includes(shown) && shownRegisters.length > 0 && (
        <View style={styles.group}>
          <Text style={styles.muted}>Share class</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Share class" style={styles.choices}>
            {shownRegisters.map(({ token }) => (
              <Choice
                key={token.uuid}
                label={token.name}
                accessibilityRole="radio"
                selected={token.uuid === selectedToken}
                disabled={holding}
                onPress={() => setChosenToken(token.uuid)}
              />
            ))}
          </View>
        </View>
      )}
      {company &&
        shownRegisters.map((register) => {
          const uuid = register.token.uuid;
          return (
            <ClassRecords
              key={uuid}
              epoch={epoch}
              company={company.uuid}
              register={register}
              refreshHolders={registers.refetch}
              sourceReady={sourceReady}
              section={shown}
              selected={uuid === selectedToken}
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
            />
          );
        })}
      {company && (
        <>
          <View style={shown === 'corrections' ? layout.stack : HIDDEN}>
            <CompanyParticulars
              epoch={epoch}
              company={company.uuid}
              registers={sourceReady ? shownRegisters : []}
              sourceReady={sourceReady}
              onHeldChange={companyCorrectionHeld}
              refreshHolders={registers.refetch}
            />
            <CompanyLinks
              epoch={epoch}
              company={company.uuid}
              registers={sourceReady ? shownRegisters : []}
              sourceReady={sourceReady}
              onHeldChange={companyCorrectionHeld}
              refreshHolders={registers.refetch}
              onPrepare={() => navigation.navigate('PrepareRegisterLink', { company: company.uuid })}
            />
          </View>
          <View style={shown === 'documents' && sourceReady ? layout.stack : HIDDEN}>
            {sourceReady && (
              <>
                {shownRegisters.map((register) => (
                  <Section key={register.token.uuid} title={register.token.name}>
                    <ClassCertificates
                      epoch={epoch}
                      company={company.uuid}
                      register={register}
                      sourceReady={sourceReady && appointments.isSuccess && !appointments.isFetching}
                    />
                    <RegisterDownload
                      uuid={register.token.uuid}
                      disabled={!register.initialized || !sourceReady}
                      accessibilityLabel={`${REGISTER_COPY.DOWNLOAD} for ${register.token.name}`}
                    />
                    <RegisterInspectionCopy
                      uuid={register.token.uuid}
                      name={register.token.name}
                      epoch={epoch}
                      disabled={!register.initialized || !sourceReady}
                    />
                  </Section>
                ))}
                <CompanyPack
                  key={`pack/${epoch}/${company.uuid}`}
                  epoch={epoch}
                  company={company.uuid}
                  name={company.name}
                  disabled={!sourceReady}
                />
              </>
            )}
          </View>
          {peopleOpened && (
            <View style={shown === 'shareholders' ? layout.stack : HIDDEN}>
              <CompanyPeople
                key={`people/${epoch}/${company.uuid}`}
                epoch={epoch}
                company={company.uuid}
                registers={shownRegisters}
                sourceReady={sourceReady}
                ready={ownershipReady}
                blocked={holding}
                onHeldChange={peopleHeld}
                onChangeParticulars={(member, token) =>
                  navigation.navigate('PrepareRegisterParticulars', {
                    tokenUuid: token,
                    companyUuid: company.uuid,
                    memberUuid: member,
                  })
                }
              />
            </View>
          )}
          <View style={shown === 'company' ? layout.stack : HIDDEN}>
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
          </View>
        </>
      )}
      {creating && (
        <CreateClassForm
          target={creating}
          read={creation}
          onClose={() => {
            setCreating(null);
            onHeldChange('class-creation', false);
          }}
          onSuccess={refreshAll}
        />
      )}
    </Page>
  );
}
