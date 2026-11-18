import { useRef, useState } from 'react';
import { TECHNICAL_SHARE_LIMIT } from '../constants/business/register';
import { REGISTER_SETUP_CHOICES, REGISTER_SETUP_CLASSES } from '../constants/business/register-imports';
import { createCompanyToken, getCompanyToken, getRegisterClasses } from '../services/company-tokens';
import type { Company, CompanyShareToken, TokenCreate, TokenType } from '../types';
import { createUserFriendlyError, failureStatus } from '../utils/errors';
import { readEveryPage } from '../utils/pagination';
import { canOpenEmptyRegister } from '../utils/register-import-drafts';
import { useApiClient } from './useApiClient';
import { readPeople } from './usePeople';
import { readRegister } from './useRegisters';
import type { OrderSubmissionSession } from './useSubmissionOwner';

type NewShareClassOptions = {
  guard: () => void;
  checkCurrent: () => void;
  company: Pick<Company, 'uuid' | 'name'>;
  classes: { uuid: string; name: string; symbol: string; status: string }[];
  started: readonly { uuid: string }[];
  ready: boolean;
  session?: OrderSubmissionSession;
};

export function useNewShareClass({
  guard,
  checkCurrent,
  company,
  classes,
  started,
  ready,
  session,
}: NewShareClassOptions) {
  const apiClient = useApiClient();
  const [picked, setPicked] = useState<string>();
  const [customName, setName] = useState('');
  const [customSymbol, setSymbol] = useState('');
  const [customType, setTokenType] = useState<TokenType>('ordinary');
  const [classLocked, setClassLocked] = useState(false);
  const used = (code: string) => classes.some((token) => token.symbol === code);
  const choice = picked ?? REGISTER_SETUP_CLASSES.find((item) => !used(item.symbol))?.type ?? 'custom';
  const preset = REGISTER_SETUP_CLASSES.find((item) => item.type === choice);
  const name = preset?.name ?? customName;
  const symbol = preset?.symbol ?? customSymbol;
  const tokenType = preset?.type ?? customType;
  const choices = REGISTER_SETUP_CHOICES.filter(
    ([value]) => value === choice || !REGISTER_SETUP_CLASSES.some((item) => item.type === value && used(item.symbol)),
  );
  const creation = useRef<{ request: TokenCreate; dispatched: boolean; token?: CompanyShareToken } | null>(null);
  const check = () => {
    guard();
    checkCurrent();
    if (!ready) throw createUserFriendlyError('Refresh current company authority and records before continuing.');
  };
  const config = () => ({ ...session?.requestConfig(), ledovaSubmissionGuard: check });
  const choose = (selected: string) => setPicked(selected);
  const resolveRegister = async () => {
    check();
    if (!creation.current) {
      setPicked(choice);
      setClassLocked(true);
      creation.current = {
        request: {
          company: company.uuid,
          name: name.trim(),
          symbol: symbol.trim(),
          tokenType,
          totalSupply: TECHNICAL_SHARE_LIMIT,
        },
        dispatched: false,
      };
    }
    const operation = creation.current;
    if (!operation.token) {
      const tokens = await readEveryPage((page) => {
        check();
        return getRegisterClasses(apiClient, { company_uuid: company.uuid, page }, config());
      });
      check();
      const existing = tokens.find((token) => token.symbol === operation.request.symbol);
      if (existing) {
        if (
          !operation.dispatched ||
          existing.companyUuid !== company.uuid ||
          existing.name !== operation.request.name ||
          existing.tokenType !== operation.request.tokenType ||
          existing.totalSupply !== operation.request.totalSupply
        ) {
          if (!operation.dispatched) {
            creation.current = null;
            setClassLocked(false);
          }
          throw createUserFriendlyError(
            'This class code already exists. Choose that share class or use its actual distinct code.',
          );
        }
        const { data } = await getCompanyToken(apiClient, existing.uuid, config());
        check();
        operation.token = data;
      } else {
        if (operation.dispatched)
          throw createUserFriendlyError(
            'The original class creation result is still uncertain. Refresh and recover it once the class is available; no second creation request will be sent.',
          );
        operation.dispatched = true;
        let data: CompanyShareToken;
        try {
          ({ data } = await createCompanyToken(apiClient, operation.request, config()));
        } catch (failure) {
          if (failureStatus(failure) === 400 || failureStatus(failure) === 409) {
            creation.current = null;
            setClassLocked(false);
          }
          throw failure;
        }
        check();
        operation.token = data;
      }
    }
    const token = operation.token;
    if (
      token.company !== company.uuid ||
      token.name !== operation.request.name ||
      token.symbol !== operation.request.symbol ||
      token.tokenType !== operation.request.tokenType ||
      token.totalSupply !== operation.request.totalSupply ||
      token.contractAddress ||
      token.chain ||
      token.deployedAt ||
      token.deploymentTxHash ||
      token.status !== 'draft'
    )
      throw createUserFriendlyError('The share class receipt did not match the requested company and details.');
    const register = await readRegister(apiClient, token.uuid, guard, session);
    check();
    const people = await readPeople(apiClient, token.uuid, check, session);
    check();
    return { register, members: people.members, emptyOpeningAllowed: canOpenEmptyRegister(register, token) };
  };
  const problems: string[] = [];
  if (!name.trim() || name.length > 100) problems.push('Enter a class name of at most 100 characters.');
  if (!/^[A-Z]{1,5}$/.test(symbol)) problems.push('Enter the recorded class code of 1–5 letters, such as A or ORD.');
  const existingCode = classes.find((token) => token.symbol === symbol);
  if (existingCode && !classLocked)
    problems.push(
      started.some(({ uuid }) => uuid === existingCode.uuid)
        ? 'This class code already exists. Continue it from “Continue a class you started”.'
        : preset
          ? 'This class code already exists. Start with another class.'
          : 'This class code already exists. Use a distinct code for a new class.',
    );
  return {
    choice,
    choices,
    choose,
    name,
    setName,
    symbol,
    setSymbol,
    tokenType,
    setTokenType,
    classLocked,
    check,
    resolveRegister,
    problems,
  } as const;
}
