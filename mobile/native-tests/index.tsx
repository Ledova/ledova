import { registerRootComponent } from 'expo';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { getRandomValues } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { Buffer } from 'buffer';
import { apiClient, rotateRefreshToken } from '../src/services/apiClient';
import { clearTokens, getAccessToken, getRefreshToken, storeTokens } from '../src/services/tokenStorage';
import { getApiBaseUrl } from '../src/config/networkPolicy';
import { failureCategory, NativeProbeAssertion } from './diagnostics';
import { shareDocumentCopy } from '../src/services/documentCopies';
import { getSessionEpoch } from '../src/services/sessionScope';
import documentFixture from './documentFixture.json';

type Check = { name: string; passed: boolean; failure?: { category: string; stage: string } };
const pair = { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' };
const target = process.env.EXPO_PUBLIC_NATIVE_PROBE_TARGET || '';
const cleartext = process.env.EXPO_PUBLIC_NATIVE_PROBE_HTTP || '';
const untrusted = process.env.EXPO_PUBLIC_NATIVE_PROBE_UNTRUSTED || '';

function requireTrue(value: unknown): asserts value {
  if (!value) throw new NativeProbeAssertion();
}

function request(url: string, method = 'GET', body?: string): Promise<XMLHttpRequest> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.timeout = 10000;
    xhr.setRequestHeader('Authorization', 'Bearer synthetic-access');
    if (body !== undefined) xhr.setRequestHeader('Content-Type', 'text/plain');
    xhr.onload = () => resolve(xhr);
    xhr.onerror = () => reject(new Error('Native request refused.'));
    xhr.ontimeout = () => reject(new Error('Native request timed out.'));
    xhr.send(body);
  });
}

async function run(): Promise<Check[]> {
  const checks: Check[] = [];
  async function check(name: string, action: (stage: (name: string) => void) => Promise<void> | void) {
    let stage = 'check';
    try {
      await action((name) => {
        stage = name;
      });
      checks.push({ name, passed: true });
    } catch (error) {
      checks.push({ name, passed: false, failure: { category: failureCategory(error), stage } });
    }
  }

  await check('compiled API destination matches isolated server', () => {
    requireTrue(apiClient.defaults.baseURL === process.env.EXPO_PUBLIC_API_URL);
    requireTrue(getApiBaseUrl() === process.env.EXPO_PUBLIC_API_URL);
  });
  await check('native entropy', () => {
    const first = getRandomValues(new Uint8Array(32));
    const second = getRandomValues(new Uint8Array(32));
    requireTrue(first.some((byte) => byte !== 0) && first.some((byte, index) => byte !== second[index]));
  });
  await check('legacy session migration and ordinary storage', async (stage) => {
    stage('initial-sign-out');
    await clearTokens();
    stage('retired-marker-removal');
    await SecureStore.deleteItemAsync('session.retired.v1');
    stage('legacy-access-write');
    await SecureStore.setItemAsync('accessToken', pair.accessToken);
    stage('legacy-refresh-write');
    await SecureStore.setItemAsync('refreshToken', pair.refreshToken);
    stage('migrated-access-read');
    requireTrue((await getAccessToken()) === pair.accessToken);
    stage('migrated-refresh-read');
    requireTrue((await getRefreshToken()) === pair.refreshToken);
    stage('legacy-access-removal');
    requireTrue((await SecureStore.getItemAsync('accessToken')) === null);
    stage('legacy-refresh-removal');
    requireTrue((await SecureStore.getItemAsync('refreshToken')) === null);
    stage('ordinary-session-write');
    await storeTokens(pair);
  });
  await check('direct authenticated API and refresh', async (stage) => {
    stage('authenticated-request');
    const { data } = await apiClient.post<{ authenticated: boolean; bodyReceived: boolean }>('/direct', {
      secret: 'synthetic-sign-in',
    });
    stage('authenticated-response');
    requireTrue(data.authenticated && data.bodyReceived);
    stage('session-rotation');
    await rotateRefreshToken(pair.refreshToken);
    stage('rotated-refresh-read');
    requireTrue((await getRefreshToken()) === pair.refreshToken);
  });
  await check('redirect target reachability', async () => {
    const response = await request(`${target}/target-control`, 'POST', 'synthetic-control');
    const data = JSON.parse(response.responseText);
    requireTrue(response.status === 200 && data.bodyReceived && data.authenticated);
  });
  for (const status of [307, 308]) {
    await check(`native ${status} refusal`, async () => {
      const response = await request(
        `${process.env.EXPO_PUBLIC_API_URL}/redirect${status}`,
        'POST',
        'synthetic-refresh-and-sign-in',
      );
      requireTrue(response.status === status);
    });
  }
  await check('native cleartext refusal', async () => {
    let refused = false;
    try {
      await request(`${cleartext}/direct`, 'POST', 'synthetic-body');
    } catch (error) {
      refused = error instanceof Error && error.message === 'Native request refused.';
    }
    requireTrue(refused);
  });
  await check('repeated native refusal and cancellation completes', async () => {
    for (let index = 0; index < 8; index++) {
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const timeout = setTimeout(() => reject(new Error('Refusal cancellation timed out.')), 10000);
        const complete = () => {
          clearTimeout(timeout);
          resolve();
        };
        xhr.open('POST', `${cleartext}/direct`);
        xhr.setRequestHeader('Authorization', 'Bearer synthetic-access');
        xhr.setRequestHeader('Content-Type', 'text/plain');
        xhr.onerror = complete;
        xhr.onabort = complete;
        xhr.onload = () => {
          clearTimeout(timeout);
          reject(new Error('Cleartext request escaped.'));
        };
        xhr.send('synthetic-body');
        setTimeout(() => xhr.abort(), 0);
      });
    }
  });
  await check('native TLS trust refusal', async () => {
    let refused = false;
    try {
      await request(`${untrusted}/direct`);
    } catch (error) {
      refused = error instanceof Error && error.message === 'Native request refused.';
    }
    requireTrue(refused);
  });
  await check('binary download', async (stage) => {
    stage('document-fixture-decode');
    const bytes = new Uint8Array(Buffer.from(documentFixture.base64, 'base64'));
    stage('document-binary-download');
    const downloaded = await apiClient.get<ArrayBuffer>('/download', { responseType: 'arraybuffer' });
    stage('document-binary-response');
    const returned = new Uint8Array(downloaded.data);
    requireTrue(returned.length === bytes.length && returned.every((value, index) => value === bytes[index]));
  });
  await check('viewed document copies keep only the latest', async () => {
    const views = new Directory(Paths.cache, 'ledova-document-views-v1');
    const earlier = new File(views, 'earlier-view.pdf');
    const latest = new File(views, 'latest-view.pdf');
    const unowned = new File(Paths.cache, 'ledova-probe-unowned-view.pdf');
    try {
      for (const fixture of [earlier, unowned]) {
        fixture.create({ intermediates: true, overwrite: true });
        fixture.write('synthetic-fixture');
      }
      requireTrue(earlier.info().exists && unowned.info().exists);
      let shared = '';
      await shareDocumentCopy(
        getSessionEpoch(),

        async () => ({ name: 'latest-view.pdf', type: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) }),
        async (uri) => {
          shared = uri;
          requireTrue(new File(uri).info().exists);
        },
      );
      requireTrue(shared === latest.uri);
      requireTrue(!earlier.info().exists);
      requireTrue(unowned.info().exists);
    } finally {
      for (const fixture of [earlier, latest, unowned]) {
        if (fixture.info().exists) fixture.delete();
      }
    }
  });

  await check('progress and native cancellation', async () => {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', `${process.env.EXPO_PUBLIC_API_URL}/slow`);
      xhr.responseType = 'arraybuffer';
      xhr.timeout = 10000;
      xhr.onprogress = (event) => {
        if (event.loaded > 0) xhr.abort();
      };
      xhr.onabort = () => resolve();
      xhr.onerror = () => reject(new Error('Progress failed.'));
      xhr.ontimeout = () => reject(new Error('Progress timed out.'));
      xhr.send();
    });
  });
  await check('sign-out removes the native session', async (stage) => {
    stage('sign-out');
    await clearTokens();
    stage('signed-out-session-read');
    requireTrue((await getAccessToken()) === null && (await getRefreshToken()) === null);
  });
  await apiClient.post('/report', { checks });
  return checks;
}

function NativeProbe() {
  const [status, setStatus] = useState('Native probe running');
  useEffect(() => {
    run()
      .then((checks) => setStatus(checks.every((check) => check.passed) ? 'NATIVE_PROBE_PASS' : 'NATIVE_PROBE_FAIL'))
      .catch(() => setStatus('NATIVE_PROBE_REPORT_FAILED'));
  }, []);
  return (
    <View style={{ paddingTop: 64 }}>
      <Text testID="native-probe-status">{status}</Text>
    </View>
  );
}

registerRootComponent(NativeProbe);
