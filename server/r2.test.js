import test from 'node:test';
import assert from 'node:assert/strict';
import { linkTo, presign, r2Config, remove, sizeOf } from './r2.js';
import { startStandin } from './r2Standin.js';

test('a signed link matches the worked example in Amazon\'s own documentation', () => {
  // "Authenticating Requests: Using Query Parameters (AWS Signature Version 4)", the GET of test.txt.
  const url = presign({
    method: 'GET',
    origin: 'https://examplebucket.s3.amazonaws.com',
    path: '/test.txt',
    accessKey: 'AKIAIOSFODNN7EXAMPLE',
    secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    region: 'us-east-1',
    expires: 86400,
    now: new Date('2013-05-24T00:00:00Z'),
  });
  assert.equal(new URL(url).searchParams.get('X-Amz-Signature'), 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  assert.equal(new URL(url).searchParams.get('X-Amz-Credential'), 'AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request');
});

test('R2 is off unless all four variables are set, and points at the account\'s own address', () => {
  const names = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_ENDPOINT'];
  const before = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  try {
    for (const n of names) delete process.env[n];
    assert.equal(r2Config(), null);
    Object.assign(process.env, { R2_ACCOUNT_ID: 'abc123', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' });
    assert.equal(r2Config(), null, 'three of four is not enough');
    process.env.R2_BUCKET = 'video';
    assert.deepEqual(r2Config(), { accessKey: 'k', secret: 's', bucket: 'video', origin: 'https://abc123.r2.cloudflarestorage.com' });
    assert.match(linkTo(r2Config(), 'PUT', 'video/ab12/0.webm', 600), /^https:\/\/abc123\.r2\.cloudflarestorage\.com\/video\/video\/ab12\/0\.webm\?X-Amz-Algorithm=AWS4-HMAC-SHA256&/);
  } finally {
    for (const n of names) before[n] === undefined ? delete process.env[n] : (process.env[n] = before[n]);
  }
});

test('against the stand-in: a piece is put, measured, fetched and removed by signed links alone', async () => {
  const store = await startStandin({ accessKey: 'key', secret: 'secret', bucket: 'video' });
  const cfg = { accessKey: 'key', secret: 'secret', bucket: 'video', origin: `http://localhost:${store.port}` };
  try {
    const piece = Buffer.alloc(5000, 7);
    assert.equal(await sizeOf(cfg, 'video/x/0.webm'), null, 'not there yet');
    const put = await fetch(linkTo(cfg, 'PUT', 'video/x/0.webm', 60), { method: 'PUT', body: piece, headers: { 'Content-Type': 'video/webm' } });
    assert.equal(put.status, 200);
    assert.equal(await sizeOf(cfg, 'video/x/0.webm'), 5000);
    const got = await fetch(linkTo(cfg, 'GET', 'video/x/0.webm', 60));
    assert.equal(got.headers.get('content-type'), 'video/webm');
    assert.equal((await got.arrayBuffer()).byteLength, 5000);

    // A link is for one request on one object, and nothing else.
    const link = linkTo(cfg, 'GET', 'video/x/0.webm', 60);
    assert.equal((await fetch(link, { method: 'PUT', body: 'x' })).status, 403, 'a link to fetch cannot be used to put');
    assert.equal((await fetch(link.replace('0.webm', '1.webm'))).status, 403, 'nor to fetch another piece');
    assert.equal((await fetch(link.replace(/X-Amz-Signature=\w{6}/, 'X-Amz-Signature=000000'))).status, 403, 'nor with a made-up signature');
    assert.equal((await fetch(`http://localhost:${store.port}/video/video/x/0.webm`)).status, 403, 'nor with no signature at all');
    const wrongKey = linkTo({ ...cfg, secret: 'other' }, 'GET', 'video/x/0.webm', 60);
    assert.equal((await fetch(wrongKey)).status, 403, 'nor signed with another secret');
    const old = presign({ method: 'GET', origin: cfg.origin, path: '/video/video/x/0.webm', accessKey: 'key', secret: 'secret', expires: 60, now: new Date(Date.now() - 120_000) });
    assert.equal((await fetch(old)).status, 403, 'nor once it has run out');

    assert.equal(await remove(cfg, 'video/x/0.webm'), true);
    assert.equal(await sizeOf(cfg, 'video/x/0.webm'), null);
    assert.equal(await remove(cfg, 'video/x/0.webm'), true, 'removing what is not there is still gone');
    assert.equal(store.objects.size, 0);
  } finally {
    await store.close();
  }
});

test('a store that cannot be reached is an error when measuring and a plain "no" when removing', async () => {
  const cfg = { accessKey: 'key', secret: 'secret', bucket: 'video', origin: 'http://localhost:9' };
  await assert.rejects(() => sizeOf(cfg, 'video/x/0.webm'));
  assert.equal(await remove(cfg, 'video/x/0.webm'), false);
});
