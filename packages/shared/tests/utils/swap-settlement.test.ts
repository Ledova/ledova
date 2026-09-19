import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { SavedSwapSettlement } from '../../src/utils/swap-settlement-storage';
import type { SwapSettlementResponse } from '../../src/types';
import { SwapSettlement } from '../../src/utils/swap-settlement';
import { createSwapSettlementStore } from '../../src/utils/swap-settlement-storage';
import { swapSettlementIdentity } from '../../src/utils/swap-settlement-validation';
import { deferred, memoryStorage, response as reply } from '../fixtures/order-submissions';
import {
  approvalHash,
  approvalRaw,
  settlementApproval,
  settlementCrypto,
  settlementFixture,
  settlementNow,
  settlementOwner,
  settlementResponse,
} from '../fixtures/swap-settlements';

function setup(response = settlementResponse()) {
  const { storage, values } = memoryStorage();
  const store = createSwapSettlementStore(storage);
  const api = axios.create();
  const crypto = settlementCrypto(response);
  const requests: InternalAxiosRequestConfig[] = [];
  let current = true;
  let handler = async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => reply(config, response);
  api.interceptors.request.use((config) => {
    config.ledovaSubmissionGuard?.();
    return config;
  });
  api.defaults.adapter = async (config) => {
    requests.push(config);
    const result = await handler(config);
    return { ...result, data: JSON.stringify(result.data) };
  };
  const changed = jest.fn();
  const updated = jest.fn();
  const dependencies = {
    apiClient: api,
    crypto,
    store,
    isCurrent: () => current,
    onRecordsChanged: changed,
    onUpdated: updated,
  };
  const controller = new SwapSettlement(
    settlementOwner,
    {
      ...swapSettlementIdentity(response),
      walletAddress: response.swapOrder.settlementContext[response.userRole].address,
    },
    dependencies,
  );
  return {
    response,
    controller,
    api,
    store,
    storage,
    values,
    crypto,
    requests,
    changed,
    updated,
    dependencies,
    handle: (next: typeof handler) => {
      handler = next;
    },
    retire: () => {
      current = false;
    },
  };
}

function failed(config: InternalAxiosRequestConfig, status: number, data: unknown): never {
  throw new AxiosError('Synthetic failed response', String(status), config, undefined, reply(config, data, status));
}

function signedResponse(initial: SwapSettlementResponse, signer: 'seller' | 'buyer') {
  const value = JSON.parse(JSON.stringify(initial)) as SwapSettlementResponse;
  value.swapOrder[signer === 'seller' ? 'sellerHasSigned' : 'buyerHasSigned'] = true;
  value.swapOrder.status = signer === 'seller' ? 'seller_signed' : 'buyer_signed';
  value.hasSigned = value.userRole === signer;
  value.canSign = !value.hasSigned;
  return value;
}

function signatureRecord(
  response = settlementResponse(),
  signerAddress = settlementFixture.addresses[0]!,
): SavedSwapSettlement {
  return {
    version: 1,
    ...settlementOwner,
    ...swapSettlementIdentity(response),
    kind: 'signature',
    signerAddress: signerAddress.toLowerCase(),
  };
}

function approvalResult(response = settlementResponse()) {
  return {
    ...swapSettlementIdentity(response),
    userRole: response.userRole,
    txHash: approvalHash,
    blockNumber: 7,
    gasUsed: 42000,
  };
}

function approvalRecord(response = settlementResponse()): SavedSwapSettlement {
  return {
    version: 1,
    ...settlementOwner,
    ...swapSettlementIdentity(response),
    kind: 'approval',
    txHash: approvalHash,
  };
}

test.each(['confirmed', 'reverted', 'superseded'])(
  'saved original %s approval recovers after restart without another broadcast',
  async (outcome) => {
    const f = setup();
    await f.store.save(approvalRecord());
    f.handle(async (config) => {
      if (config.params?.approval_tx_hash) {
        expect(config.params.approval_tx_hash).toBe(approvalHash);
        return reply(config, { ...f.response, approvalOutcome: { txHash: approvalHash, outcome } });
      }
      return reply(config, f.response);
    });
    await f.controller.recover();
    expect(f.controller.getSnapshot().error).toBeNull();
    expect(await f.store.list(settlementOwner)).toEqual([]);
    expect(f.controller.getSnapshot().unconfirmedApprovalHashes).toEqual([]);
    expect(f.controller.getSnapshot().approvalOutcomes).toEqual([{ txHash: approvalHash, outcome }]);
    expect(f.requests.filter((request) => request.params?.approval_tx_hash)).toHaveLength(1);
    expect(f.requests.every((request) => request.method === 'get')).toBe(true);
  },
);

test.each([
  ['pending', { txHash: approvalHash, outcome: 'pending' }],
  ['missing', null],
  ['older server', undefined],
])('%s original approval evidence retains its saved reminder', async (_label, approvalOutcome) => {
  const f = setup();
  await f.store.save(approvalRecord());
  f.handle(async (config) => reply(config, { ...f.response, approvalOutcome }));
  await f.controller.recover();
  expect(f.controller.getSnapshot().error).toBeNull();
  expect(f.controller.getSnapshot().unconfirmedApprovalHashes).toEqual([approvalHash]);
  expect(f.controller.getSnapshot().approvalOutcomes).toEqual([]);
  expect(await f.store.list(settlementOwner)).toEqual([approvalRecord()]);
  expect(f.requests.every((request) => request.method === 'get')).toBe(true);
});

test.each([
  ['foreign hash', { approvalOutcome: { txHash: '0x' + 'cd'.repeat(32), outcome: 'confirmed' } }],
  ['malformed hash', { approvalOutcome: { txHash: '0x12', outcome: 'confirmed' } }],
  ['unknown outcome', { approvalOutcome: { txHash: approvalHash, outcome: 'available' } }],
  ['missing outcome', { approvalOutcome: { txHash: approvalHash } }],
  ['malformed outcome', { approvalOutcome: 'confirmed' }],
  ['foreign owner', { ownerAccountUuid: '20000000-0000-4000-8000-000000000001' }],
  ['foreign wallet', { walletUuid: '20000000-0000-4000-8000-000000000002' }],
  ['foreign digest', { settlementDigest: '0x' + 'cd'.repeat(32) }],
])('%s recovery evidence cannot clear an approval', async (_label, changes) => {
  const f = setup();
  await f.store.save(approvalRecord());
  f.handle(async (config) =>
    reply(
      config,
      config.params?.approval_tx_hash
        ? { ...f.response, approvalOutcome: { txHash: approvalHash, outcome: 'confirmed' }, ...changes }
        : f.response,
    ),
  );
  await f.controller.recover();
  expect(f.controller.getSnapshot().error).not.toBeNull();
  expect(f.controller.getSnapshot().unconfirmedApprovalHashes).toEqual([approvalHash]);
  expect(f.controller.getSnapshot().approvalOutcomes).toEqual([]);
  expect(await f.store.list(settlementOwner)).toEqual([approvalRecord()]);
});

test.each(['transport', 'status'])('%s recovery failure preserves the original approval', async (failure) => {
  const f = setup();
  await f.store.save(approvalRecord());
  f.handle(async (config) => {
    if (!config.params?.approval_tx_hash) return reply(config, f.response);
    if (failure === 'transport') throw new Error('Synthetic recovery outage');
    return reply(config, { ...f.response, approvalOutcome: { txHash: approvalHash, outcome: 'confirmed' } }, 503);
  });
  await f.controller.recover();
  expect(f.controller.getSnapshot().error).not.toBeNull();
  expect(await f.store.list(settlementOwner)).toEqual([approvalRecord()]);
});

test('a retired recovery response cannot publish or clear its original approval', async () => {
  const f = setup();
  await f.store.save(approvalRecord());
  const started = deferred<void>();
  const held = deferred<void>();
  f.handle(async (config) => {
    if (!config.params?.approval_tx_hash) return reply(config, f.response);
    started.resolve();
    await held.promise;
    return reply(config, { ...f.response, approvalOutcome: { txHash: approvalHash, outcome: 'confirmed' } });
  });
  const pending = f.controller.recover();
  await started.promise;
  expect(f.controller.getSnapshot().phase).toBe('loading');
  f.retire();
  held.resolve();
  await pending;
  expect(f.controller.getSnapshot().approvalOutcomes).toEqual([]);
  expect(await f.store.list(settlementOwner)).toEqual([approvalRecord()]);
});

test('recovery clears only the matching definite approval and preserves other hashes and contexts', async () => {
  const f = setup();
  const pending = { ...approvalRecord(), kind: 'approval' as const, txHash: '0x' + 'cd'.repeat(32) };
  const other = { ...approvalRecord(), swapUuid: '20000000-0000-4000-8000-000000000003' };
  for (const record of [approvalRecord(), pending, other]) await f.store.save(record);
  f.handle(async (config) =>
    reply(config, {
      ...f.response,
      ...(config.params?.approval_tx_hash
        ? {
            approvalOutcome: {
              txHash: config.params.approval_tx_hash,
              outcome: config.params.approval_tx_hash === approvalHash ? 'confirmed' : 'pending',
            },
          }
        : {}),
    }),
  );
  await f.controller.recover();
  expect(f.controller.getSnapshot().error).toBeNull();
  expect(f.controller.getSnapshot().unconfirmedApprovalHashes).toEqual([pending.txHash]);
  expect(await f.store.list(settlementOwner)).toEqual(expect.arrayContaining([pending, other]));
  expect(await f.store.list(settlementOwner)).toHaveLength(2);
  expect(f.requests.filter((request) => request.params?.approval_tx_hash)).toHaveLength(2);
});

test('a definite approval survives reminder removal failure and can be recovered again', async () => {
  const f = setup();
  await f.store.save(approvalRecord());
  f.handle(async (config) =>
    reply(config, { ...f.response, approvalOutcome: { txHash: approvalHash, outcome: 'reverted' } }),
  );
  jest.spyOn(f.store, 'remove').mockRejectedValueOnce(new Error('Synthetic storage failure'));
  await f.controller.recover();
  expect(f.controller.getSnapshot().approvalOutcomes).toEqual([{ txHash: approvalHash, outcome: 'reverted' }]);
  expect(f.controller.getSnapshot().notice).toMatch(/saved reminder could not be cleared/);
  expect(f.controller.getSnapshot().unconfirmedApprovalHashes).toEqual([approvalHash]);
  expect(await f.store.list(settlementOwner)).toEqual([approvalRecord()]);
  await f.controller.recover();
  expect(f.controller.getSnapshot().unconfirmedApprovalHashes).toEqual([]);
  expect(await f.store.list(settlementOwner)).toEqual([]);
  expect(f.requests.every((request) => request.method === 'get')).toBe(true);
});

test('recovering a definite original outcome clears the live 503 banner and permits fresh review', async () => {
  const f = setup();
  f.handle(async (config) => {
    if (config.method === 'post')
      return failed(config, 503, {
        ...swapSettlementIdentity(f.response),
        userRole: f.response.userRole,
        txHash: approvalHash,
        code: 'swap_approval_unconfirmed',
        detail: 'Unavailable',
      });
    if (config.url?.endsWith('approval-data/')) return reply(config, settlementApproval());
    if (config.params?.approval_tx_hash)
      return reply(config, { ...f.response, approvalOutcome: { txHash: approvalHash, outcome: 'reverted' } });
    return reply(config, f.response);
  });
  await f.controller.load();
  await f.controller.prepareApproval();
  await f.controller.broadcastApproval(approvalRaw);
  expect(f.controller.getSnapshot().approvalResult).toMatchObject({ code: 'swap_approval_unconfirmed' });
  await f.controller.recover();
  expect(f.controller.getSnapshot().approvalResult).toBeNull();
  expect(f.controller.getSnapshot().notice).toBeNull();
  expect(f.controller.getSnapshot().approvalOutcomes).toEqual([{ txHash: approvalHash, outcome: 'reverted' }]);
  await f.controller.prepareApproval();
  expect(f.controller.getSnapshot().phase).toBe('approval-ready');
  expect(f.requests.filter((request) => request.method === 'post')).toHaveLength(1);
});

test('expired saved settlements can resolve approvals without admitting new signing', async () => {
  const response = { ...settlementResponse(), canSign: false, admissionRefusal: 'swap_expired' };
  const f = setup(response);
  await f.store.save(approvalRecord(response));
  f.handle(async (config) =>
    reply(config, { ...response, approvalOutcome: { txHash: approvalHash, outcome: 'confirmed' } }),
  );
  await f.controller.recover();
  expect(await f.store.list(settlementOwner)).toEqual([]);
  expect(f.controller.getSnapshot().response!.canSign).toBe(false);
  const signer = jest.fn();
  await f.controller.sign(signer);
  expect(signer).not.toHaveBeenCalled();
  expect(f.requests.every((request) => request.method === 'get')).toBe(true);
});

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(settlementNow);
});
afterEach(() => {
  jest.restoreAllMocks();
});

test('exact API context preserves large uint strings and frozen captured review across local signing', async () => {
  const f = setup();
  await f.controller.load();
  expect(f.controller.getSnapshot().response!.typedData.message.shareAmount).toBe('9007199254740993');
  expect(f.response.swapOrder.shareAmount.toString()).not.toBe('9007199254740993');
  let current = f.response;
  f.handle(async (config) => {
    if (config.method === 'post') {
      expect([...f.values.values()].map((value) => JSON.parse(value))).toEqual([signatureRecord()]);
      const body = JSON.parse(config.data);
      expect(body).toMatchObject({
        swap_uuid: current.swapUuid,
        owner_account_uuid: current.ownerAccountUuid,
        wallet_uuid: current.walletUuid,
        settlement_digest: current.settlementDigest,
        signature: settlementFixture.signatures[0],
      });
      current = signedResponse(current, 'seller');
      return reply(config, current.swapOrder);
    }
    return reply(config, current);
  });
  await f.controller.sign(async (typed, active) => {
    expect(active()).toBe(true);
    expect(typed).toEqual(settlementFixture.get_body.typedData);
    expect(Object.isFrozen(typed.message)).toBe(true);
    return { signature: settlementFixture.signatures[0]!, signerAddress: settlementFixture.addresses[0]! };
  });
  expect(f.updated).toHaveBeenCalledTimes(1);
  expect(f.controller.getSnapshot().response!.hasSigned).toBe(true);
  expect(f.values.size).toBe(0);
});

test('lost signature response survives restart and exact signer recovery without another POST', async () => {
  const f = setup();
  await f.controller.load();
  f.handle(async (config) => {
    if (config.method === 'post') throw new Error('Synthetic lost ACK');
    return reply(config, signedResponse(f.response, 'seller'));
  });
  await f.controller.submitSignature(settlementFixture.signatures[0]!, settlementFixture.addresses[0]!);
  expect(f.values.size).toBe(1);
  f.controller.close();
  const reminder = (await f.store.list(settlementOwner))[0]!;
  const reopened = new SwapSettlement(settlementOwner, reminder, f.dependencies);
  await reopened.recover();
  expect(reopened.getSnapshot().response!.hasSigned).toBe(true);
  expect(f.requests.filter((request) => request.method === 'post')).toHaveLength(1);
  expect(f.values.size).toBe(0);
});

test('a stored caller signature does not erase an unobserved relayed counterparty reminder', async () => {
  const f = setup(signedResponse(settlementResponse(), 'seller'));
  await f.store.save(signatureRecord(f.response, settlementFixture.addresses[1]!));
  await f.controller.load();
  expect(f.values.size).toBe(1);
  f.handle(async (config) => {
    const updated = signedResponse(f.response, 'buyer');
    updated.hasSigned = true;
    updated.canSign = false;
    return reply(config, config.method === 'post' ? updated.swapOrder : updated);
  });
  await f.controller.submitSignature(settlementFixture.signatures[1]!, settlementFixture.addresses[1]!);
  expect(f.requests.filter((request) => request.method === 'post')).toHaveLength(1);
  expect(f.values.size).toBe(0);
});

test.each([404, 409, 503])(
  'plain %s recovery retains all reminders and never changes the selected swap',
  async (status) => {
    const f = setup();
    await f.store.save(signatureRecord());
    f.handle(async (config) => failed(config, status, { detail: 'Synthetic refused context' }));
    await f.controller.recover();
    expect(f.controller.getSnapshot().phase).toBe('error');
    expect(f.values.size).toBe(1);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]!.params.swap_uuid).toBe(f.response.swapUuid);
  },
);

test('duplicate presses share a single admitted signer and signature POST', async () => {
  const f = setup();
  await f.controller.load();
  const held = deferred<{ signature: string; signerAddress: string } | null>();
  const signer = jest.fn(() => held.promise);
  f.handle(async (config) =>
    reply(
      config,
      config.method === 'post' ? signedResponse(f.response, 'seller').swapOrder : signedResponse(f.response, 'seller'),
    ),
  );
  const first = f.controller.sign(signer);
  await f.controller.sign(signer);
  await f.controller.submitSignature(settlementFixture.signatures[0]!, settlementFixture.addresses[0]!);
  held.resolve({ signature: settlementFixture.signatures[0]!, signerAddress: settlementFixture.addresses[0]! });
  await first;
  expect(signer).toHaveBeenCalledTimes(1);
  expect(f.requests.filter((request) => request.method === 'post')).toHaveLength(1);
});

test('closing during a seed/signing read invalidates its continuation and prevents persistence or POST', async () => {
  const f = setup();
  await f.controller.load();
  const held = deferred<{ signature: string; signerAddress: string } | null>();
  let signingCurrent = () => false;
  const pending = f.controller.sign(async (_typed, current) => {
    signingCurrent = current;
    return held.promise;
  });
  f.controller.close();
  expect(signingCurrent()).toBe(false);
  held.resolve({ signature: settlementFixture.signatures[0]!, signerAddress: settlementFixture.addresses[0]! });
  await pending;
  expect(f.values.size).toBe(0);
  expect(f.requests).toHaveLength(1);
  expect(f.updated).not.toHaveBeenCalled();
});

test('session retirement during local digest verification never publishes the old context', async () => {
  const f = setup();
  const held = deferred<string>();
  f.crypto.digestTypedData = () => held.promise;
  const pending = f.controller.load();
  await Promise.resolve();
  await Promise.resolve();
  f.retire();
  held.resolve(f.response.settlementDigest);
  await pending;
  expect(f.controller.getSnapshot().response).toBeNull();
  expect(f.updated).not.toHaveBeenCalled();
});

test.each(['signature', 'approval'] as const)(
  'account changes during %s persistence preserve the reminder and prevent sending',
  async (kind) => {
    const f = setup();
    await f.controller.load();
    f.handle(async (config) => reply(config, settlementApproval()));
    if (kind === 'approval') await f.controller.prepareApproval();
    const entered = deferred<void>();
    const finish = deferred<void>();
    const original = f.storage.setItem;
    f.storage.setItem = async (key, value) => {
      original(key, value);
      entered.resolve();
      await finish.promise;
    };
    const pending =
      kind === 'approval'
        ? f.controller.broadcastApproval(approvalRaw)
        : f.controller.submitSignature(settlementFixture.signatures[0]!, settlementFixture.addresses[0]!);
    await entered.promise;
    f.retire();
    finish.resolve();
    await pending;
    expect(f.values.size).toBe(1);
    expect(f.requests.filter((request) => request.method === 'post')).toHaveLength(0);
  },
);

test.each(['signature', 'approval'] as const)(
  'ambiguous %s storage failure prevents the first POST and retains its written identifiers',
  async (kind) => {
    const f = setup();
    await f.controller.load();
    f.handle(async (config) => reply(config, settlementApproval()));
    if (kind === 'approval') await f.controller.prepareApproval();
    const original = f.storage.setItem;
    f.storage.setItem = (key, value) => {
      original(key, value);
      throw new Error('Synthetic failed persistence acknowledgement');
    };
    if (kind === 'approval') await f.controller.broadcastApproval(approvalRaw);
    else await f.controller.submitSignature(settlementFixture.signatures[0]!, settlementFixture.addresses[0]!);
    expect(f.controller.getSnapshot().phase).toBe('error');
    expect(f.values.size).toBe(1);
    expect(f.requests.filter((request) => request.method === 'post')).toHaveLength(0);
  },
);

test('refresh finishing after close cannot replay a stale POST; an unrelated request retains its retry', async () => {
  const f = setup();
  await f.controller.load();
  const held = deferred<void>();
  const entered = deferred<void>();
  const retried = new Set<string>();
  f.api.interceptors.response.use(undefined, async (error: AxiosError) => {
    if (error.response?.status !== 403) throw error;
    entered.resolve();
    await held.promise;
    return f.api.request(error.config!);
  });
  f.handle(async (config) => {
    const url = config.url!;
    if (!retried.has(url)) {
      retried.add(url);
      failed(config, 403, { detail: 'Synthetic refresh' });
    }
    return reply(config, { ok: true });
  });
  const pending = f.controller.submitSignature(settlementFixture.signatures[0]!, settlementFixture.addresses[0]!);
  await entered.promise;
  f.controller.close();
  held.resolve();
  await pending;
  expect(f.requests.filter((request) => request.method === 'post')).toHaveLength(1);
  expect(f.values.size).toBe(1);
  expect((await f.api.get('/unrelated')).data).toEqual({ ok: true });
  expect(f.requests.filter((request) => request.url === '/unrelated')).toHaveLength(2);
});

test('valid scoped503 approval remains visibly unresolved after restart and later sufficient allowance', async () => {
  const f = setup();
  await f.controller.load();
  let sufficient = false;
  f.handle(async (config) => {
    if (config.method === 'post')
      failed(config, 503, {
        ...swapSettlementIdentity(f.response),
        userRole: 'seller',
        txHash: approvalHash,
        code: 'swap_approval_unconfirmed',
        detail: 'Synthetic unconfirmed',
      });
    if (config.url?.endsWith('approval-data/')) return reply(config, settlementApproval());
    if (config.url?.endsWith('approval-status/'))
      return reply(config, {
        ...settlementApproval(),
        requiredAmount: f.response.typedData.message.shareAmount,
        currentAllowance: sufficient ? f.response.typedData.message.shareAmount : '0',
        needsApproval: !sufficient,
      });
    return reply(config, f.response);
  });
  await f.controller.prepareApproval();
  await f.controller.broadcastApproval(approvalRaw);
  expect(f.controller.getSnapshot().approvalResult).toMatchObject({
    code: 'swap_approval_unconfirmed',
    txHash: approvalHash,
  });
  expect(f.values.size).toBe(1);
  f.controller.close();
  const reminder = (await f.store.list(settlementOwner))[0]!;
  const reopened = new SwapSettlement(settlementOwner, reminder, f.dependencies);
  await reopened.load();
  expect(reopened.getSnapshot().unconfirmedApprovalHashes).toEqual([approvalHash]);
  await reopened.prepareApproval();
  expect(reopened.getSnapshot().error).toMatch(/earlier approval remains unconfirmed/);
  await reopened.broadcastApproval(approvalRaw);
  sufficient = true;
  await reopened.refreshApprovalStatus();
  expect(reopened.getSnapshot().approvalStatus!.needsApproval).toBe(false);
  expect(reopened.getSnapshot().unconfirmedApprovalHashes).toEqual([approvalHash]);
  expect(reopened.getSnapshot().approvalResult).toBeNull();
  expect(f.values.size).toBe(1);
  expect(f.requests.filter((request) => request.method === 'post')).toHaveLength(1);
});

test('approval confirmation remains attributed to its original hash after the deadline passes during receipt wait', async () => {
  const f = setup();
  await f.controller.load();
  f.handle(async (config) => {
    if (config.method === 'post') {
      jest.mocked(Date.now).mockReturnValue(settlementNow + 1000000);
      return reply(config, approvalResult());
    }
    return reply(config, settlementApproval());
  });
  await f.controller.prepareApproval();
  await f.controller.signApproval(async (_tx, current) => {
    expect(current()).toBe(true);
    return approvalRaw;
  });
  expect(f.controller.getSnapshot().approvalResult).toEqual(approvalResult());
  expect(f.values.size).toBe(0);
  expect(f.updated).toHaveBeenCalledTimes(1);
});

test.each(['swapUuid', 'walletUuid', 'settlementDigest', 'txHash', 'code'] as const)(
  'mismatched approval uncertainty %s cannot confirm or clear the saved hash',
  async (field) => {
    const f = setup();
    await f.controller.load();
    f.handle(async (config) => {
      if (config.method === 'post')
        failed(config, 503, {
          ...swapSettlementIdentity(f.response),
          userRole: 'seller',
          txHash: approvalHash,
          code: 'swap_approval_unconfirmed',
          detail: 'Synthetic uncertainty',
          [field]: field === 'txHash' ? '0x' + 'ff'.repeat(32) : 'wrong',
        });
      return reply(config, settlementApproval());
    });
    await f.controller.prepareApproval();
    await f.controller.broadcastApproval(approvalRaw);
    expect(f.controller.getSnapshot().phase).toBe('error');
    expect(f.controller.getSnapshot().approvalResult).toBeNull();
    expect(f.values.size).toBe(1);
  },
);

test('approval decoder finishing after closure cannot persist or broadcast its old transaction', async () => {
  const f = setup();
  await f.controller.load();
  f.handle(async (config) => reply(config, settlementApproval()));
  await f.controller.prepareApproval();
  const held = deferred<{ txHash: string; transaction: ReturnType<typeof settlementApproval>['transaction'] }>();
  f.crypto.inspectSignedApproval = () => held.promise;
  const pending = f.controller.broadcastApproval(approvalRaw);
  f.controller.close();
  held.resolve({ txHash: approvalHash, transaction: settlementApproval().transaction });
  await pending;
  expect(f.values.size).toBe(0);
  expect(f.requests.filter((request) => request.method === 'post')).toHaveLength(0);
});

test('expiry while signing or an expired recovered context refuses new work without rewriting its deadline', async () => {
  const f = setup();
  await f.controller.load();
  const originalDeadline = f.controller.getSnapshot().response!.typedData.message.deadline;
  await f.controller.sign(async (_typed, current) => {
    jest.mocked(Date.now).mockReturnValue(settlementNow + 1000000);
    expect(current()).toBe(false);
    return { signature: settlementFixture.signatures[0]!, signerAddress: settlementFixture.addresses[0]! };
  });
  expect(f.controller.getSnapshot().error).toMatch(/Refresh the original/);
  expect(f.values.size).toBe(0);
  expect(f.requests.filter((request) => request.method === 'post')).toHaveLength(0);
  expect(f.controller.getSnapshot().response!.typedData.message.deadline).toBe(originalDeadline);
});

test('closure after an accepted POST retains its reminder and suppresses the old result callback', async () => {
  const f = setup();
  await f.controller.load();
  const entered = deferred<InternalAxiosRequestConfig>();
  const held = deferred<AxiosResponse>();
  f.handle(async (config) => {
    entered.resolve(config);
    return held.promise;
  });
  const pending = f.controller.submitSignature(settlementFixture.signatures[0]!, settlementFixture.addresses[0]!);
  const request = await entered.promise;
  f.controller.close();
  held.resolve(reply(request, signedResponse(f.response, 'seller').swapOrder));
  await pending;
  expect(f.values.size).toBe(1);
  expect(f.updated).not.toHaveBeenCalled();
});

test('uncertain signature delivery requires exact recovery before another signer even after an allowance check', async () => {
  const f = setup();
  await f.controller.load();
  f.handle(async (config) => {
    if (config.method === 'post') throw new Error('Synthetic lost ACK');
    return reply(config, {
      ...settlementApproval(),
      requiredAmount: f.response.typedData.message.shareAmount,
      currentAllowance: f.response.typedData.message.shareAmount,
      needsApproval: false,
    });
  });
  await f.controller.submitSignature(settlementFixture.signatures[0]!, settlementFixture.addresses[0]!);
  await f.controller.refreshApprovalStatus();
  const signer = jest.fn(async () => ({
    signature: settlementFixture.signatures[0]!,
    signerAddress: settlementFixture.addresses[0]!,
  }));
  await f.controller.sign(signer);
  expect(signer).not.toHaveBeenCalled();
  expect(f.controller.getSnapshot().error).toMatch(/saved settlement status/);
  expect(f.requests.filter((request) => request.method === 'post')).toHaveLength(1);
  expect(f.values.size).toBe(1);
});

test.each(['digest', 'signer', 'approval-decoder'] as const)(
  'unexpected %s errors cannot display raw signing material',
  async (operation) => {
    const f = setup();
    const unsafe = 'Synthetic private signing material must stay private';
    if (operation === 'digest')
      f.crypto.digestTypedData = () => {
        throw new Error(unsafe);
      };
    await f.controller.load();
    if (operation === 'signer')
      await f.controller.sign(async () => {
        throw new Error(unsafe);
      });
    if (operation === 'approval-decoder') {
      f.handle(async (config) => reply(config, settlementApproval()));
      await f.controller.prepareApproval();
      f.crypto.inspectSignedApproval = () => {
        throw new Error(unsafe);
      };
      await f.controller.broadcastApproval(approvalRaw);
    }
    expect(f.controller.getSnapshot().phase).toBe('error');
    expect(f.controller.getSnapshot().error).not.toContain(unsafe);
    expect(f.values.size).toBe(0);
    expect(f.requests.filter((request) => request.method === 'post')).toHaveLength(0);
  },
);

test('an observed wallet/session retirement cannot revive the old controller when the live guard later becomes true', async () => {
  const f = setup();
  await f.controller.load();
  f.retire();
  expect(f.controller.isCurrent()).toBe(false);
  f.dependencies.isCurrent = () => true;
  expect(f.controller.isCurrent()).toBe(false);
  const signer = jest.fn(async () => ({
    signature: settlementFixture.signatures[0]!,
    signerAddress: settlementFixture.addresses[0]!,
  }));
  await f.controller.sign(signer);
  expect(signer).not.toHaveBeenCalled();
});

describe('a drifted or held settlement is refused, not retried', () => {
  test('a lookup reporting swap_settlement_context_changed refuses new work without asking for a signature', async () => {
    const drifted = settlementResponse();
    drifted.admissionRefusal = 'swap_settlement_context_changed';
    drifted.canSign = false;
    const f = setup(drifted);
    await f.controller.load();
    expect(f.controller.getSnapshot().phase).toBe('ready');
    expect(f.controller.getSnapshot().response?.admissionRefusal).toBe('swap_settlement_context_changed');
    const requestsAfterLookup = f.requests.length;
    const signer = jest.fn(async () => null);
    await f.controller.sign(signer);
    expect(f.controller.getSnapshot().phase).toBe('error');
    expect(f.controller.getSnapshot().error).toBe('Refresh the original settlement before continuing.');
    expect(signer).not.toHaveBeenCalled();
    await f.controller.refreshApprovalStatus();
    expect(f.controller.getSnapshot().error).toBe('Refresh the original settlement before continuing.');
    expect(f.requests.length).toBe(requestsAfterLookup);
  });

  test('a signature refused with swap_settlement_context_changed surfaces the recorded reason and stops', async () => {
    const f = setup();
    await f.controller.load();
    f.handle(async (config) => {
      if (config.method === 'post' && config.url?.includes('/swap/sign/')) {
        failed(config, 409, {
          code: 'swap_settlement_context_changed',
          detail: 'The original swap context is no longer admitted. Review the recorded swap before continuing.',
        });
      }
      return reply(config, f.response);
    });
    await f.controller.submitSignature(settlementFixture.signatures[0]!, settlementFixture.addresses[0]!);
    const snapshot = f.controller.getSnapshot();
    expect(snapshot.phase).toBe('error');
    expect(snapshot.error).toBe(
      'The original swap context is no longer admitted. Review the recorded swap before continuing.',
    );
    const requestsAfterRefusal = f.requests.length;
    await f.controller.submitSignature(settlementFixture.signatures[0]!, settlementFixture.addresses[0]!);
    expect(f.controller.getSnapshot().phase).toBe('error');
    expect(f.requests.length).toBe(requestsAfterRefusal);
  });

  test('a legacy swap held for attribution is surfaced and never offered for signing', async () => {
    const f = setup();
    f.handle(async (config) => {
      failed(config, 409, {
        code: 'legacy_swap_held',
        detail:
          'This legacy swap is held for operator attribution. New approvals, signatures and execution are unavailable.',
      });
    });
    await f.controller.load();
    const snapshot = f.controller.getSnapshot();
    expect(snapshot.phase).toBe('error');
    expect(snapshot.error).toBe(
      'This legacy swap is held for operator attribution. New approvals, signatures and execution are unavailable.',
    );
    expect(snapshot.response).toBeNull();
    const signer = jest.fn(async () => null);
    await f.controller.sign(signer);
    expect(signer).not.toHaveBeenCalled();
    const requestsAfterLookup = f.requests.length;
    await f.controller.refreshApprovalStatus();
    expect(f.controller.getSnapshot().error).toBe('Refresh the original settlement before continuing.');
    expect(f.requests.length).toBe(requestsAfterLookup);
  });
});
