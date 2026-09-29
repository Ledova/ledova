import {
  createPauseSubmissionStore,
  createSyncPauseSubmissionStore,
  type SavedPause,
  type SyncStorage,
} from '../../src/utils/pause-submission-storage';

const tokenUuid = '11111111-1111-4111-8111-111111111111';
const owner = {
  userUuid: '22222222-2222-4222-8222-222222222222',
  ownerAccountUuid: '33333333-3333-4333-8333-333333333333',
};
const submissionId = '44444444-4444-4444-8444-444444444444';
const otherUuid = '55555555-5555-4555-8555-555555555555';
const prefix = `ledova.pause-submissions.v1.${owner.userUuid}.${owner.ownerAccountUuid}.${tokenUuid}.`;

function memory() {
  const values = new Map<string, string>();
  const storage: SyncStorage = {
    getAllKeys: () => [...values.keys()],
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
  return { values, storage };
}

const SHAPES = {
  sync: (storage: SyncStorage, newUuid: () => string) => createSyncPauseSubmissionStore(storage, newUuid),
  async: (storage: SyncStorage, newUuid: () => string) =>
    createPauseSubmissionStore(
      {
        getAllKeys: async () => storage.getAllKeys(),
        getItem: async (key) => storage.getItem(key),
        setItem: async (key, value) => storage.setItem(key, value),
        removeItem: async (key) => storage.removeItem(key),
      },
      newUuid,
    ),
};

async function settle<T>(call: () => T | Promise<T>): Promise<T> {
  return call();
}

describe.each(Object.keys(SHAPES) as (keyof typeof SHAPES)[])('the %s pause store', (shape) => {
  function harness() {
    const { values, storage } = memory();
    return { values, storage, store: SHAPES[shape](storage, () => submissionId) };
  }

  it('saves the exact terms under the user, account and class, and lists them in that scope only', async () => {
    const { values, store } = harness();
    const record = await settle(() => store.save(owner, tokenUuid, false));

    expect(record).toEqual({ ...owner, tokenUuid, submissionId, paused: false });
    expect(Object.isFrozen(record)).toBe(true);
    expect([...values]).toEqual([[`${prefix}${submissionId}`, JSON.stringify(record)]]);
    expect(await settle(() => store.list(owner, tokenUuid))).toEqual([record]);
    expect(await settle(() => store.list({ ...owner, userUuid: otherUuid }, tokenUuid))).toEqual([]);
    expect(await settle(() => store.list({ ...owner, ownerAccountUuid: otherUuid }, tokenUuid))).toEqual([]);
    expect(await settle(() => store.list(owner, otherUuid))).toEqual([]);
  });

  it('refuses a second request with the same identity and a retry with different terms', async () => {
    const { store } = harness();
    const record = await settle(() => store.save(owner, tokenUuid, true));

    await expect(settle(() => store.save(owner, tokenUuid, true))).rejects.toThrow(
      'This pause submission already exists.',
    );
    await expect(settle(() => store.retain({ ...record, paused: false }))).rejects.toThrow(
      'This saved pause request has different terms.',
    );
    expect(await settle(() => store.list(owner, tokenUuid))).toEqual([record]);
  });

  it('lists every saved request in key order', async () => {
    const { store } = harness();
    const later = { ...owner, tokenUuid, paused: false, submissionId: otherUuid };
    const earlier = { ...owner, tokenUuid, paused: true, submissionId };
    await settle(() => store.retain(later));
    await settle(() => store.retain(earlier));

    expect(await settle(() => store.list(owner, tokenUuid))).toEqual([earlier, later]);
  });

  it('requires the write to read back, and restores the same request on retry', async () => {
    const { values, storage, store } = harness();
    const setItem = storage.setItem;
    storage.setItem = () => {};
    await expect(settle(() => store.save(owner, tokenUuid, true))).rejects.toThrow(
      'The pause request could not be saved on this device.',
    );
    expect(values.size).toBe(0);

    storage.setItem = setItem;
    const record = await settle(() => store.save(owner, tokenUuid, true));
    values.clear();
    expect(await settle(() => store.retain(record))).toEqual(record);
    expect(await settle(() => store.list(owner, tokenUuid))).toEqual([record]);
  });

  it.each([
    ['moved to another class', (record: SavedPause) => JSON.stringify({ ...record, tokenUuid: otherUuid })],
    ['with an extra field', (record: SavedPause) => JSON.stringify({ ...record, note: 'x' })],
    ['as null', () => 'null'],
  ])('fails closed on a saved request %s', async (_, corrupt) => {
    const { values, store } = harness();
    const record = await settle(() => store.save(owner, tokenUuid, true));
    values.set(`${prefix}${submissionId}`, corrupt(record));

    await expect(settle(() => store.list(owner, tokenUuid))).rejects.toThrow('Saved pause requests could not be read.');
    await expect(settle(() => store.save(owner, tokenUuid, false))).rejects.toThrow(
      'Saved pause requests could not be read.',
    );
  });

  it('skips a request removed between listing the keys and reading it', async () => {
    const { storage, store } = harness();
    const record = await settle(() => store.save(owner, tokenUuid, true));
    const getAllKeys = storage.getAllKeys;
    storage.getAllKeys = () => [...getAllKeys(), `${prefix}${otherUuid}`];

    expect(await settle(() => store.list(owner, tokenUuid))).toEqual([record]);
  });

  it('verifies that a removed request is gone', async () => {
    const { values, storage, store } = harness();
    const record = await settle(() => store.save(owner, tokenUuid, true));
    const removeItem = storage.removeItem;
    storage.removeItem = () => {};
    await expect(settle(() => store.remove(record))).rejects.toThrow('The pause reminder could not be cleared.');
    expect(values.size).toBe(1);

    storage.removeItem = removeItem;
    await settle(() => store.remove(record));
    expect(values.size).toBe(0);
  });

  it.each([
    ['user', { ...owner, userUuid: '' }, tokenUuid],
    ['account', { ...owner, ownerAccountUuid: 'account' }, tokenUuid],
    ['share class', owner, ''],
  ])('refuses an unavailable %s before touching storage', async (_, scope, token) => {
    const { storage, store } = harness();
    const touched = jest.fn();
    for (const method of ['getAllKeys', 'getItem', 'setItem', 'removeItem'] as const)
      storage[method] = touched as never;

    await expect(settle(() => store.save(scope, token, true))).rejects.toThrow(
      'The issuer or share class identity is unavailable.',
    );
    await expect(settle(() => store.list(scope, token))).rejects.toThrow(
      'The issuer or share class identity is unavailable.',
    );
    expect(touched).not.toHaveBeenCalled();
  });

  it.each([
    ['request id', { submissionId: 'pause-1' }],
    ['direction', { paused: 'yes' as unknown as boolean }],
  ])('refuses a request with an invalid %s', async (_, change) => {
    const { values, store } = harness();
    const record = { ...owner, tokenUuid, paused: true, submissionId, ...change };

    await expect(settle(() => store.retain(record))).rejects.toThrow('The saved pause request is invalid.');
    await expect(settle(() => store.remove(record))).rejects.toThrow('The saved pause request is invalid.');
    expect(values.size).toBe(0);
  });

  it.each(['getAllKeys', 'getItem', 'setItem'] as const)('fails closed when storage cannot %s', async (method) => {
    const { values, storage, store } = harness();
    storage[method] = () => {
      throw new Error('Synthetic storage failure');
    };

    await expect(settle(() => store.save(owner, tokenUuid, true))).rejects.toThrow('Synthetic storage failure');
    expect(values.size).toBe(0);
  });
});

describe('the shape each client relies on', () => {
  it('answers at once on the web, where the page reads saved requests while it renders', () => {
    const { storage } = memory();
    const store = createSyncPauseSubmissionStore(storage, () => submissionId);

    const record = store.save(owner, tokenUuid, true);
    expect(record).toEqual({ ...owner, tokenUuid, paused: true, submissionId });
    expect(store.list(owner, tokenUuid)).toEqual([record]);
    expect(store.retain(record)).toBe(record);
    expect(store.remove(record)).toBeUndefined();
    expect(() => store.list({ ...owner, userUuid: '' }, tokenUuid)).toThrow(
      'The issuer or share class identity is unavailable.',
    );
  });

  it('answers with promises on the phone, rejecting rather than throwing', async () => {
    const { storage } = memory();
    const store = createPauseSubmissionStore(
      {
        getAllKeys: async () => storage.getAllKeys(),
        getItem: async (key) => storage.getItem(key),
        setItem: async (key, value) => storage.setItem(key, value),
        removeItem: async (key) => storage.removeItem(key),
      },
      () => submissionId,
    );

    const refused = store.list({ ...owner, userUuid: '' }, tokenUuid);
    expect(refused).toBeInstanceOf(Promise);
    await expect(refused).rejects.toThrow('The issuer or share class identity is unavailable.');
    const saving = store.save(owner, tokenUuid, true);
    expect(saving).toBeInstanceOf(Promise);
    const record = await saving;
    expect(await store.list(owner, tokenUuid)).toEqual([record]);
  });
});
