// server/storage/backblazeB2Storage.ts
// Backblaze B2 object storage implementation of MediaStorage.
//
// Uses Backblaze B2's S3-compatible API with AWS Signature Version 4 (SigV4)
// calculated via Web Crypto (crypto.subtle).
//
// Runs universally across Cloudflare Workers, Node.js 18+, Bun, and browsers
// with ZERO native binary or filesystem dependencies.
//
// Security & Safety:
//   - B2 application keys are never exposed to clients or printed in error logs.
//   - Safe storage key enforcement (defense in depth against path traversal).
//   - Range request support (200 / 206 Partial Content) for streaming media.

import { Readable, Writable } from 'node:stream';
import {
  MediaStorage,
  MediaReadResult,
  isSafeStorageKey,
} from './mediaStorage';

export interface BackblazeB2Config {
  applicationKeyId: string;
  applicationKey: string;
  bucketName: string;
  bucketId?: string;
  endpoint?: string;
  region?: string;
}

// ─── Web Crypto SigV4 & Hash Helpers ─────────────────────────────────────────

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

async function sha256Hex(data: string | Uint8Array | ArrayBuffer): Promise<string> {
  const bytes =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array
      ? data
      : new Uint8Array(data);
  const hash = await crypto.subtle.digest('SHA-256', bytes as any);
  return toHex(hash);
}

async function hmacSha256(
  key: ArrayBuffer | Uint8Array | string,
  data: string | Uint8Array
): Promise<ArrayBuffer> {
  const keyBytes =
    typeof key === 'string'
      ? new TextEncoder().encode(key)
      : key instanceof Uint8Array
      ? key
      : new Uint8Array(key);
  const dataBytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes as any,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return await crypto.subtle.sign('HMAC', cryptoKey, dataBytes as any);
}

async function getSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kDate = await hmacSha256('AWS4' + secretKey, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return await hmacSha256(kService, 'aws4_request');
}

// ─── BackblazeB2MediaStorage ──────────────────────────────────────────────────

export class BackblazeB2MediaStorage implements MediaStorage {
  readonly config: BackblazeB2Config;
  readonly endpoint: string;
  readonly region: string;
  readonly bucketName: string;

  constructor(config?: Partial<BackblazeB2Config>) {
    const keyId =
      config?.applicationKeyId ||
      (typeof process !== 'undefined' ? process.env?.B2_APPLICATION_KEY_ID : '') ||
      '';
    const appKey =
      config?.applicationKey ||
      (typeof process !== 'undefined' ? process.env?.B2_APPLICATION_KEY : '') ||
      '';
    const bucket =
      config?.bucketName ||
      (typeof process !== 'undefined' ? process.env?.B2_BUCKET_NAME : '') ||
      '';
    const endpointRaw =
      config?.endpoint ||
      (typeof process !== 'undefined' ? process.env?.B2_ENDPOINT : '') ||
      's3.us-west-004.backblazeb2.com';

    // Normalize endpoint (strip protocol, paths, and trailing slashes)
    const cleanEndpoint = endpointRaw
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .replace(/\/+$/, '')
      .trim();

    // Auto-detect region from endpoint (e.g. s3.ca-east-006.backblazeb2.com -> ca-east-006)
    const regionMatch = cleanEndpoint.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/i);
    const region =
      config?.region ||
      (regionMatch ? regionMatch[1] : null) ||
      (typeof process !== 'undefined' ? process.env?.B2_REGION : null) ||
      'us-west-004';

    this.config = {
      applicationKeyId: keyId,
      applicationKey: appKey,
      bucketName: bucket,
      bucketId: config?.bucketId || (typeof process !== 'undefined' ? process.env?.B2_BUCKET_ID : undefined),
      endpoint: cleanEndpoint,
      region,
    };

    this.endpoint = cleanEndpoint;
    this.region = region;
    this.bucketName = bucket;
  }

  /** Sign an HTTP request with AWS Signature Version 4 for B2's S3-compatible API. */
  private async signRequest(
    method: string,
    path: string,
    queryParams: Record<string, string> = {},
    headers: Record<string, string> = {},
    payloadSha256: string = 'UNSIGNED-PAYLOAD',
    date: Date = new Date()
  ): Promise<{ url: string; headers: Record<string, string> }> {
    if (!this.config.applicationKeyId || !this.config.applicationKey) {
      throw new Error('Backblaze B2 storage is not configured. Missing B2_APPLICATION_KEY_ID or B2_APPLICATION_KEY.');
    }
    if (!this.config.bucketName) {
      throw new Error('Backblaze B2 storage is not configured. Missing B2_BUCKET_NAME.');
    }

    const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, ''); // e.g. 20260821T033000Z
    const dateStamp = amzDate.substring(0, 8); // e.g. 20260821

    const reqHeaders: Record<string, string> = {
      ...headers,
      host: this.endpoint,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadSha256,
    };

    // Sort query params
    const searchParams = new URLSearchParams();
    const sortedParamKeys = Object.keys(queryParams).sort();
    for (const k of sortedParamKeys) {
      searchParams.set(k, queryParams[k]);
    }
    const queryString = searchParams.toString();

    // Sort headers
    const headerKeys = Object.keys(reqHeaders).map((k) => k.toLowerCase()).sort();
    let canonicalHeaders = '';
    for (const hk of headerKeys) {
      // Find original casing value
      const origKey = Object.keys(reqHeaders).find((k) => k.toLowerCase() === hk)!;
      canonicalHeaders += `${hk}:${reqHeaders[origKey].trim()}\n`;
    }
    const signedHeaders = headerKeys.join(';');

    // Normalize canonical URI
    const canonicalUri = path.startsWith('/') ? path : `/${path}`;

    // 1. Canonical Request
    const canonicalRequest = [
      method.toUpperCase(),
      canonicalUri,
      queryString,
      canonicalHeaders,
      signedHeaders,
      payloadSha256,
    ].join('\n');

    // 2. String to Sign
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      await sha256Hex(canonicalRequest),
    ].join('\n');

    // 3. Signature
    const signingKey = await getSigningKey(
      this.config.applicationKey,
      dateStamp,
      this.region,
      's3'
    );
    const signature = toHex(await hmacSha256(signingKey, stringToSign));

    // 4. Authorization Header
    reqHeaders['Authorization'] = `AWS4-HMAC-SHA256 Credential=${this.config.applicationKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const url = `https://${this.endpoint}${canonicalUri}${queryString ? `?${queryString}` : ''}`;
    return { url, headers: reqHeaders };
  }

  async write(key: string, data: any): Promise<void> {
    if (!isSafeStorageKey(key)) {
      throw new Error('Unsafe storage key rejected.');
    }

    let body: any = data;
    let contentLength: number | undefined;

    if (data && typeof data === 'object' && typeof data.pipe === 'function') {
      // Node Readable stream -> accumulate buffer to ensure exact Content-Length for S3 PUT
      const chunks: Buffer[] = [];
      for await (const chunk of data) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      body = Buffer.concat(chunks);
      contentLength = body.length;
    } else if (data instanceof Uint8Array || (typeof Buffer !== 'undefined' && Buffer.isBuffer(data))) {
      contentLength = data.byteLength || data.length;
    } else if (typeof data === 'string') {
      body = new TextEncoder().encode(data);
      contentLength = body.byteLength;
    }

    const headers: Record<string, string> = {
      'content-type': 'application/octet-stream',
    };
    if (typeof contentLength === 'number') {
      headers['content-length'] = String(contentLength);
    }

    const path = `/${this.bucketName}/${encodeURIComponent(key)}`;
    const signed = await this.signRequest('PUT', path, {}, headers);

    const res = await fetch(signed.url, {
      method: 'PUT',
      headers: signed.headers,
      body,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Backblaze B2 write failed (${res.status} ${res.statusText}): ${errText.slice(0, 200)}`);
    }
  }

  async openWriteStream(key: string): Promise<Writable> {
    if (!isSafeStorageKey(key)) {
      throw new Error('Unsafe storage key rejected.');
    }
    const { Writable } = await import('node:stream');
    const chunks: Buffer[] = [];
    const self = this;
    const writeStream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        callback();
      },
      async final(callback) {
        try {
          const fullBuffer = Buffer.concat(chunks);
          await self.write(key, fullBuffer);
          callback();
        } catch (err: any) {
          callback(err);
        }
      },
    });
    return writeStream;
  }

  async read(
    key: string,
    opts?: { start?: number; end?: number }
  ): Promise<MediaReadResult | null> {
    if (!isSafeStorageKey(key)) {
      throw new Error('Unsafe storage key rejected.');
    }

    const headers: Record<string, string> = {};
    if (opts) {
      if (typeof opts.start === 'number' || typeof opts.end === 'number') {
        const start = typeof opts.start === 'number' ? Math.max(0, opts.start) : 0;
        const end = typeof opts.end === 'number' ? opts.end : '';
        headers['Range'] = `bytes=${start}-${end}`;
      }
    }

    const path = `/${this.bucketName}/${encodeURIComponent(key)}`;
    const signed = await this.signRequest('GET', path, {}, headers);

    const res = await fetch(signed.url, {
      method: 'GET',
      headers: signed.headers,
    });

    if (res.status === 404 || res.status === 403) {
      return null;
    }

    if (!res.ok && res.status !== 206) {
      return null;
    }

    // Determine total size:
    // If Range was requested, S3 returns Content-Range: bytes start-end/totalSize
    let size = 0;
    const contentRange = res.headers.get('content-range');
    if (contentRange) {
      const match = contentRange.match(/\/(\d+|\*)$/);
      if (match && match[1] !== '*') {
        size = parseInt(match[1], 10);
      }
    }
    if (!size) {
      const cl = res.headers.get('content-length');
      if (cl) {
        size = parseInt(cl, 10);
      }
    }

    // Convert Web ReadableStream to Node Readable
    let stream: Readable;
    if (res.body && typeof (Readable as any).fromWeb === 'function') {
      stream = (Readable as any).fromWeb(res.body);
    } else {
      const arrayBuffer = await res.arrayBuffer();
      stream = Readable.from([Buffer.from(arrayBuffer)]);
    }

    return { stream, size };
  }

  async delete(key: string): Promise<void> {
    if (!isSafeStorageKey(key)) {
      throw new Error('Unsafe storage key rejected.');
    }

    const path = `/${this.bucketName}/${encodeURIComponent(key)}`;
    const signed = await this.signRequest('DELETE', path);

    const res = await fetch(signed.url, {
      method: 'DELETE',
      headers: signed.headers,
    });

    // 200, 204, or 404 are all considered successful deletion
    if (!res.ok && res.status !== 404 && res.status !== 204) {
      console.error(`[BackblazeB2] Delete operation returned ${res.status}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!isSafeStorageKey(key)) return false;

    const path = `/${this.bucketName}/${encodeURIComponent(key)}`;
    const signed = await this.signRequest('HEAD', path);

    const res = await fetch(signed.url, {
      method: 'HEAD',
      headers: signed.headers,
    });

    return res.status === 200 || res.status === 206;
  }

  async stat(key: string): Promise<{ size: number } | null> {
    if (!isSafeStorageKey(key)) return null;

    const path = `/${this.bucketName}/${encodeURIComponent(key)}`;
    const signed = await this.signRequest('HEAD', path);

    const res = await fetch(signed.url, {
      method: 'HEAD',
      headers: signed.headers,
    });

    if (res.status !== 200 && res.status !== 206) {
      return null;
    }

    const cl = res.headers.get('content-length');
    return { size: cl ? parseInt(cl, 10) : 0 };
  }

  async listKeys(prefix: string): Promise<string[]> {
    if (!prefix || !/^[a-zA-Z0-9._-]+$/.test(prefix)) {
      throw new Error('Unsafe storage prefix rejected.');
    }

    const path = `/${this.bucketName}`;
    const signed = await this.signRequest('GET', path, {
      'list-type': '2',
      prefix,
    });

    const res = await fetch(signed.url, {
      method: 'GET',
      headers: signed.headers,
    });

    if (!res.ok) {
      return [];
    }

    const xml = await res.text();
    const keys: string[] = [];
    const keyMatches = xml.matchAll(/<Key>(.*?)<\/Key>/g);
    for (const match of keyMatches) {
      if (match[1]) {
        keys.push(match[1]);
      }
    }
    return keys;
  }
}
