import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const mobile = path.resolve(import.meta.dirname, '../..');
const fixture = JSON.parse(fs.readFileSync(path.join(mobile, 'native-tests/documentFixture.json'), 'utf8'));
const bytes = Buffer.from(fixture.base64, 'base64');

test('the native transport probe carries the complete private PDF and rejects changed multipart facts', async () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ledova-probe-document-')));
  const server = spawn(process.execPath, [path.join(mobile, 'scripts/native-probe-server.mjs'), directory, 'ios'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const stopped = new Promise((resolve) => server.once('close', resolve));
  let diagnostic = '';
  server.stderr.on('data', (data) => (diagnostic += data));
  try {
    for (let attempt = 0; attempt < 300 && !fs.existsSync(path.join(directory, 'config.json')); attempt++) {
      assert.equal(server.exitCode, null, diagnostic);
      await delay(100);
    }
    assert.ok(fs.existsSync(path.join(directory, 'config.json')), diagnostic);
    const config = JSON.parse(fs.readFileSync(path.join(directory, 'config.json'), 'utf8'));
    const ca = fs.readFileSync(path.join(directory, 'ca.pem'));
    const request = (route, body, contentType) =>
      new Promise((resolve, reject) => {
        const outgoing = https.request(
          new URL(route, config.apiUrl),
          {
            method: body ? 'POST' : 'GET',
            ca,
            headers: contentType ? { 'Content-Type': contentType } : {},
            timeout: 10000,
          },
          (response) => {
            const parts = [];
            response.on('data', (part) => parts.push(part));
            response.on('end', () =>
              resolve({
                status: response.statusCode,
                type: response.headers['content-type'],
                body: Buffer.concat(parts),
              }),
            );
            response.on('error', reject);
          },
        );
        outgoing.on('error', reject);
        outgoing.on('timeout', () => outgoing.destroy(new Error('The owned document probe timed out.')));
        outgoing.end(body);
      });
    const multipart = (payload = bytes, name = fixture.name, mime = fixture.mimeType) =>
      Buffer.concat([
        Buffer.from(
          `--document-boundary\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${mime}\r\n\r\n`,
        ),
        payload,
        Buffer.from('\r\n--document-boundary--\r\n'),
      ]);
    assert.equal(bytes.length, fixture.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.sha256);
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    const uploaded = await request('/upload', multipart(), 'multipart/form-data; boundary=document-boundary');
    assert.equal(uploaded.status, 200);
    assert.equal(JSON.parse(uploaded.body).valid, true);
    const downloaded = await request('/download');
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.type, 'application/pdf');
    assert.deepEqual(downloaded.body, bytes);
    for (const body of [
      multipart(bytes.subarray(0, -1)),
      multipart(Buffer.concat([bytes, Buffer.from([0])])),
      multipart(bytes, 'wrong.pdf'),
      multipart(bytes, fixture.name, 'text/plain'),
      multipart(bytes, fixture.name, 'application/pdf-extra'),
    ]) {
      const refused = await request('/upload', body, 'multipart/form-data; boundary=document-boundary');
      assert.equal(refused.status, 200);
      assert.equal(JSON.parse(refused.body).valid, false);
    }
  } finally {
    server.kill('SIGTERM');
    await stopped;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
