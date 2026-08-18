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

// ─── A. Page header ───────────────────────────────────────────────────────────

test('A: Messages has a page header matching the Friends/Explore heading rhythm', () => {
  const h1Idx = source.indexOf('<h1');
  assert.ok(h1Idx >= 0, 'an <h1> must exist');
  const h1 = source.slice(h1Idx, source.indexOf('</h1>', h1Idx));
  assert.match(h1, /Messages/, 'heading copy must be "Messages"');
  assert.match(h1, /font-display font-bold tracking-\[-0.02em\]/, 'heading uses the PraConnect display type');
  assert.match(source, /flex items-start justify-between gap-4 pb-6 mb-0 border-b border-\[var\(--border-hairline\)\] shrink-0/, 'header row mirrors the Home/Explore/Settings page rhythm');
  assert.match(source, /New Message/, 'header offers the New Message action like Explore offers Create Room');
});

// ─── B. Horizontal header divider ────────────────────────────────────────────

test('B: the page header ends in a single thin hairline divider', () => {
  const headerIdx = source.indexOf('<header');
  const headerEnd = source.indexOf('</header>', headerIdx);
  const header = source.slice(headerIdx, headerEnd);
  assert.match(header, /border-b border-\[var\(--border-hairline\)\]/, 'header ends with the thin hairline');
  assert.match(header, /pb-6 mb-0/, 'spacing rhythm: pb-6, zero bottom margin');
  assert.doesNotMatch(source, /h-px w-full bg-\[var\(--border-hairline\)\]/, 'no standalone divider div — the header line is the only divider');
});

// ─── B. Page-shell opt-out — Messages fills the full main height ────────────

test('B: Messages opts out of the generic page-shell padding; other pages keep it', () => {
  assert.match(
    app,
    /activeTab === 'room' \|\| activeTab === 'messages' \? '' : 'px-4 sm:px-8 md:px-16 py-8 md:py-10 md:pb-20'/,
    'Messages must take the no-page-padding path so its workspace can reach the bottom'
  );
  assert.match(
    app,
    /'px-4 sm:px-8 md:px-16 py-8 md:py-10 md:pb-20'/,
    'Home/Explore/Friends/Games/Profile/Settings/Auth still use the generic page shell'
  );
});

test('B2: Messages root fills height, keeps page rhythm, has no bottom padding', () => {
  const rootIdx = source.indexOf('className="w-full h-full min-h-0 flex flex-col');
  assert.ok(rootIdx >= 0, 'Messages root must be h-full min-h-0 flex flex-col');
  const rootTag = source.slice(rootIdx, source.indexOf('>', rootIdx));
  assert.match(rootTag, /px-4 sm:px-8 md:px-16/, 'root keeps the standard left/right page rhythm');
  assert.match(rootTag, /pt-8 md:pt-10/, 'root keeps the standard top rhythm');
  assert.doesNotMatch(rootTag, /py-|pb-|mb-/, 'no vertical/bottom padding or margin on the root — workspace must reach the bottom');
  const wrapIdx = source.indexOf('className="flex-1 min-h-0 w-full flex overflow-hidden');
  assert.ok(wrapIdx >= 0, 'workspace must exist');
  const wrapTag = source.slice(wrapIdx, source.indexOf('>', wrapIdx));
  assert.doesNotMatch(wrapTag, /pb-|mb-/, 'workspace has no bottom padding or compensation');
});

test('B3: header is shrink-0, workspace is flex-1 min-h-0, no height hacks', () => {
  assert.match(source, /flex items-start justify-between gap-4 pb-6 mb-0 border-b border-\[var\(--border-hairline\)\] shrink-0/, 'page header is shrink-0');
  assert.match(source, /flex-1 min-h-0 w-full flex overflow-hidden/, 'workspace is flex-1 min-h-0');
  assert.doesNotMatch(source, /h-\[calc\(/, 'the calc height hack must not return');
  assert.doesNotMatch(source, /-mb-|-mt-/, 'no negative-margin height compensation');
});

// ─── C. No giant outer card ───────────────────────────────────────────────────

test('C: no giant outer card — the workspace shell has no card styling', () => {
  const rootIdx = source.indexOf('className="w-full h-full min-h-0 flex flex-col');
  assert.ok(rootIdx >= 0);
  const rootTag = source.slice(rootIdx, source.indexOf('>', rootIdx));
  assert.doesNotMatch(rootTag, /rounded|max-w|mx-auto|shadow/, 'root must not be a centered card');
  const wrapIdx = source.indexOf('className="flex-1 min-h-0 w-full flex overflow-hidden');
  assert.ok(wrapIdx >= 0);
  const wrapTag = source.slice(wrapIdx, source.indexOf('>', wrapIdx));
  assert.doesNotMatch(wrapTag, /rounded|max-w|mx-auto|shadow/, 'the two-pane wrapper must not be a card');
});

// ─── D. No thick vertical divider ─────────────────────────────────────────────

test('D: separation is by surface contrast only — no vertical rule', () => {
  const wrapIdx = source.indexOf('flex-1 min-h-0 w-full flex overflow-hidden');
  const modalIdx = source.indexOf('START NEW CHAT MODAL');
  const workspace = source.slice(wrapIdx, modalIdx);
  assert.doesNotMatch(workspace, /border-l|border-r|divide-x/, 'no vertical border or divider between panels');
  const asideStart = workspace.indexOf('<aside');
  const asideTag = workspace.slice(asideStart, workspace.indexOf('>', asideStart));
  assert.doesNotMatch(asideTag, /border|rounded/, 'rail itself has no border or radius shell');
});

// ─── D2. No outer shadow ──────────────────────────────────────────────────────

test('D2: no heavy shadows anywhere on the Messages page', () => {
  assert.doesNotMatch(source, /shadow-xl|shadow-2xl/, 'no heavy card shadows');
  const wrapIdx = source.indexOf('flex-1 min-h-0 w-full flex overflow-hidden');
  const wrapTag = source.slice(wrapIdx, source.indexOf('>', wrapIdx));
  assert.doesNotMatch(wrapTag, /shadow/, 'workspace wrapper has no shadow');
});

// ─── E. Conversation search remains ───────────────────────────────────────────

test('E: the conversation search is the only one, inside the rail, compact', () => {
  const asideStart = source.indexOf('<aside');
  const asideEnd = source.indexOf('</aside>');
  assert.ok(asideStart >= 0 && asideEnd > asideStart);
  const searchIdx = source.indexOf('placeholder="Search conversations..."');
  assert.ok(searchIdx > asideStart && searchIdx < asideEnd, 'search must live inside the conversation rail');
  assert.equal(source.indexOf('placeholder="Search conversations..."', searchIdx + 1), -1, 'no duplicate search bar');
  const searchField = source.slice(searchIdx - 200, searchIdx + 400);
  assert.match(searchField, /max-w-\[420px\]/, 'search is compact — capped at 420px');
  assert.match(searchField, /h-10/, 'search is compact — 40px tall');
  assert.match(searchField, /rounded-xl/, 'search is compact — small radius, not a 24px panel');
  assert.match(source, /shrink-0 px-1 pt-4 pb-3\.5 border-b border-\[var\(--border-hairline\)\]/, 'search section ends in a hairline');
});

// ─── F. Conversation rows are hairline-separated line rows, not cards ────────

test('F: conversation rows are hairline-separated line rows, not cards', () => {
  const rowIdx = source.indexOf('w-full px-1 py-3 flex items-center gap-3');
  assert.ok(rowIdx >= 0, 'conversation row must exist');
  const row = source.slice(rowIdx, rowIdx + 300);
  assert.match(row, /border-b border-\[var\(--border-hairline\)\]/, 'every row ends in a thin hairline rule');
  assert.match(source, /isSelected \? 'bg-\[var\(--bg-glass\)\]' : 'hover:bg-\[var\(--bg-glass\)\]'/, 'selected row uses the subtle glass wash, not a filled card');
  assert.doesNotMatch(row, /rounded-xl|rounded-2xl|shadow/, 'rows have no card shell');
});

// ─── F. Chat header remains ───────────────────────────────────────────────────

test('F: selected-conversation header renders friend identity + hairline', () => {
  const headerIdx = source.indexOf('<header className="shrink-0');
  assert.ok(headerIdx >= 0);
  const header = source.slice(headerIdx, headerIdx + 2200);
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
  const footer = source.slice(footerIdx, footerIdx + 400);
  assert.match(footer, /border-t border-\[var\(--border-hairline\)\]/, 'composer sits under a hairline divider');
  assert.match(footer, /onSubmit=\{handleSend\}/, 'send handler stays wired');
});

// ─── H2. Composer is the integrated bottom control ────────────────────────────

test('H2: composer input uses the shared .field + btn-primary send', () => {
  const footerIdx = source.indexOf('<footer className="shrink-0');
  const footer = source.slice(footerIdx, footerIdx + 800);
  assert.match(footer, /field flex-1 min-w-0 text-sm py-2\.5/, 'composer input uses the shared field style');
  assert.match(footer, /btn-primary/, 'send button uses the shared primary button style');
  assert.doesNotMatch(footer, /shadow/, 'composer is not a floating card');
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
  const bubble = source.slice(emptyIdx - 500, emptyIdx + 400);
  assert.doesNotMatch(bubble, /rounded-2xl|float-surface|shadow/, 'empty state must not look like a modal or card');
});

// ─── Rail + chat surface classes (design-system tokens only) ─────────────────

test('layout: rail and chat sit on ONE transparent page canvas — no panel blocks', () => {
  const asideStart = source.indexOf('<aside');
  const asideTag = source.slice(asideStart, source.indexOf('>', asideStart));
  assert.match(asideTag, /bg-transparent/, 'rail has NO background block — same canvas as the page');
  assert.doesNotMatch(asideTag, /bg-\[var\(--bg-surface-1\)\]|bg-\[var\(--bg-surface-2\)\]|bg-\[var\(--bg-canvas\)\]/, 'rail is NOT a filled panel');
  assert.match(asideTag, /md:w-\[280px\] lg:w-\[320px\]/, 'rail narrows on tablet, fixed on desktop');
  assert.match(asideTag, /shrink-0/, 'rail must not shrink');
  const sectionIdx = source.indexOf('<section');
  const sectionTag = source.slice(sectionIdx, source.indexOf('>', sectionIdx));
  assert.match(sectionTag, /bg-transparent/, 'chat area has NO background block — same canvas as the page');
  assert.doesNotMatch(sectionTag, /bg-\[var\(--bg-canvas\)\]|bg-\[var\(--bg-surface-1\)\]|bg-\[var\(--bg-surface-2\)\]/, 'chat area is NOT a filled panel');
  assert.match(sectionTag, /flex-1 min-w-0 min-h-0/, 'chat area fills remaining space');
});

// ─── K. Messaging logic untouched (safety) ────────────────────────────────────

test('K: messaging handlers remain unchanged', () => {
  assert.match(source, /sendDirectMessage\(activeDMId, messageInput\.trim\(\)\)/);
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

// ─── Old oversized title/subtitle never returns ───────────────────────────────

test('no-regression: the old "Direct Messages" heading and subtitle are gone', () => {
  assert.doesNotMatch(source, /Direct Messages/);
  assert.doesNotMatch(source, /Chat with friends, or invite them straight into your watch room\./);
});

// ─── No-regression: the chat-app box look is gone ────────────────────────────

test('no-regression: no panel blocks, outer border, or card wrappers anywhere', () => {
  assert.doesNotMatch(source, /bg-\[var\(--bg-surface-1\)\]|bg-\[var\(--bg-surface-2\)\]/, 'no surface block on the page');
  assert.doesNotMatch(source, /bg-\[var\(--bg-canvas\)\]/, 'no second paint layer — one continuous canvas');
  assert.doesNotMatch(source, /shadow-xl|shadow-2xl/, 'no heavy shadows');
  const wrapIdx = source.indexOf('flex-1 min-h-0 w-full flex overflow-hidden');
  const wrapTag = source.slice(wrapIdx, source.indexOf('>', wrapIdx));
  assert.doesNotMatch(wrapTag, /rounded|border|shadow/, 'workspace wrapper has no radius, border, or shadow');
  const sectionIdx = source.indexOf('<section');
  const sectionTag = source.slice(sectionIdx, source.indexOf('>', sectionIdx));
  assert.doesNotMatch(sectionTag, /rounded|border|shadow/, 'chat section has no radius, border, or shadow');
  const asideStart = source.indexOf('<aside');
  const asideTag = source.slice(asideStart, source.indexOf('>', asideStart));
  assert.doesNotMatch(asideTag, /border|rounded|shadow/, 'rail has no border, radius, or shadow shell');
});

test('J2: the no-conversations empty state is centered text on the canvas — no panel', () => {
  const emptyIdx = source.indexOf('No conversations yet');
  assert.ok(emptyIdx >= 0, 'empty-state copy must exist');
  const region = source.slice(emptyIdx - 500, emptyIdx + 300);
  assert.match(region, /items-center justify-center/, 'empty state is centered');
  assert.match(region, /Add friends from the Friends section to start chatting\./, 'empty-state guidance remains');
  assert.doesNotMatch(region, /rounded-2xl|float-surface|shadow/, 'empty state has no card shell');
});