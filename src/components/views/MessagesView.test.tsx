// src/components/views/MessagesView.test.tsx
// Source-level structure tests for the Messages page.
//
// Follows the repo's no-browser-framework convention (see
// src/webrtc/localMovie.test.ts and src/components/views/FriendsView.test.tsx):
// layout invariants are asserted directly against the component source with
// exact anchor strings.
//
// Run: npx tsx --test src/components/views/MessagesView.test.tsx

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const sourcePath = resolve(dirname(fileURLToPath(import.meta.url)), './MessagesView.tsx');
const appPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../App.tsx');
const source = readFileSync(sourcePath, 'utf8');
const app = readFileSync(appPath, 'utf8');

// ─── A. Compact rail header ───────────────────────────────────────────────────

test('A: Messages has a compact left rail header with Messages heading', () => {
  const h2Idx = source.indexOf('<h2');
  assert.ok(h2Idx >= 0, 'an <h2> must exist in rail header');
  const h2 = source.slice(h2Idx, source.indexOf('</h2>', h2Idx));
  assert.match(h2, /Messages/, 'rail heading copy must be "Messages"');
  assert.match(h2, /font-display font-bold text-base/, 'rail heading uses compact font-display');
});

// ─── B. Page-shell opt-out — Messages fills full height & width ─────────────

test('B: Messages opts out of generic page-shell padding; other pages keep it', () => {
  assert.match(
    app,
    /activeTab === 'room' \|\| activeTab === 'messages' \? '' : 'px-4 sm:px-8 md:px-16 py-8 md:py-10 md:pb-20'/,
    'Messages must take the no-page-padding path so its workspace can reach the bottom'
  );
});

test('B2: Messages root fills 100% height and width without top/horizontal page padding', () => {
  const rootIdx = source.indexOf('className="w-full h-full min-h-0 flex overflow-hidden');
  assert.ok(rootIdx >= 0, 'Messages root must be w-full h-full min-h-0 flex overflow-hidden');
  const rootTag = source.slice(rootIdx, source.indexOf('>', rootIdx));
  assert.doesNotMatch(rootTag, /px-4|px-8|px-16|pt-8|pt-10|py-/, 'root has no page padding — workspace occupies full viewport region');
});

test('B3: workspace is flex overflow-hidden, no height hacks', () => {
  assert.match(source, /className="w-full h-full min-h-0 flex overflow-hidden/, 'workspace fills full height');
  assert.doesNotMatch(source, /h-\[calc\(/, 'the calc height hack must not return');
  assert.doesNotMatch(source, /-mb-|-mt-/, 'no negative-margin height compensation');
});

// ─── C. No giant outer card ───────────────────────────────────────────────────

test('C: no giant outer card — the workspace shell has no card styling', () => {
  const rootIdx = source.indexOf('className="w-full h-full min-h-0 flex overflow-hidden');
  assert.ok(rootIdx >= 0);
  const rootTag = source.slice(rootIdx, source.indexOf('>', rootIdx));
  assert.doesNotMatch(rootTag, /rounded|max-w|mx-auto|shadow/, 'root must not be a centered card');
});

// ─── D. Rail width & vertical border separation ──────────────────────────────

test('D: rail has fixed width and thin border-r hairline separator', () => {
  const asideStart = source.indexOf('<aside');
  const asideTag = source.slice(asideStart, source.indexOf('>', asideStart));
  assert.match(asideTag, /md:w-\[280px\] lg:w-\[320px\]/, 'rail width is 280px on tablet, 320px on desktop');
  assert.match(asideTag, /border-r border-\[var\(--border-hairline\)\]/, 'rail uses hairline right border separator');
});

// ─── E. Conversation search remains inside rail ─────────────────────────────

test('E: the conversation search is inside the left rail, compact', () => {
  const asideStart = source.indexOf('<aside');
  const asideEnd = source.indexOf('</aside>');
  assert.ok(asideStart >= 0 && asideEnd > asideStart);
  const searchIdx = source.indexOf('placeholder="Search conversations..."');
  assert.ok(searchIdx > asideStart && searchIdx < asideEnd, 'search must live inside the conversation rail');
  assert.equal(source.indexOf('placeholder="Search conversations..."', searchIdx + 1), -1, 'no duplicate search bar');
});

// ─── F. Chat header renders friend identity + hairline ───────────────────────

test('F: selected-conversation header renders friend identity + call actions + hairline', () => {
  const headerIdx = source.indexOf('<header className="shrink-0');
  assert.ok(headerIdx >= 0);
  const header = source.slice(headerIdx, source.indexOf('</header>', headerIdx));
  assert.match(header, /border-b border-\[var\(--border-hairline\)\]/, 'thin bottom hairline under the header');
  assert.match(header, /@{activeFriend\.username}/, 'username is shown');
  assert.match(header, /Online' : 'Offline/, 'online/offline indicator is shown');
  assert.match(header, /onClick=\{handleInviteToWatch\}/, 'Invite to Watch stays wired');
});

// ─── G/H. Message list + composer in order ────────────────────────────────────

test('G+H: header → message list → composer order; composer pinned via shrink-0', () => {
  const headerIdx = source.indexOf('<header className="shrink-0');
  const listIdx = source.indexOf('overflow-y-auto no-scrollbar px-4 sm:px-6 py-5 space-y-3');
  const footerIdx = source.indexOf('<footer className="shrink-0');
  assert.ok(headerIdx >= 0 && listIdx > headerIdx && footerIdx > listIdx, 'header → messages → composer order required');
  const list = source.slice(listIdx - 100, listIdx + 100);
  assert.match(list, /flex-1 min-h-0/, 'message list must fill and be the scroll region');
  const footer = source.slice(footerIdx, footerIdx + 1600);
  assert.match(footer, /border-t border-\[var\(--border-hairline\)\]/, 'composer sits under a hairline divider');
  assert.match(footer, /onSubmit=\{handleSend\}/, 'send handler stays wired');
});

// ─── H2. Composer is the integrated bottom control ────────────────────────────

test('H2: composer input uses the shared .field + btn-primary send + Paperclip attachment', () => {
  const footerIdx = source.indexOf('<footer className="shrink-0');
  const footer = source.slice(footerIdx, footerIdx + 1600);
  assert.match(footer, /field flex-1 min-w-0 text-sm py-2\.5/, 'composer input uses the shared field style');
  assert.match(footer, /btn-primary/, 'send button uses the shared primary button style');
  assert.match(footer, /Paperclip/, 'attachment button remains present in composer');
});

// ─── I. Invite to Watch remains in the chat header ────────────────────────────

test('I: Invite to Watch control remains in the conversation header', () => {
  assert.match(source, /Invite to Watch/);
  const headerIdx = source.indexOf('<header className="shrink-0');
  const inviteIdx = source.indexOf('onClick={handleInviteToWatch}');
  const listIdx = source.indexOf('space-y-3');
  assert.ok(headerIdx >= 0 && inviteIdx > headerIdx && inviteIdx < listIdx, 'watch invite must stay wired in the header');
});

// ─── J. Empty state remains centered ──────────────────────────────────────────

test('J: the no-conversation-selected empty state is centered and restrained', () => {
  const emptyIdx = source.indexOf('Select a conversation');
  assert.ok(emptyIdx >= 0, 'empty state copy must exist');
  const region = source.slice(emptyIdx - 500, emptyIdx);
  assert.match(region, /flex items-center justify-center/, 'empty state must be centered');
  assert.match(region, /flex-1 min-h-0/, 'empty state must fill the chat area');
  assert.match(source, /Choose a friend from the left/, 'empty-state guidance remains');
});

// ─── K. Messaging logic untouched (safety) ────────────────────────────────────

test('K: messaging handlers remain unchanged', () => {
  assert.match(source, /sendDirectMessage\(activeDMId, messageInput\.trim\(\)/);
  assert.match(source, /openConversation\(friendId\)/);
  assert.match(source, /sendWatchInvite\(activeDMId, currentRoom\.id\)/);
  assert.match(source, /acceptWatchInvite\(inviteId\)/);
  assert.match(source, /declineWatchInvite\(invite\.id\)/);
  assert.match(source, /aria-label=\{`Message @\$\{activeFriend\.username\}`\}/);
  assert.match(source, /activeConversation \? 'hidden md:flex' : 'flex'/, 'mobile list/detail navigation preserved');
  assert.match(source, /activeFriend \? 'flex' : 'hidden md:flex'/, 'mobile list/detail navigation preserved');
});

// ─── L. Context menus remain wired ───────────────────────────────────────────

test('L: message and conversation context menus remain wired', () => {
  assert.match(source, /openMessageMenu\(msg, e\.clientX, e\.clientY\)/, 'message right-click opens the context menu');
  assert.match(source, /openConversationMenu\(conv\.friendId, e\.clientX, e\.clientY\)/, 'conversation right-click opens the context menu');
  assert.match(source, /messageLongPress\.onTouchStart\(e\)/, 'message long-press preserved');
  assert.match(source, /conversationLongPress\.onTouchStart\(e\)/, 'conversation long-press preserved');
  assert.match(source, /<ContextMenu/, 'ContextMenu component remains rendered');
});