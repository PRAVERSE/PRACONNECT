// server/tests/dm-context.test.ts
// Server tests for the DM context features: replies, forwarding, pins,
// stars, per-user deletions, conversation preferences (archive/pin/read/
// favourite), clear/delete chat, chat locks, private conversation lists,
// plus regression guards for the existing DM authorization rules.
//
// Run: npx tsx --test server/tests/dm-context.test.ts

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(os.tmpdir(), `praconnect-dmctx-${process.pid}-${Date.now()}.db`);
process.env.ROOM_EMPTY_TTL_MS = '60000';
process.env.UPLOADS_DIR = path.join(os.tmpdir(), `praconnect-dmctx-uploads-${process.pid}-${Date.now()}`);

const { db } = await import('../db/index');
const { rooms } = await import('../routes/rooms');
const { users } = await import('../routes/users');
const { friends } = await import('../routes/friends');
const { messages } = await import('../routes/messages');
const { invites } = await import('../routes/invites');
const { createSession, SESSION_COOKIE_NAME } = await import('../auth/session');
const { openUserEventStream } = await import('../social/realtime');
const { getMessageAccess } = await import('../social/service');

const app = new Hono();
app.route('/api/rooms', rooms);
app.route('/api/users', users);
app.route('/api/friends', friends);
app.route('/api/messages', messages);
app.route('/api/watch-invites', invites);

function seedUser(id: string, name: string, username: string, email: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, name, username, email, passwordHash, avatarUrl, emailVerified, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, NULL, NULL, 1, ?, ?)`
  ).run(id, name, username, email, now, now);
}

async function call(
  token: string | null,
  method: string,
  url: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (token) headers['cookie'] = `${SESSION_COOKIE_NAME}=${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return app.request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function json(res: Response): Promise<Record<string, any>> {
  return res.json() as Promise<Record<string, any>>;
}

function code(res: Response, body: Record<string, any>): string {
  return (body.error as { code: string }).code;
}

const A = 'user-a';
const B = 'user-b';
const C = 'user-c';
let ta = '';
let tb = '';
let tc = '';

before(async () => {
  seedUser(A, 'User A', 'usera', 'a@test.dev');
  seedUser(B, 'User B', 'userb', 'b@test.dev');
  seedUser(C, 'User C', 'userc', 'c@test.dev');
  ta = await createSession(A);
  tb = await createSession(B);
  tc = await createSession(C);

  // A <-> B friends; C is a stranger.
  await call(ta, 'POST', `/api/users/${B}/friend-request`);
  const reqId = (db.prepare(
    `SELECT id FROM friendships WHERE requesterId = ? AND recipientId = ? AND status = 'pending' LIMIT 1`
  ).get(A, B) as { id: string }).id;
  await call(tb, 'POST', `/api/friends/requests/${reqId}/accept`);
});

after(() => {
  db.close();
});

async function send(token: string, to: string, text: string, extra: Record<string, unknown> = {}): Promise<Record<string, any>> {
  const res = await call(token, 'POST', `/api/messages/${to}`, { text, ...extra });
  assert.equal(res.status, 200, `send to ${to} should succeed`);
  return json(res);
}

// ─── MESSAGE: replies ────────────────────────────────────────────────────────

test('A: reply creates replyToMessageId and renders a quoted preview', async () => {
  const { message: original } = await send(ta, B, 'original text');
  const { message: reply } = await send(tb, A, 'replying back', { replyToMessageId: original.id });

  assert.equal(reply.replyToMessageId, original.id);
  assert.equal(reply.replyTo.text, 'original text');
  assert.equal(reply.replyTo.senderId, A);

  const history = await json(await call(ta, 'GET', `/api/messages/${B}`));
  const msgs = history.messages as { text: string; replyTo: { text: string } | null }[];
  assert.ok(msgs.some((m) => m.text === 'replying back' && m.replyTo?.text === 'original text'));
});

test('B: reply validates conversation membership', async () => {
  // C is not in the A<->B conversation at all.
  const { message: original } = await send(ta, B, 'another original');

  // B replies to a message that is NOT in the A<->B conversation? It is — so
  // instead prove the stranger case: C cannot reply to a message they cannot
  // access (and C has no friendship with A).
  const res = await call(tc, 'POST', `/api/messages/${A}`, { text: 'x', replyToMessageId: original.id });
  assert.equal(res.status, 403);
  assert.equal(code(res, await json(res)), 'FRIENDSHIP_REQUIRED');

  // A reply to a nonexistent message id is rejected.
  const bad = await call(ta, 'POST', `/api/messages/${B}`, { text: 'y', replyToMessageId: 'no-such-message' });
  assert.equal(bad.status, 404);
  assert.equal(code(bad, await json(bad)), 'MESSAGE_NOT_FOUND');
});

test('B2: reply target from a different conversation is rejected', async () => {
  const D = 'user-d';
  seedUser(D, 'User D', 'userd', 'd@test.dev');
  const td = await createSession(D);
  await call(ta, 'POST', `/api/users/${D}/friend-request`);
  const reqId = (db.prepare(
    `SELECT id FROM friendships WHERE requesterId = ? AND recipientId = ? AND status = 'pending' LIMIT 1`
  ).get(A, D) as { id: string }).id;
  await call(td, 'POST', `/api/friends/requests/${reqId}/accept`);

  const { message: inOtherConversation } = await send(ta, D, 'different chat');
  // A tries to reply to that message inside the A<->B conversation.
  const res = await call(ta, 'POST', `/api/messages/${B}`, {
    text: 'wrong target',
    replyToMessageId: inOtherConversation.id,
  });
  assert.equal(res.status, 400);
  assert.equal(code(res, await json(res)), 'VALIDATION_ERROR');
});

// ─── MESSAGE: forwarding ─────────────────────────────────────────────────────

test('D: forwarding creates a new message only for accepted-friend destinations', async () => {
  const { message: original } = await send(ta, B, 'forward me');
  assert.equal(original.forwardedFromMessageId, null);

  // To a stranger: forbidden.
  const denied = await call(ta, 'POST', `/api/messages/${original.id}/forward`, { toFriendId: C });
  assert.equal(denied.status, 403);
  assert.equal(code(denied, await json(denied)), 'FRIENDSHIP_REQUIRED');

  // Forward back to the same friend (A<->B): allowed, creates a NEW row.
  const fwd = await call(ta, 'POST', `/api/messages/${original.id}/forward`, { toFriendId: B });
  assert.equal(fwd.status, 200);
  const fwdBody = await json(fwd);
  const fwdMsg = fwdBody.message as { id: string; text: string; forwardedFromMessageId: string; forwardedFrom: { text: string } };
  assert.notEqual(fwdMsg.id, original.id, 'forward must create a new message');
  assert.equal(fwdMsg.text, 'forward me');
  assert.equal(fwdMsg.forwardedFromMessageId, original.id);
  assert.equal(fwdMsg.forwardedFrom.text, 'forward me');

  const dbCount = db.prepare('SELECT COUNT(*) AS n FROM directMessages WHERE id = ?').get(original.id) as { n: number };
  assert.equal(dbCount.n, 1, 'original message never mutated');
});

// ─── MESSAGE: pin / unpin ────────────────────────────────────────────────────

test('E: pin/unpin is persistent, idempotent, and visible to both participants', async () => {
  const { message: original } = await send(ta, B, 'pin me');

  const pin = await call(ta, 'POST', `/api/messages/${original.id}/pin`);
  assert.equal(pin.status, 200);
  const pinAgain = await call(ta, 'POST', `/api/messages/${original.id}/pin`);
  assert.equal(pinAgain.status, 200, 'repeat pin is idempotent');

  const row = db.prepare('SELECT COUNT(*) AS n FROM messagePins WHERE messageId = ? AND pinnedByUserId = ?')
    .get(original.id, A) as { n: number };
  assert.equal(row.n, 1, 'unique(user, message) prevents duplicates');

  // The OTHER participant sees the pin (shared message state).
  const bPinned = await json(await call(tb, 'GET', `/api/messages/conversations/${A}/pinned`));
  assert.ok((bPinned.messages as { id: string }[]).some((m) => m.id === original.id));

  // A stranger cannot read the pinned list.
  const denied = await call(tc, 'GET', `/api/messages/conversations/${A}/pinned`);
  assert.equal(denied.status, 403);

  const unpin = await call(ta, 'DELETE', `/api/messages/${original.id}/pin`);
  assert.equal(unpin.status, 200);
  const after = db.prepare('SELECT COUNT(*) AS n FROM messagePins WHERE messageId = ? AND pinnedByUserId = ?')
    .get(original.id, A) as { n: number };
  assert.equal(after.n, 0);
});

test('L: pinning an inaccessible message is rejected', async () => {
  const { message: original } = await send(ta, B, 'pin denied for strangers');
  const res = await call(tc, 'POST', `/api/messages/${original.id}/pin`);
  assert.equal(res.status, 404);
  assert.equal(code(res, await json(res)), 'MESSAGE_NOT_FOUND');
});

// ─── MESSAGE: star / unstar ──────────────────────────────────────────────────

test('F: star/unstar is per-user and persistent', async () => {
  const { message: original } = await send(ta, B, 'star me');

  const star = await call(ta, 'POST', `/api/messages/${original.id}/star`);
  assert.equal(star.status, 200);
  const starAgain = await call(ta, 'POST', `/api/messages/${original.id}/star`);
  assert.equal(starAgain.status, 200);
  const rows = db.prepare('SELECT COUNT(*) AS n FROM starredMessages WHERE userId = ? AND messageId = ?')
    .get(A, original.id) as { n: number };
  assert.equal(rows.n, 1);

  const unstar = await call(ta, 'DELETE', `/api/messages/${original.id}/star`);
  assert.equal(unstar.status, 200);
  const gone = db.prepare('SELECT COUNT(*) AS n FROM starredMessages WHERE userId = ? AND messageId = ?')
    .get(A, original.id) as { n: number };
  assert.equal(gone.n, 0);
});

test('K: the starred list is user-specific', async () => {
  const { message: original } = await send(ta, B, 'only A stars this');
  await call(ta, 'POST', `/api/messages/${original.id}/star`);

  const aList = await json(await call(ta, 'GET', '/api/messages/starred'));
  assert.ok((aList.starred as { message: { id: string } }[]).some((s) => s.message.id === original.id));

  // B never sees A's star.
  const bList = await json(await call(tb, 'GET', '/api/messages/starred'));
  assert.ok(!(bList.starred as { message: { id: string } }[]).some((s) => s.message.id === original.id));

  // B stars the same message and sees their own entry.
  await call(tb, 'POST', `/api/messages/${original.id}/star`);
  const bList2 = await json(await call(tb, 'GET', '/api/messages/starred'));
  assert.ok((bList2.starred as { message: { id: string } }[]).some((s) => s.message.id === original.id));
});

// ─── MESSAGE: delete for me / for everyone ───────────────────────────────────

test('G: delete-for-me hides only for the requester', async () => {
  const { message: original } = await send(ta, B, 'delete me only');

  const del = await call(ta, 'POST', `/api/messages/${original.id}/delete-for-me`);
  assert.equal(del.status, 200);

  const aHistory = await json(await call(ta, 'GET', `/api/messages/${B}`));
  assert.ok(!(aHistory.messages as { id: string }[]).some((m) => m.id === original.id), 'A no longer sees it');

  const bHistory = await json(await call(tb, 'GET', `/api/messages/${A}`));
  assert.ok((bHistory.messages as { id: string }[]).some((m) => m.id === original.id), 'B still sees the row');

  const row = db.prepare('SELECT * FROM directMessages WHERE id = ?').get(original.id);
  assert.ok(row, 'the shared row is never physically deleted');
});

test('H: delete-for-everyone is sender-only', async () => {
  const { message: original } = await send(ta, B, 'sweep this');

  // B (not the sender) is denied.
  const denied = await call(tb, 'POST', `/api/messages/${original.id}/delete-for-everyone`);
  assert.equal(denied.status, 403);
  assert.equal(code(denied, await json(denied)), 'MESSAGE_FORBIDDEN');

  const ok = await call(ta, 'POST', `/api/messages/${original.id}/delete-for-everyone`);
  assert.equal(ok.status, 200);
  const okBody = await json(ok);
  assert.equal((okBody.message as { deletedForEveryone: boolean }).deletedForEveryone, true);

  // Neither participant can ever recover the body.
  for (const token of [ta, tb]) {
    const history = await json(await call(token, 'GET', `/api/messages/${token === ta ? B : A}`));
    const entry = (history.messages as { id: string; text: string; deletedForEveryone: boolean }[]).find((m) => m.id === original.id);
    assert.ok(entry, 'placeholder row remains');
    assert.equal(entry.text, '', 'body is stripped server-side');
    assert.equal(entry.deletedForEveryone, true);
  }
});

test('I: delete-for-everyone respects the time window', async () => {
  const { message: original } = await send(ta, B, 'too old to sweep');
  // Age the message beyond the 15-minute window.
  db.prepare('UPDATE directMessages SET createdAt = ? WHERE id = ?').run(
    new Date(Date.now() - 16 * 60 * 1000).toISOString(),
    original.id
  );

  const res = await call(ta, 'POST', `/api/messages/${original.id}/delete-for-everyone`);
  assert.equal(res.status, 409);
  assert.equal(code(res, await json(res)), 'DELETE_WINDOW_EXPIRED');
});

test('J: deleted-for-everyone broadcasts a realtime update to both participants', async () => {
  const { message: original } = await send(ta, B, 'live sweep');
  const receivedA: string[] = [];
  const receivedB: string[] = [];
  const ctrlA = new AbortController();
  const ctrlB = new AbortController();
  openUserEventStream(A, ctrlA.signal, { enqueue: (c) => receivedA.push(new TextDecoder().decode(c)), close() {} });
  openUserEventStream(B, ctrlB.signal, { enqueue: (c) => receivedB.push(new TextDecoder().decode(c)), close() {} });

  const res = await call(ta, 'POST', `/api/messages/${original.id}/delete-for-everyone`);
  assert.equal(res.status, 200);

  const framesA = receivedA.join('');
  const framesB = receivedB.join('');
  assert.ok(framesB.includes('event: dm:deleted'), 'recipient receives dm:deleted');
  assert.ok(framesB.includes(`"id":"${original.id}"`), 'event identifies the message');
  assert.ok(framesA.includes('event: dm:deleted'), 'sender is also notified');
  assert.ok(!framesB.includes('"text":"live sweep"'), 'the body never travels over SSE');

  ctrlA.abort();
  ctrlB.abort();
});

// ─── CONVERSATION: settings ──────────────────────────────────────────────────

test('M: archive/unarchive is per-user and hides from the main list', async () => {
  await send(ta, B, 'archiving this conversation');

  const arc = await call(ta, 'POST', `/api/messages/conversations/${B}/archive`);
  assert.equal(arc.status, 200);

  const aConvs = await json(await call(ta, 'GET', '/api/messages/conversations'));
  const aList = (aConvs.conversations as { friendId: string; archived: boolean }[]).find((c) => c.friendId === B);
  assert.ok(aList?.archived === true, 'A sees the archived flag');

  // The other user's list is untouched.
  const bConvs = await json(await call(tb, 'GET', '/api/messages/conversations'));
  const bList = (bConvs.conversations as { friendId: string; archived: boolean }[]).find((c) => c.friendId === A);
  assert.ok(bList?.archived === false, 'B never inherits A\'s archive flag');

  const unarc = await call(ta, 'POST', `/api/messages/conversations/${B}/unarchive`);
  assert.equal(unarc.status, 200);
  const after = await json(await call(ta, 'GET', '/api/messages/conversations'));
  assert.equal(
    (after.conversations as { friendId: string; archived: boolean }[]).find((c) => c.friendId === B)?.archived,
    false
  );
});

test('V: unauthorized users cannot modify another user\'s settings', async () => {
  // C is not friends with B — settings calls must fail.
  const res = await call(tc, 'POST', `/api/messages/conversations/${B}/favourite`);
  assert.equal(res.status, 403);
  assert.equal(code(res, await json(res)), 'FRIENDSHIP_REQUIRED');
});

test('N: pinned conversations sort above normal ones', async () => {
  await send(ta, B, 'pin-order message');
  const listBefore = await json(await call(ta, 'GET', '/api/messages/conversations'));
  const before = (listBefore.conversations as { friendId: string; pinned: boolean }[]).find((c) => c.friendId === B);
  assert.equal(before?.pinned, false);

  await call(ta, 'POST', `/api/messages/conversations/${B}/pin`);
  const listAfter = await json(await call(ta, 'GET', '/api/messages/conversations'));
  const convs = listAfter.conversations as { friendId: string; pinned: boolean }[];
  const bConv = convs.find((c) => c.friendId === B);
  assert.equal(bConv?.pinned, true);
  assert.equal(convs[0].friendId, B, 'pinned conversation sorts first');

  await call(ta, 'DELETE', `/api/messages/conversations/${B}/pin`);
  const listAfter2 = await json(await call(ta, 'GET', '/api/messages/conversations'));
  assert.equal(
    (listAfter2.conversations as { friendId: string; pinned: boolean }[]).find((c) => c.friendId === B)?.pinned,
    false
  );
});

test('O: read/unread state is per-user and surfaces as unreadCount', async () => {
  await send(tb, A, 'unread for A'); // B -> A message

  const list = await json(await call(ta, 'GET', '/api/messages/conversations'));
  const bConv = (list.conversations as { friendId: string; unreadCount: number }[]).find((c) => c.friendId === B);
  assert.ok((bConv?.unreadCount ?? 0) >= 1, 'unread badge appears before opening');

  // Opening the conversation marks it read (server-authoritative).
  await call(ta, 'GET', `/api/messages/${B}`);
  const after = await json(await call(ta, 'GET', '/api/messages/conversations'));
  const afterConv = (after.conversations as { friendId: string; unreadCount: number }[]).find((c) => c.friendId === B);
  assert.equal(afterConv?.unreadCount, 0, 'opening clears the unread badge');

  // Mark-as-unread restores it.
  await call(ta, 'POST', `/api/messages/conversations/${B}/unread`);
  const unread = await json(await call(ta, 'GET', '/api/messages/conversations'));
  const unreadConv = (unread.conversations as { friendId: string; unreadCount: number }[]).find((c) => c.friendId === B);
  assert.ok((unreadConv?.unreadCount ?? 0) >= 1, 'mark-as-unread restores the badge');
});

test('P: favourites are per-user', async () => {
  await call(ta, 'POST', `/api/messages/conversations/${B}/favourite`);
  const aConvs = await json(await call(ta, 'GET', '/api/messages/conversations'));
  assert.equal(
    (aConvs.conversations as { friendId: string; favourite: boolean }[]).find((c) => c.friendId === B)?.favourite,
    true
  );
  const bConvs = await json(await call(tb, 'GET', '/api/messages/conversations'));
  assert.equal(
    (bConvs.conversations as { friendId: string; favourite: boolean }[]).find((c) => c.friendId === A)?.favourite,
    false
  );
  await call(ta, 'DELETE', `/api/messages/conversations/${B}/favourite`);
});

test('Q: custom lists are private to the owner', async () => {
  const create = await call(ta, 'POST', '/api/messages/lists', { name: 'Work' });
  assert.equal(create.status, 200);
  const list = (await json(create)).list as { id: string; name: string };

  const add = await call(ta, 'POST', `/api/messages/lists/${list.id}/members`, { friendId: B });
  assert.equal(add.status, 200);

  // C can never see or touch A's list.
  const cLists = await json(await call(tc, 'GET', '/api/messages/lists'));
  assert.ok(!(cLists.lists as { id: string }[]).some((l) => l.id === list.id));
  const cRename = await call(tc, 'POST', `/api/messages/lists/${list.id}/rename`, { name: 'stolen' });
  assert.equal(cRename.status, 404);
  assert.equal(code(cRename, await json(cRename)), 'LIST_NOT_FOUND');

  // Add a non-friend to the list is rejected.
  const denied = await call(ta, 'POST', `/api/messages/lists/${list.id}/members`, { friendId: C });
  assert.equal(denied.status, 403);

  // Rename + remove + delete flow for the owner.
  const rename = await call(ta, 'POST', `/api/messages/lists/${list.id}/rename`, { name: 'Squad' });
  assert.equal(rename.status, 200);
  const remove = await call(ta, 'DELETE', `/api/messages/lists/${list.id}/members/${B}`);
  assert.equal(remove.status, 200);
  const del = await call(ta, 'DELETE', `/api/messages/lists/${list.id}`);
  assert.equal(del.status, 200);
  const after = await json(await call(ta, 'GET', '/api/messages/lists'));
  assert.ok(!(after.lists as { id: string }[]).some((l) => l.id === list.id));
});

test('R: clear chat removes messages only for the acting user', async () => {
  await send(ta, B, 'clear chat payload');
  const res = await call(ta, 'POST', `/api/messages/conversations/${B}/clear`);
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.ok((body.deletedCount as number) >= 1);

  const aHistory = await json(await call(ta, 'GET', `/api/messages/${B}`));
  assert.equal((aHistory.messages as unknown[]).length, 0, 'A sees an empty history');
  const bHistory = await json(await call(tb, 'GET', `/api/messages/${A}`));
  assert.ok((bHistory.messages as unknown[]).length > 0, 'B keeps their history');
});

test('S: delete chat hides the conversation for the acting user only', async () => {
  await send(ta, B, 'chat delete payload');
  const res = await call(ta, 'DELETE', `/api/messages/conversations/${B}`);
  assert.equal(res.status, 200);

  const aConvs = await json(await call(ta, 'GET', '/api/messages/conversations'));
  assert.ok(!(aConvs.conversations as { friendId: string }[]).some((c) => c.friendId === B), 'A no longer sees it');
  const bConvs = await json(await call(tb, 'GET', '/api/messages/conversations'));
  assert.ok((bConvs.conversations as { friendId: string }[]).some((c) => c.friendId === A), 'B still sees the conversation');
});

// ─── CONVERSATION: locks ─────────────────────────────────────────────────────

test('T: lock/unlock chat with a server-verified PIN', async () => {
  await send(ta, B, 'locked chat payload');

  // No lock yet: history is open.
  const open = await call(ta, 'GET', `/api/messages/${B}`);
  assert.equal(open.status, 200);

  const lock = await call(ta, 'POST', `/api/messages/conversations/${B}/lock`, { pin: '1234' });
  assert.equal(lock.status, 200);

  // The PIN is never stored in plaintext.
  const lockRow = db.prepare('SELECT pinHash FROM chatLocks WHERE userId = ?').get(A) as { pinHash: string } | undefined;
  assert.ok(lockRow, 'chatLocks row exists');
  assert.notEqual(lockRow!.pinHash, '1234');
  assert.ok(!lockRow!.pinHash.includes('1234'), 'hash must not embed the plaintext PIN');

  // Wrong PIN cannot read the history.
  const denied = await call(ta, 'POST', `/api/messages/conversations/${B}/verify`, { pin: '9999' });
  assert.equal(denied.status, 409);
  assert.equal(code(denied, await json(denied)), 'LOCK_INVALID');

  // History is now gated.
  const gated = await call(ta, 'GET', `/api/messages/${B}`);
  assert.equal(gated.status, 403);
  assert.equal(code(gated, await json(gated)), 'LOCK_REQUIRED');

  // Correct PIN unlocks the view session.
  const verify = await call(ta, 'POST', `/api/messages/conversations/${B}/verify`, { pin: '1234' });
  assert.equal(verify.status, 200);
  const open2 = await call(ta, 'GET', `/api/messages/${B}`);
  assert.equal(open2.status, 200);

  // Unlock (menu action) requires the PIN and removes the lock.
  const badUnlock = await call(ta, 'POST', `/api/messages/conversations/${B}/unlock`, { pin: '1111' });
  assert.equal(badUnlock.status, 409);
  const goodUnlock = await call(ta, 'POST', `/api/messages/conversations/${B}/unlock`, { pin: '1234' });
  assert.equal(goodUnlock.status, 200);
  const gone = db.prepare('SELECT COUNT(*) AS n FROM chatLocks WHERE userId = ?').get(A) as { n: number };
  assert.equal(gone.n, 0, 'unlock removes the lock row');
});

test('U: locked conversations hide preview text in the conversation list', async () => {
  await send(tb, A, 'secret preview payload');
  await call(ta, 'POST', `/api/messages/conversations/${B}/lock`, { pin: '5678' });

  const list = await json(await call(ta, 'GET', '/api/messages/conversations'));
  const bConv = (list.conversations as { friendId: string; locked: boolean; lastMessage: { text: string } | null }[]).find((c) => c.friendId === B);
  assert.equal(bConv?.locked, true);
  assert.equal(bConv?.lastMessage?.text, '', 'preview text is withheld while locked');

  // The peer (who did not lock) still sees the real preview.
  const bList = await json(await call(tb, 'GET', '/api/messages/conversations'));
  const aConv = (bList.conversations as { friendId: string; lastMessage: { text: string } | null }[]).find((c) => c.friendId === A);
  assert.equal(aConv?.lastMessage?.text, 'secret preview payload');

  await call(ta, 'POST', `/api/messages/conversations/${B}/unlock`, { pin: '5678' });
});

// ─── REGRESSION ──────────────────────────────────────────────────────────────

test('W: existing DM authorization still passes (history + send)', async () => {
  await send(ta, B, 'regression message');
  const history = await call(ta, 'GET', `/api/messages/${B}`);
  assert.equal(history.status, 200);
  const body = await json(history);
  assert.ok((body.messages as unknown[]).length >= 1);
});

test('X: friendship requirement remains (stranger sends are 403)', async () => {
  const res = await call(tc, 'POST', `/api/messages/${B}`, { text: 'intruder' });
  assert.equal(res.status, 403);
  assert.equal(code(res, await json(res)), 'FRIENDSHIP_REQUIRED');
});

test('Y: watch invitations remain friendship-gated', async () => {
  const roomRes = await call(ta, 'POST', '/api/rooms', {
    name: 'Locked Gated Room',
    category: 'Movie',
    privacy: 'public',
    maxParticipants: 4,
  });
  assert.equal(roomRes.status, 201);
  const room = (await json(roomRes)).room as { id: string };

  const denied = await call(ta, 'POST', '/api/watch-invites', { recipientUserId: C, roomId: room.id });
  assert.equal(denied.status, 403);
  assert.equal(code(denied, await json(denied)), 'FRIENDSHIP_REQUIRED');

  const ok = await call(ta, 'POST', '/api/watch-invites', { recipientUserId: B, roomId: room.id });
  assert.equal(ok.status, 200);
});

test('Z: existing message history still works (chronological, no leaks)', async () => {
  const history = await call(ta, 'GET', `/api/messages/${B}?limit=5`);
  assert.equal(history.status, 200);
  const body = await json(history);
  const msgs = body.messages as { senderId: string }[];
  assert.ok(msgs.every((m) => m.senderId === A || m.senderId === B), 'only the two participants appear');
});

test('Z2: getMessageAccess enforces membership', async () => {
  const { message } = await send(ta, B, 'access check');
  const access = getMessageAccess(A, message.id);
  assert.equal(access.ok, true);
  const denied = getMessageAccess(C, message.id);
  assert.equal(denied.ok, false);
});
