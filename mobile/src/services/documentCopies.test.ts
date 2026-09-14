import * as DocumentPicker from 'expo-document-picker';
import { pickDocumentCopy, shareDocumentCopy } from './documentCopies';
import { getSessionEpoch, invalidateSessionScope } from './sessionScope';
import {
  cache,
  files,
  nativeBehavior,
  nativeFileSystem,
  operations,
  pickedFile,
  resetFiles,
  sticky,
  unlistable,
  unreadable,
} from '../testSupport/documentFiles';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => jest.requireActual('../testSupport/documentFiles').nativeFileSystem);

const pick = jest.mocked(DocumentPicker.getDocumentAsync);

beforeEach(() => {
  resetFiles();
  pick.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

it('adopts a private copy, preserves the provider original, and waits for every admitted consumer', async () => {
  const result = pickedFile();
  const original = 'content://provider/original.pdf';
  files.set(original, { size: 5, content: 'provider-original' });
  pick.mockResolvedValue(result);
  const copy = (await pickDocumentCopy(() => true))!;
  expect(files.has(result.assets[0].uri)).toBe(false);
  expect(files.get(copy.file.uri)?.content).toBe('document-1');
  const releaseFirst = copy.acquire();
  const releaseSecond = copy.acquire();
  copy.retire();
  releaseFirst();
  releaseFirst();
  expect(files.has(copy.file.uri)).toBe(true);
  releaseSecond();
  expect(files.has(copy.file.uri)).toBe(false);
  expect(files.get(original)?.content).toBe('provider-original');
  expect(() => copy.acquire()).toThrow();
});

it('verifies source retirement when an older native move only copies the bytes', async () => {
  nativeBehavior.copyOnMove = true;
  const result = pickedFile();
  pick.mockResolvedValue(result);
  const copy = (await pickDocumentCopy(() => true))!;
  expect(files.has(result.assets[0].uri)).toBe(false);
  expect(files.has(copy.file.uri)).toBe(true);
  copy.retire();

  const stuck = pickedFile(2);
  sticky.add(stuck.assets[0].uri);
  pick.mockResolvedValue(stuck);
  await expect(pickDocumentCopy(() => true)).rejects.toThrow('retire');
  expect(files.has(stuck.assets[0].uri)).toBe(true);
  expect([...files.keys()].some((uri) => uri.includes('ledova-upload-copies-v1'))).toBe(false);
});

it.each([
  'content://provider/private.pdf',
  `${cache}elsewhere.pdf`,
  `${cache}DocumentPicker/../original.pdf`,
  `${cache}DocumentPicker/not-a-generated-file.pdf`,
  `${cache}00000000-0000-0000-0000-0000000000f1.pdf`,
])('refuses an unowned result without touching it: %s', async (uri) => {
  files.set(uri, { size: 5, content: 'untouched' });
  pick.mockResolvedValue({ canceled: false, assets: [{ uri, name: 'private.pdf', size: 5, lastModified: 0 }] });
  await expect(pickDocumentCopy(() => true)).rejects.toThrow('private copy');
  expect(files.get(uri)?.content).toBe('untouched');
  expect(operations.some((operation) => operation.uri === uri)).toBe(false);
});

it('retires every returned private copy when the native picker unexpectedly supplies multiple files', async () => {
  const first = pickedFile(1);
  const second = pickedFile(2);
  const external = 'content://provider/untouched';
  files.set(external, { size: 5, content: 'provider-original' });
  pick.mockResolvedValue({
    canceled: false,
    assets: [...first.assets, ...second.assets, { uri: external, name: 'original', lastModified: 0 }],
  });
  await expect(pickDocumentCopy(() => true)).rejects.toThrow('one document');
  expect(files.has(first.assets[0].uri)).toBe(false);
  expect(files.has(second.assets[0].uri)).toBe(false);
  expect(files.has(external)).toBe(true);
});

it.each([0, 10 * 1024 * 1024 + 1])('retires a returned copy with refused actual size %s', async (size) => {
  const result = pickedFile(1, size);
  pick.mockResolvedValue(result);
  await expect(pickDocumentCopy(() => true)).rejects.toThrow('10 MB');
  expect(files.has(result.assets[0].uri)).toBe(false);
});

it('refuses a partial copy and permits a complete copy at the limit', async () => {
  const partial = pickedFile();
  partial.assets[0].size++;
  pick.mockResolvedValue(partial);
  await expect(pickDocumentCopy(() => true)).rejects.toThrow('incomplete');
  expect(files.has(partial.assets[0].uri)).toBe(false);
  pick.mockResolvedValue(pickedFile(2, 10 * 1024 * 1024));
  const copy = (await pickDocumentCopy(() => true))!;
  expect(files.get(copy.file.uri)?.size).toBe(10 * 1024 * 1024);
  copy.retire();
});

it('cleans only the fixed managed slots after a fresh module load and refuses unreadable or sticky slots', async () => {
  const retired = `${cache}ledova-upload-copies-v1/slot-0`;
  const denied = `${cache}ledova-upload-copies-v1/slot-1`;
  const stuck = `${cache}ledova-upload-copies-v1/slot-2`;
  const unrelated = `${cache}ledova-upload-copies-v1/unrelated`;
  for (const uri of [retired, denied, stuck, unrelated]) files.set(uri, { size: 5, content: 'leftover' });
  unreadable.add(denied);
  sticky.add(stuck);
  pick.mockResolvedValue({ canceled: true, assets: null });
  await jest.isolateModulesAsync(async () => {
    jest.doMock('expo-file-system', () => nativeFileSystem);
    jest.doMock('expo-document-picker', () => DocumentPicker);
    const fresh = jest.requireActual<typeof import('./documentCopies')>('./documentCopies');
    await fresh.pickDocumentCopy(() => true);
  });
  expect(files.has(retired)).toBe(false);
  expect(files.has(denied)).toBe(true);
  expect(files.has(stuck)).toBe(true);
  expect(files.has(unrelated)).toBe(true);
  expect(new Set(operations.map(({ uri }) => uri)).size).toBe(16);
  expect(operations.some(({ kind, uri }) => kind === 'delete' && uri === denied)).toBe(false);
  expect(pick).toHaveBeenCalledTimes(1);
});

it('does not reuse a leased slot while another picker opens, and retries cleanup after deletion becomes available', async () => {
  pick.mockResolvedValue(pickedFile(1));
  const first = (await pickDocumentCopy(() => true))!;
  const release = first.acquire();
  first.retire();
  pick.mockResolvedValue(pickedFile(2));
  const second = (await pickDocumentCopy(() => true))!;
  expect(second.file.uri).not.toBe(first.file.uri);
  expect(files.get(first.file.uri)?.content).toBe('document-1');
  sticky.add(first.file.uri);
  release();
  expect(files.has(first.file.uri)).toBe(true);
  sticky.delete(first.file.uri);
  pick.mockResolvedValue({ canceled: true, assets: null });
  await pickDocumentCopy(() => true);
  expect(files.has(first.file.uri)).toBe(false);
  expect(files.has(second.file.uri)).toBe(true);
  second.retire();
});

it('handles a provider rejection without exposing its message and releases the picker for a later selection', async () => {
  pick.mockRejectedValue(new Error('provider/private/secret.pdf'));
  await expect(pickDocumentCopy(() => true)).rejects.toThrow('Could not read the document');
  pick.mockResolvedValue(pickedFile());
  const copy = (await pickDocumentCopy(() => true))!;
  expect(files.has(copy.file.uri)).toBe(true);
  copy.retire();
});

const pickerPath = (name: string) => `${cache}DocumentPicker/${name}`;

it('retires lost, partial and historical picker copies once a pick settles, and nothing else', async () => {
  const owned = [
    pickerPath('00000000-0000-0000-0000-0000000000a1.pdf'),
    pickerPath('00000000-0000-0000-0000-0000000000a2'),
    pickerPath('00000000-0000-0000-0000-0000000000a3.jpeg'),
  ];
  const kept = [
    pickerPath('not-a-generated-file.pdf'),
    pickerPath('nested/00000000-0000-0000-0000-0000000000a4.pdf'),
    `${cache}00000000-0000-0000-0000-0000000000a5.pdf`,
    'content://provider/original.pdf',
  ];
  for (const uri of [...owned, ...kept]) files.set(uri, { size: 5, content: 'leftover' });
  pick.mockResolvedValue({ canceled: true, assets: null });
  await expect(pickDocumentCopy(() => true)).resolves.toBeNull();
  expect(owned.filter((uri) => files.has(uri))).toEqual([]);
  for (const uri of kept) expect(files.get(uri)?.content).toBe('leftover');
  expect(operations.some(({ kind, uri }) => kind === 'delete' && kept.includes(uri))).toBe(false);
});

it('keeps picking and session retirement available when the picker directory cannot be listed', async () => {
  const lost = pickerPath('00000000-0000-0000-0000-0000000000b1.pdf');
  files.set(lost, { size: 5, content: 'leftover' });
  unlistable.add(pickerPath(''));
  pick.mockResolvedValue(pickedFile());
  const copy = (await pickDocumentCopy(() => true))!;
  expect(files.has(copy.file.uri)).toBe(true);
  invalidateSessionScope();
  expect(files.has(lost)).toBe(true);
  copy.retire();
});

it('sweeps on session retirement but waits for an open picker so its in-flight copy is still adopted', async () => {
  const lost = pickerPath('00000000-0000-0000-0000-0000000000c1.pdf');
  files.set(lost, { size: 5, content: 'leftover' });
  invalidateSessionScope();
  expect(files.has(lost)).toBe(false);

  let resolvePick!: (result: ReturnType<typeof pickedFile>) => void;
  pick.mockReturnValue(new Promise((resolve) => (resolvePick = resolve)));
  const pending = pickDocumentCopy(() => true);
  const inFlight = pickedFile(7);
  const later = pickerPath('00000000-0000-0000-0000-0000000000c2.pdf');
  files.set(later, { size: 5, content: 'leftover' });
  invalidateSessionScope();
  expect(files.has(inFlight.assets[0].uri)).toBe(true);
  expect(files.has(later)).toBe(true);
  resolvePick(inFlight);
  const copy = (await pending)!;
  expect(files.get(copy.file.uri)?.content).toBe('document-7');
  expect(files.has(inFlight.assets[0].uri)).toBe(false);
  expect(files.has(later)).toBe(false);
  copy.retire();
});

it('recognises picker copies by name when the listing spells the cache path differently', async () => {
  const lost = pickerPath('00000000-0000-0000-0000-0000000000e1.pdf');
  const kept = pickerPath('not-a-generated-file.pdf');
  for (const uri of [lost, kept]) files.set(uri, { size: 5, content: 'leftover' });
  nativeBehavior.listedRoot = 'file:///var/cache/';
  pick.mockResolvedValue({ canceled: true, assets: null });
  await expect(pickDocumentCopy(() => true)).resolves.toBeNull();
  expect(files.has(lost)).toBe(false);
  expect(files.get(kept)?.content).toBe('leftover');
});

const viewPath = (name: string) => `${cache}ledova-document-views-v1/${name}`;

const viewed =
  (name: string, content = 'viewed') =>
  async () => ({
    name,
    type: 'application/pdf',
    bytes: Uint8Array.from(content, (character) => character.charCodeAt(0)),
  });

function heldShare() {
  let opened!: () => void;
  let finish!: () => void;
  const opening = new Promise<void>((resolve) => (opened = resolve));
  const share = jest.fn(() => {
    opened();
    return new Promise<void>((resolve) => (finish = resolve));
  });
  return { share, opening, finish: () => finish() };
}

it('shares only the latest viewed copy, while it exists, and removes earlier ones and nothing else', async () => {
  const earlier = viewPath('earlier.pdf');
  const kept = [`${cache}elsewhere.pdf`, pickerPath('not-a-generated-file.pdf'), 'content://provider/original.pdf'];
  for (const uri of [earlier, ...kept]) files.set(uri, { size: 5, content: 'leftover' });
  const share = jest.fn(async (uri: string) => {
    expect(files.get(uri)?.content).toBe('latest');
  });
  await shareDocumentCopy(getSessionEpoch(), viewed('latest.pdf', 'latest'), share);
  expect(share).toHaveBeenCalledWith(viewPath('latest.pdf'), 'application/pdf');
  expect(files.has(earlier)).toBe(false);
  for (const uri of kept) expect(files.get(uri)?.content).toBe('leftover');
});

it('retires viewed copies on session retirement, even while their share is open', async () => {
  const held = heldShare();
  const pending = shareDocumentCopy(getSessionEpoch(), viewed('open.pdf'), held.share);
  await held.opening;
  expect(files.has(viewPath('open.pdf'))).toBe(true);
  invalidateSessionScope();
  expect(files.has(viewPath('open.pdf'))).toBe(false);
  held.finish();
  await pending;
});

it('writes nothing for a download that outlives its session, and allows the next view', async () => {
  const share = jest.fn(async () => {});
  await expect(
    shareDocumentCopy(
      getSessionEpoch(),
      async () => {
        invalidateSessionScope();
        return viewed('stale.pdf')();
      },
      share,
    ),
  ).rejects.toThrow('session');
  expect(files.has(viewPath('stale.pdf'))).toBe(false);
  expect(share).not.toHaveBeenCalled();
  await shareDocumentCopy(getSessionEpoch(), viewed('fresh.pdf'), share);
  expect(share).toHaveBeenCalledWith(viewPath('fresh.pdf'), 'application/pdf');
});

it('refuses a second view while one downloads, but an open share does not block the next view', async () => {
  let finishDownload!: () => void;
  const held = heldShare();
  const first = shareDocumentCopy(
    getSessionEpoch(),
    async () => {
      await new Promise<void>((resolve) => (finishDownload = resolve));
      return viewed('first.pdf')();
    },
    held.share,
  );
  const refused = jest.fn(viewed('refused.pdf'));
  await shareDocumentCopy(getSessionEpoch(), refused, held.share);
  expect(refused).not.toHaveBeenCalled();
  finishDownload();
  await held.opening;
  const next = jest.fn(async () => {});
  await shareDocumentCopy(getSessionEpoch(), viewed('next.pdf'), next);
  expect(next).toHaveBeenCalledWith(viewPath('next.pdf'), 'application/pdf');
  expect(files.has(viewPath('first.pdf'))).toBe(false);
  held.finish();
  await first;
});

it('still shares when earlier viewed copies cannot be listed', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const earlier = viewPath('earlier.pdf');
  files.set(earlier, { size: 5, content: 'leftover' });
  unlistable.add(viewPath(''));
  const share = jest.fn(async () => {});
  await shareDocumentCopy(getSessionEpoch(), viewed('latest.pdf'), share);
  expect(share).toHaveBeenCalledWith(viewPath('latest.pdf'), 'application/pdf');
  expect(files.has(earlier)).toBe(true);
  invalidateSessionScope();
  expect(warn).toHaveBeenCalledWith('Document cache cleanup did not complete.');
});

it('keeps a view bound to its session: retirement sweeps during a download and never holds the next session', async () => {
  const earlier = viewPath('earlier.pdf');
  files.set(earlier, { size: 5, content: 'leftover' });
  const staleEpoch = getSessionEpoch();
  let finishStale!: () => void;
  const staleShare = jest.fn(async () => {});
  const stale = shareDocumentCopy(
    staleEpoch,
    async () => {
      await new Promise<void>((resolve) => (finishStale = resolve));
      return viewed('stale.pdf')();
    },
    staleShare,
  );
  invalidateSessionScope();
  expect(files.has(earlier)).toBe(false);
  const lateDownload = jest.fn(viewed('late.pdf'));
  await expect(shareDocumentCopy(staleEpoch, lateDownload, staleShare)).rejects.toThrow('session');
  expect(lateDownload).not.toHaveBeenCalled();
  let finishNext!: () => void;
  const nextShare = jest.fn(async () => {});
  const next = shareDocumentCopy(
    getSessionEpoch(),
    async () => {
      await new Promise<void>((resolve) => (finishNext = resolve));
      return viewed('next.pdf')();
    },
    nextShare,
  );
  finishStale();
  await expect(stale).rejects.toThrow('session');
  const refused = jest.fn(viewed('refused.pdf'));
  await shareDocumentCopy(getSessionEpoch(), refused, nextShare);
  expect(refused).not.toHaveBeenCalled();
  finishNext();
  await next;
  expect(nextShare).toHaveBeenCalledWith(viewPath('next.pdf'), 'application/pdf');
  expect(staleShare).not.toHaveBeenCalled();
  expect(files.has(viewPath('stale.pdf'))).toBe(false);
});

it('releases the view guard when a download fails, so the next view in that session proceeds', async () => {
  await expect(
    shareDocumentCopy(
      getSessionEpoch(),
      async () => {
        throw new Error('Synthetic network failure');
      },
      jest.fn(),
    ),
  ).rejects.toThrow('network');
  const share = jest.fn(async () => {});
  await shareDocumentCopy(getSessionEpoch(), viewed('after-failure.pdf'), share);
  expect(share).toHaveBeenCalledWith(viewPath('after-failure.pdf'), 'application/pdf');
});
