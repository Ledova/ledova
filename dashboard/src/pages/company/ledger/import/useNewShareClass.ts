import { useRef, useState } from 'react';
import {
  createCompanyToken,
  createUserFriendlyError,
  failureStatus,
  getRegisterClasses,
  getCompanyToken,
  readEveryPage,
  TECHNICAL_SHARE_LIMIT,
  type CompanyShareToken,
  type Company,
  type OrderSubmissionOwner,
  type TokenCreate,
  type TokenType,
  type RegisterTransferMember,
} from '@ledova/shared';

import apiClient from '@services/apiClient';

import { registerSteps } from '@pages/company/shared/proposals';
import { readRegister } from '@pages/company/shared/useCompanyRegister';

import { readPeople } from '@pages/company/ledger/shared/usePeople';
import { canOpenEmptyRegister } from './preparation';

export type FreshClassProps = {
  owner: OrderSubmissionOwner;
  guard: () => void;
  checkCurrent: () => void;
  company: Pick<Company, 'uuid' | 'name'>;
  classes: { uuid: string; name: string; symbol: string; status: string }[];
  companyMembers: RegisterTransferMember[];
  steps: ReturnType<typeof registerSteps>;
  ready: boolean;
  onHeldChange: (held: boolean) => void;
  onConflict: () => void;
};

export function useNewShareClass({
  guard,
  checkCurrent,
  company,
  classes,
  started,
  ready,
}: Pick<FreshClassProps, 'guard' | 'checkCurrent' | 'company' | 'classes' | 'ready'> & {
  started: readonly { uuid: string }[];
}) {
  const [choice, setChoice] = useState('ordinary');
  const [name, setName] = useState('Ordinary shares');
  const [symbol, setSymbol] = useState('ORD');
  const [tokenType, setTokenType] = useState<TokenType>('ordinary');
  const [classLocked, setClassLocked] = useState(false);
  const creation = useRef<{ request: TokenCreate; dispatched: boolean; token?: CompanyShareToken } | null>(null);
  const check = () => {
    guard();
    checkCurrent();
    if (!ready) throw createUserFriendlyError('Refresh current company authority and records before continuing.');
  };
  const resolveRegister = async () => {
    check();
    if (!creation.current) {
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
        return getRegisterClasses(apiClient, { company_uuid: company.uuid, page }, { ledovaSubmissionGuard: check });
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
        )
          throw createUserFriendlyError(
            'This class code already exists. Choose that share class or use its actual distinct code.',
          );
        const { data } = await getCompanyToken(apiClient, existing.uuid, {
          ledovaSubmissionGuard: check,
        });
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
          ({ data } = await createCompanyToken(apiClient, operation.request, { ledovaSubmissionGuard: check }));
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
    const register = await readRegister(token.uuid, guard);
    check();
    const people = await readPeople(token.uuid, check);
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
        : 'This class code already exists. Use a distinct code for a new class.',
    );
  return {
    choice,
    setChoice,
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
