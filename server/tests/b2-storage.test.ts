// server/tests/b2-storage.test.ts
// Unit tests for BackblazeB2MediaStorage with mocked HTTP / S3-compatible B2 requests.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BackblazeB2MediaStorage,
  isSafeStorageKey,
  MAX_STORAGE_KEY_LENGTH,
} from '../storage/mediaStorage';

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

test('BackblazeB2MediaStorage — initialization and region resolution', () => {
  const b2East = new BackblazeB2MediaStorage({
    applicationKeyId: 'test-key-id',
    applicationKey: 'test-secret-key',
    bucketName: 'my-b2-bucket',
    endpoint: 's3.us-east-005.backblazeb2.com',
  });

  assert.equal(b2East.endpoint, 's3.us-east-005.backblazeb2.com');
  assert.equal(b2East.region, 'us-east-005');
  assert.equal(b2East.bucketName, 'my-b2-bucket');

  // Test Canadian endpoint with https:// prefix
  const b2Canada = new BackblazeB2MediaStorage({
    applicationKeyId: 'test-key-id',
    applicationKey: 'test-secret-key',
    bucketName: 'praconnect-media',
    endpoint: 'https://s3.ca-east-006.backblazeb2.com',
  });

  assert.equal(b2Canada.endpoint, 's3.ca-east-006.backblazeb2.com');
  assert.equal(b2Canada.region, 'ca-east-006');
  assert.equal(b2Canada.bucketName, 'praconnect-media');
});

test('BackblazeB2MediaStorage — configuration error when credentials are missing', async () => {
  const b2Missing = new BackblazeB2MediaStorage({
    applicationKeyId: '',
    applicationKey: '',
    bucketName: '',
  });

  await assert.rejects(
    () => b2Missing.write('test.mp4', Buffer.from('abc')),
    /Backblaze B2 storage is not configured/
  );
  await assert.rejects(
    () => b2Missing.read('test.mp4'),
    /Backblaze B2 storage is not configured/
  );
});

test('BackblazeB2MediaStorage — rejects unsafe storage keys', async () => {
  const b2 = new BackblazeB2MediaStorage({
    applicationKeyId: 'test-key-id',
    applicationKey: 'test-secret-key',
    bucketName: 'my-b2-bucket',
  });

  const unsafeKeys = [
    '../traversal.mp4',
    '..\\traversal.mp4',
    '..',
    'dir/file.mp4',
    'dir\\file.mp4',
    '/absolute/path.mp4',
    'C:\\windows\\system32',
    '',
    'a'.repeat(MAX_STORAGE_KEY_LENGTH + 1),
    '.hidden',
  ];

  for (const key of unsafeKeys) {
    assert.equal(isSafeStorageKey(key), false);
    await assert.rejects(() => b2.write(key, Buffer.from('data')), /Unsafe storage key/);
    await assert.rejects(() => b2.read(key), /Unsafe storage key/);
    await assert.rejects(() => b2.delete(key), /Unsafe storage key/);
    await assert.rejects(() => b2.openWriteStream(key), /Unsafe storage key/);
    assert.equal(await b2.exists(key), false);
    assert.equal(await b2.stat(key), null);
  }
});

test('BackblazeB2MediaStorage — write and read round-trip (mocked fetch)', async () => {
  const originalFetch = globalThis.fetch;
  const mockStorage = new Map<string, { data: Uint8Array; headers: Record<string, string> }>();

  try {
    globalThis.fetch = (async (input: any, init?: any): Promise<Response> => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const url = new URL(urlStr);
      const method = (init?.method || 'GET').toUpperCase();
      const authHeader = (init?.headers as Record<string, string>)?.[
        Object.keys(init?.headers || {}).find((k) => k.toLowerCase() === 'authorization') || ''
      ];

      assert.ok(authHeader?.startsWith('AWS4-HMAC-SHA256'), 'Request must contain SigV4 authorization');

      const pathParts = url.pathname.split('/').filter(Boolean);
      const key = decodeURIComponent(pathParts[1] || '');

      if (method === 'PUT') {
        let bodyBytes: Uint8Array;
        if (init?.body instanceof Uint8Array) {
          bodyBytes = init.body;
        } else if (typeof init?.body === 'string') {
          bodyBytes = new TextEncoder().encode(init.body);
        } else if (init?.body && typeof (init.body as any).arrayBuffer === 'function') {
          bodyBytes = new Uint8Array(await (init.body as any).arrayBuffer());
        } else {
          bodyBytes = new Uint8Array(0);
        }
        mockStorage.set(key, {
          data: bodyBytes,
          headers: {
            'content-length': String(bodyBytes.byteLength),
          },
        });
        return new Response(null, { status: 200 });
      }

      if (method === 'GET') {
        const item = mockStorage.get(key);
        if (!item) {
          return new Response('Not Found', { status: 404 });
        }

        const rangeHeader = (init?.headers as Record<string, string>)?.[
          Object.keys(init?.headers || {}).find((k) => k.toLowerCase() === 'range') || ''
        ];

        if (rangeHeader) {
          const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
          if (match) {
            const start = parseInt(match[1], 10);
            const end = match[2] ? parseInt(match[2], 10) : item.data.byteLength - 1;
            const slice = item.data.slice(start, end + 1);
            return new Response(slice, {
              status: 206,
              headers: {
                'content-length': String(slice.byteLength),
                'content-range': `bytes ${start}-${end}/${item.data.byteLength}`,
              },
            });
          }
        }

        return new Response(item.data, {
          status: 200,
          headers: item.headers,
        });
      }

      if (method === 'HEAD') {
        const item = mockStorage.get(key);
        if (!item) {
          return new Response(null, { status: 404 });
        }
        return new Response(null, {
          status: 200,
          headers: item.headers,
        });
      }

      if (method === 'DELETE') {
        mockStorage.delete(key);
        return new Response(null, { status: 204 });
      }

      return new Response(null, { status: 400 });
    }) as any;

    const b2 = new BackblazeB2MediaStorage({
      applicationKeyId: 'test-id',
      applicationKey: 'test-secret',
      bucketName: 'test-bucket',
    });

    const key = 'media-file-123.mp4';
    const testContent = 'Backblaze B2 Storage Test Content 1234567890';

    // 1. Write
    await b2.write(key, Buffer.from(testContent));

    // 2. Exists
    assert.equal(await b2.exists(key), true);

    // 3. Stat
    const stat = await b2.stat(key);
    assert.equal(stat?.size, testContent.length);

    // 4. Read (full)
    const read = await b2.read(key);
    assert.ok(read);
    assert.equal(read.size, testContent.length);
    const readText = await streamToString(read.stream);
    assert.equal(readText, testContent);

    // 5. Read (range: first 9 bytes)
    const rangeRead = await b2.read(key, { start: 0, end: 8 });
    assert.ok(rangeRead);
    assert.equal(rangeRead.size, testContent.length);
    const rangeText = await streamToString(rangeRead.stream);
    assert.equal(rangeText, 'Backblaze');

    // 6. Delete
    await b2.delete(key);
    assert.equal(await b2.exists(key), false);
    assert.equal(await b2.stat(key), null);
    assert.equal(await b2.read(key), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('BackblazeB2MediaStorage — listKeys XML parsing (mocked fetch)', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (_input: any): Promise<Response> => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Name>test-bucket</Name>
    <Prefix>chunk-session-1-</Prefix>
    <KeyCount>3</KeyCount>
    <MaxKeys>1000</MaxKeys>
    <IsTruncated>false</IsTruncated>
    <Contents>
        <Key>chunk-session-1-000000</Key>
        <Size>1024</Size>
    </Contents>
    <Contents>
        <Key>chunk-session-1-000001</Key>
        <Size>1024</Size>
    </Contents>
    <Contents>
        <Key>chunk-session-1-000002</Key>
        <Size>512</Size>
    </Contents>
</ListBucketResult>`;
      return new Response(xml, {
        status: 200,
        headers: { 'content-type': 'application/xml' },
      });
    }) as any;

    const b2 = new BackblazeB2MediaStorage({
      applicationKeyId: 'test-id',
      applicationKey: 'test-secret',
      bucketName: 'test-bucket',
    });

    const keys = await b2.listKeys('chunk-session-1-');
    assert.deepEqual(keys, [
      'chunk-session-1-000000',
      'chunk-session-1-000001',
      'chunk-session-1-000002',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('BackblazeB2MediaStorage — openWriteStream streaming upload (mocked fetch)', async () => {
  const originalFetch = globalThis.fetch;
  let receivedBody: Buffer | null = null;

  try {
    globalThis.fetch = (async (_input: any, init?: any): Promise<Response> => {
      if (init?.body instanceof Uint8Array) {
        receivedBody = Buffer.from(init.body);
      } else if (typeof init?.body === 'string') {
        receivedBody = Buffer.from(init.body);
      }
      return new Response(null, { status: 200 });
    }) as any;

    const b2 = new BackblazeB2MediaStorage({
      applicationKeyId: 'test-id',
      applicationKey: 'test-secret',
      bucketName: 'test-bucket',
    });

    const writeStream = await b2.openWriteStream('streamed-item.mp4');
    writeStream.write(Buffer.from('chunk1-'));
    writeStream.write(Buffer.from('chunk2-'));
    writeStream.end(Buffer.from('chunk3'));

    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    assert.ok(receivedBody !== null);
    assert.equal((receivedBody as Buffer).toString('utf-8'), 'chunk1-chunk2-chunk3');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
