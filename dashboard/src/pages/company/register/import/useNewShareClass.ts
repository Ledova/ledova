import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createCompanyToken,
  createUserFriendlyError,
  failureStatus,
  getCompanyTokens,
  getCompanyToken,
  readEveryPage,
  type CompanyShareToken,
  type Company,
  type OrderSubmissionOwner,
  type TokenCreate,
  type TokenType,
  type RegisterTransferMember,
  useCompanySelection,
} from '@ledova/shared';

import apiClient from '@services/apiClient';

import { registerSteps } from '@pages/company/shared/proposals';
import { readRegister } from '@pages/company/shared/useCompanyRegister';

import { readTransferMembers } from '@pages/company/register/shared/useRegisterTransfers';

const TECHNICAL_SHARE_LIMIT = (2n ** 256n - 1n).toString();

export type FreshClassProps = {
  owner: OrderSubmissionOwner;
  guard: () => void;
  read: ReturnType<typeof useCompanySelection>;
  company: Company;
  classes: { uuid: string; name: string; symbol: string; status: string }[];
  companyMembers: RegisterTransferMember[];
  steps: ReturnType<typeof registerSteps>;
  ready: boolean;
  onHeldChange: (held: boolean) => void;
  onConflict: () => void;
};

export function useNewShareClass({
  guard,
  read,
  company,
  classes,
  ready,
}: Pick<FreshClassProps, 'guard' | 'read' | 'company' | 'classes' | 'ready'>) {
  const navigate = useNavigate();
  const draftClasses = classes.filter((token) => token.status === 'draft');
  const [choice, setChoice] = useState('ordinary');
  const [name, setName] = useState('Ordinary shares');
  const [symbol, setSymbol] = useState('ORD');
  const [tokenType, setTokenType] = useState<TokenType>('ordinary');
  const [classLocked, setClassLocked] = useState(false);
  const creation = useRef<{ request: TokenCreate; dispatched: boolean; token?: CompanyShareToken } | null>(null);
  const check = () => {
    guard();
    read.assertCurrent(company.uuid, 'owner');
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
    try {
      if (!operation.token) {
        const tokens = await readEveryPage((page) => {
          check();
          return getCompanyTokens(apiClient, { company_uuid: company.uuid, page });
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
          const { data } = await createCompanyToken(apiClient, operation.request, { ledovaSubmissionGuard: check });
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
        token.status !== 'draft'
      )
        throw createUserFriendlyError('The share class receipt did not match the requested company and details.');
      const register = await readRegister(token.uuid);
      check();
      const members = await readTransferMembers(token.uuid, check);
      check();
      return { register, members };
    } catch (failure) {
      if (!operation.token && (failureStatus(failure) === 400 || failureStatus(failure) === 409)) {
        creation.current = null;
        setClassLocked(false);
      }
      throw failure;
    }
  };
  const problems = !read.ownerBusiness
    ? ['The company owner creates new share classes. Select an existing class instead.']
    : [];
  if (!name.trim() || name.length > 100) problems.push('Enter a class name of at most 100 characters.');
  if (!/^[A-Z]{1,5}$/.test(symbol)) problems.push('Enter the recorded class code of 1–5 letters, such as A or ORD.');
  const existingCode = classes.find((token) => token.symbol === symbol);
  if (existingCode && !classLocked)
    problems.push(
      existingCode.status === 'draft'
        ? 'This class code already exists. Select the existing draft share class.'
        : 'This class code already exists. Open its register or use the actual distinct code for a new class.',
    );
  return {
    navigate,
    draftClasses,
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
