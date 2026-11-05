import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused } from '@react-navigation/native';
import { useMemberRecords, useOwnershipCompanies, type OwnershipCompany, type OwnMemberRecord } from '@ledova/shared';
import { orderSubmissionSession } from '../services/orderSubmissions';

type Read = ReturnType<typeof useMemberRecords>;

interface MemberRecords {
  read: Read;
  directory: ReturnType<typeof useOwnershipCompanies>;
  select: (uuid: string) => void;
  companies: OwnershipCompany[];
  company: OwnershipCompany | undefined;
  companySelection: string | null | undefined;
  member: OwnMemberRecord | undefined;
  selectCompany: (companyUuid: string) => boolean;
}

const MemberRecordsContext = createContext<MemberRecords | null>(null);

export function memberOf(company: OwnershipCompany | undefined, records: OwnMemberRecord[]) {
  return company
    ? records.find((row) => row.company.uuid === company.uuid && company.memberUuids.includes(row.uuid))
    : undefined;
}

export function MemberRecordsProvider({ children }: { children: ReactNode }) {
  const read = useMemberRecords(orderSubmissionSession);
  const directory = useOwnershipCompanies(orderSubmissionSession);
  const busy = read.busy || !!read.retry;
  const { companies, owner } = directory;
  const key = owner ? `ledova.company.${owner.userUuid}.${owner.ownerAccountUuid}` : null;
  const [chosen, setChosen] = useState<{ key: string; company: string | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    const keep = (company: string | null) =>
      live && setChosen((current) => (current?.key === key ? current : { key, company }));
    AsyncStorage.getItem(key).then(keep, () => keep(null));
    return () => {
      live = false;
    };
  }, [key]);
  const remembered = key && chosen?.key === key ? chosen.company : undefined;
  const company =
    remembered === undefined ? undefined : (companies.find((row) => row.uuid === remembered) ?? companies[0]);
  const selectCompany = useCallback(
    (companyUuid: string) => {
      if (!key || busy || !companies.some((row) => row.uuid === companyUuid)) return false;
      if (remembered === companyUuid) return true;
      setChosen({ key, company: companyUuid });
      AsyncStorage.setItem(key, companyUuid).catch(() => undefined);
      return true;
    },
    [key, busy, companies, remembered],
  );
  return (
    <MemberRecordsContext.Provider
      value={{
        read,
        directory,
        select: (uuid) => {
          if (read.busy || read.retry || read.selectedUuid === uuid) return;
          read.select(uuid);
        },
        companies,
        company,
        companySelection: remembered,
        member: memberOf(company, read.records),
        selectCompany,
      }}
    >
      {children}
    </MemberRecordsContext.Provider>
  );
}

export function useMemberRecordsState() {
  const value = useContext(MemberRecordsContext);
  if (!value) throw new Error('Member records need their signed-in provider.');
  return value;
}

export function useCompanyRecord(uuid: string) {
  const state = useMemberRecordsState();
  const { read, select } = state;
  const focused = useIsFocused();
  useEffect(() => {
    if (focused && read.owner && read.records.some((row) => row.uuid === uuid) && !read.busy && !read.retry)
      select(uuid);
  }, [focused, read.owner, read.records, read.busy, read.retry, select, uuid]);
  return {
    ...state,
    focused,
    record: read.records.find((row) => row.uuid === uuid),
    selected: read.record?.uuid === uuid ? read.record : null,
  };
}
