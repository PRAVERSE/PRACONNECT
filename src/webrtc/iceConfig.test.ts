// src/webrtc/iceConfig.test.ts
// Phase 6.6: unit tests for the environment-driven ICE/TURN configuration
// helper and the bounded ICE restart policy. Pure logic — runs under
// `npx tsx --test` without a browser.
//
// Run: npx tsx --test src/webrtc/iceConfig.test.ts

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIceConfig,
  parseIceUrlList,
  transportTypeOf,
  nextIceRestartDelayMs,
  ICE_RESTART,
  DEFAULT_STUN_SERVERS,
} from './iceConfig';

// ─── A. STUN-only configuration ──────────────────────────────────────────────

test('A: STUN-only config has no TURN entry and no credentials', () => {
  const { rtcConfig, diagnostics } = buildIceConfig({
    stunServers: 'stun:stun.l.google.com:19302',
  });
  assert.equal(rtcConfig.iceServers.length, 1, 'one STUN entry');
  assert.deepEqual(rtcConfig.iceServers[0].urls, ['stun:stun.l.google.com:19302']);
  assert.equal('username' in rtcConfig.iceServers[0], false, 'no TURN username attached');
  assert.equal('credential' in rtcConfig.iceServers[0], false, 'no TURN credential attached');
  assert.equal(rtcConfig.iceTransportPolicy, undefined, 'default policy allows host/srflx/relay');
  assert.equal(diagnostics.stunConfigured, true);
  assert.equal(diagnostics.turnConfigured, false);
  assert.equal(diagnostics.turnCount, 0);
});

// ─── B. TURN configuration ───────────────────────────────────────────────────

test('B: STUN + TURN URLs + username + credential attach correctly', () => {
  const { rtcConfig, diagnostics } = buildIceConfig({
    stunServers: 'stun:stun.l.google.com:19302',
    turnUrls: 'turn:turn.example.com:3478?transport=udp',
    turnUsername: 'user-1',
    turnCredential: 'cred-1',
  });
  assert.equal(rtcConfig.iceServers.length, 2, 'STUN entry + TURN entry');
  assert.deepEqual(rtcConfig.iceServers[0].urls, ['stun:stun.l.google.com:19302']);
  assert.deepEqual(rtcConfig.iceServers[1].urls, ['turn:turn.example.com:3478?transport=udp']);
  assert.equal(rtcConfig.iceServers[1].username, 'user-1');
  assert.equal(rtcConfig.iceServers[1].credential, 'cred-1');
  assert.equal(diagnostics.turnConfigured, true);
  assert.deepEqual(diagnostics.turnTransportTypes, ['udp']);
});

// ─── C. Multiple TURN URLs ───────────────────────────────────────────────────

test('C: all valid TURN URLs are included in one entry', () => {
  const urls = [
    'turn:turn.example.com:3478?transport=udp',
    'turn:turn.example.com:3478?transport=tcp',
    'turns:turn.example.com:5349?transport=tcp',
  ];
  const { rtcConfig, diagnostics } = buildIceConfig({
    turnUrls: urls.join(','),
    turnUsername: 'u',
    turnCredential: 'p',
  });
  assert.equal(rtcConfig.iceServers.length, 2, 'default STUN + TURN entry');
  assert.deepEqual(rtcConfig.iceServers[1].urls, urls);
  assert.equal(diagnostics.turnCount, 3);
  assert.deepEqual(diagnostics.turnTransportTypes, ['udp', 'tcp', 'tcp']);
});

// ─── D. Duplicate URLs ───────────────────────────────────────────────────────

test('D: duplicate URLs are removed', () => {
  const list = parseIceUrlList('stun:a:1,stun:b:2,stun:a:1, ,stun:b:2');
  assert.deepEqual(list, ['stun:a:1', 'stun:b:2']);
});

// ─── E. Whitespace ───────────────────────────────────────────────────────────

test('E: whitespace is trimmed and empty entries dropped', () => {
  const list = parseIceUrlList('  stun:a:1 ,  , stun:b:2  ', (u) => u.startsWith('stun:'));
  assert.deepEqual(list, ['stun:a:1', 'stun:b:2']);
});

// ─── F. Missing TURN username ────────────────────────────────────────────────

test('F: missing TURN username omits the TURN entry; STUN remains valid', () => {
  const { rtcConfig, diagnostics } = buildIceConfig({
    stunServers: 'stun:stun.l.google.com:19302',
    turnUrls: 'turn:turn.example.com:3478',
    turnUsername: '',
    turnCredential: 'secret-cred',
  });
  assert.equal(rtcConfig.iceServers.length, 1, 'STUN only');
  assert.deepEqual(rtcConfig.iceServers[0].urls, ['stun:stun.l.google.com:19302']);
  assert.equal(diagnostics.turnConfigured, false, 'no malformed TURN entry');
  assert.equal(diagnostics.turnCount, 1, 'URLs were present but rejected');
});

// ─── G. Missing TURN credential ──────────────────────────────────────────────

test('G: missing TURN credential omits the TURN entry; STUN remains valid', () => {
  const { rtcConfig, diagnostics } = buildIceConfig({
    stunServers: 'stun:stun.l.google.com:19302',
    turnUrls: 'turn:turn.example.com:3478',
    turnUsername: 'some-user',
    turnCredential: undefined,
  });
  assert.equal(rtcConfig.iceServers.length, 1, 'STUN only');
  assert.equal(diagnostics.turnConfigured, false);
});

// ─── H. Empty configuration ──────────────────────────────────────────────────

test('H: empty config degrades to default STUN-only, never malformed', () => {
  const { rtcConfig, diagnostics } = buildIceConfig({});
  assert.ok(rtcConfig.iceServers.length >= 1, 'default STUN servers present');
  assert.deepEqual(rtcConfig.iceServers[0].urls, DEFAULT_STUN_SERVERS);
  for (const server of rtcConfig.iceServers) {
    assert.ok(Array.isArray(server.urls) && server.urls.length > 0, 'no empty entries');
  }
  assert.equal(diagnostics.stunConfigured, true);
  assert.equal(diagnostics.turnConfigured, false);
});

// ─── H2. Non-STUN URLs are filtered out of the STUN bucket ──────────────────

test('H2: foreign-scheme URLs are dropped, defaults not duplicated', () => {
  const { rtcConfig } = buildIceConfig({
    stunServers: 'stun:stun.a:1,turn:turn.a:3478,not-a-url',
  });
  assert.deepEqual(rtcConfig.iceServers[0].urls, ['stun:stun.a:1']);
});

// ─── I. Credentials never leak into diagnostics ─────────────────────────────

test('I: TURN credential and username never appear in diagnostics', () => {
  const credential = 'super-secret-token-value';
  const username = 'ephemeral-user-name';
  const { diagnostics, rtcConfig } = buildIceConfig({
    stunServers: 'stun:stun.l.google.com:19302',
    turnUrls: 'turn:turn.example.com:3478',
    turnUsername: username,
    turnCredential: credential,
  });
  assert.equal(rtcConfig.iceServers[1].credential, credential, 'config carries the credential');
  const serialized = JSON.stringify(diagnostics);
  assert.ok(!serialized.includes(credential), 'diagnostics never contain the credential');
  assert.ok(!serialized.includes(username), 'diagnostics never contain the username');
});

// ─── I2. relayOnly opt-in ────────────────────────────────────────────────────

test('I2: relay-only is opt-in and default stays open', () => {
  const normal = buildIceConfig({ turnUrls: 'turn:turn.a:3478', turnUsername: 'u', turnCredential: 'p' });
  assert.equal(normal.rtcConfig.iceTransportPolicy, undefined);
  const relay = buildIceConfig({ relayOnly: true });
  assert.equal(relay.rtcConfig.iceTransportPolicy, 'relay');
  assert.equal(relay.diagnostics.relayOnly, true);
});

// ─── I3. Transport classification ────────────────────────────────────────────

test('I3: transport type classification covers udp/tcp/tls', () => {
  assert.equal(transportTypeOf('turn:a:3478?transport=udp'), 'udp');
  assert.equal(transportTypeOf('turn:a:3478?transport=tcp'), 'tcp');
  assert.equal(transportTypeOf('turn:a:3478'), 'udp', 'default transport is udp');
  assert.equal(transportTypeOf('turns:a:5349'), 'tls', 'turns: implies TLS');
  assert.equal(transportTypeOf('turns:a:5349?transport=tcp'), 'tcp');
});

// ─── J. ICE restart backoff policy ───────────────────────────────────────────

test('J: ICE restart retries are bounded with exponential backoff', () => {
  assert.equal(nextIceRestartDelayMs(1), ICE_RESTART.baseDelayMs, 'attempt 1: short delay');
  assert.equal(nextIceRestartDelayMs(2), ICE_RESTART.baseDelayMs * 2, 'attempt 2: longer delay');
  assert.equal(nextIceRestartDelayMs(3), ICE_RESTART.baseDelayMs * 4, 'attempt 3: longer still');
  assert.equal(nextIceRestartDelayMs(4), null, 'attempt 4: budget exhausted');
  assert.equal(nextIceRestartDelayMs(5), null, 'attempt 5: stays exhausted');
  assert.ok(ICE_RESTART.maxAttempts >= 3, 'at least three automatic retries');
});

test('J2: restart delays never exceed the configured cap', () => {
  const attempts = Array.from({ length: ICE_RESTART.maxAttempts }, (_, i) => nextIceRestartDelayMs(i + 1));
  for (const delay of attempts) {
    assert.ok(delay !== null && delay <= ICE_RESTART.maxDelayMs, `delay ${delay} within cap`);
  }
  for (let i = 1; i < attempts.length; i++) {
    assert.ok(attempts[i]! > attempts[i - 1]!, 'delays strictly increase');
  }
});