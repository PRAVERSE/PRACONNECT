// src/components/views/MediaLibraryView.test.tsx
// Phase A source-level structure tests for the Media Library UI + admin gating.
//
// These follow the repo's no-browser-framework convention (see
// FriendsView.test.tsx): UI structure invariants are asserted directly against
// the component source with exact anchor strings.
//
// Run: npx tsx --test src/components/views/MediaLibraryView.test.tsx

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8');

const viewSource = read('./MediaLibraryView.tsx');
const modalSource = read('../modals/UploadMediaModal.tsx');
const sidebarSource = read('../Sidebar.tsx');
const appSource = read('../../App.tsx');
const contextSource = read('../../context/AppContext.tsx');
const authApiSource = read('../../api/auth.ts');

// Every client source file that ships to the browser (test files excluded) —
// scanned in H below for hardcoded passwords/secrets.
const clientSources = [
  viewSource,
  modalSource,
  sidebarSource,
  appSource,
  contextSource,
  authApiSource,
  read('../../api/media.ts'),
  read('../../types.ts'),
];

// ─── A/F. Both admin and normal users see the Media Library page ─────────────

test('A+F: Media Library is a top-level view for every authenticated user', () => {
  // The view itself must not be gated behind isAdmin.
  assert.match(viewSource, /export const MediaLibraryView/, 'library view must exist');
  assert.doesNotMatch(
    viewSource.slice(0, viewSource.indexOf('export const MediaLibraryView')),
    /isAdmin/,
    'the view module must not gate its own existence on isAdmin'
  );
  // App.tsx must mount it unconditionally (like every other tab).
  assert.match(appSource, /MediaLibraryView/);
  const mount = appSource.slice(appSource.indexOf('{activeTab === \'library\''));
  assert.match(mount, /<MediaLibraryView \/>/, 'App.tsx must render the library view');
  assert.doesNotMatch(mount, /isAdmin/, 'mounting must never depend on isAdmin');
});

// ─── Navigation entry (both roles) ───────────────────────────────────────────

test('F2: the sidebar lists Media Library for every authenticated user', () => {
  assert.match(sidebarSource, /\{ id: 'library', label: 'Media Library'/);
  const navBlock = sidebarSource.slice(
    sidebarSource.indexOf('const navItems'),
    sidebarSource.indexOf('];', sidebarSource.indexOf('const navItems'))
  );
  assert.doesNotMatch(navBlock, /isAdmin/, 'nav entries must not be role-gated');
});

// ─── G. Role comes from the authenticated user state ─────────────────────────

test('G: admin flag derives from currentUser.role — never from email or input', () => {
  assert.match(contextSource, /const isAdmin = currentUser\?\.role === 'admin';/);
  assert.match(contextSource, /isAdmin: boolean;/, 'context exposes isAdmin');
  assert.match(contextSource, /isAdmin,/, 'context value provides isAdmin');
  assert.match(authApiSource, /role: 'admin' \| 'user'/, 'AuthUser carries the server role');
  // No email-based admin detection anywhere in the client.
  for (const src of clientSources) {
    assert.doesNotMatch(src, /email\s*===\s*['"]/, 'admin must never be detected by email');
  }
});

// ─── D. AppContext stores the full auth response user — role is never dropped ─

test('D: AppContext stores the full /api/auth/me user object (role included) and isAdmin stays reactive', () => {
  // Session bootstrap (/api/auth/me) stores the WHOLE response user — the
  // client never rebuilds the object in a way that could omit role.
  assert.match(
    contextSource,
    /setCurrentUser\(res\.user\)/,
    'refreshAuth must store the full /me user object (role included)'
  );
  assert.match(
    contextSource,
    /setCurrentUser\(user\)/,
    'login must store the full login-response user object (role included)'
  );
  // The auth API returns the raw JSON — no client-side re-mapping that could
  // drop the role field between the server and AppContext.
  assert.match(authApiSource, /return await res\.json\(\)/, 'getCurrentUser returns the raw server JSON');
  // isAdmin derives reactively from currentUser — it is never a frozen
  // initial value, so MediaLibraryView re-renders once auth completes.
  assert.match(
    contextSource,
    /const isAdmin = currentUser\?\.role === 'admin';/,
    'isAdmin must re-derive from currentUser on every render'
  );
  assert.match(
    contextSource,
    /authState: 'loading' \| 'authenticated' \| 'unauthenticated';/,
    'auth state is tri-state (loading) so the view mounts before auth resolves'
  );
  // The Media Library view consumes the same context flag — no duplicated or
  // shadowed admin state inside the view.
  assert.match(viewSource, /const \{ isAdmin, currentUser \} = useApp\(\);/, 'view reads isAdmin from the single app context');
});

// ─── B. Admin sees Upload Media ──────────────────────────────────────────────

test('B: Upload Media button is rendered for admins (header + empty state)', () => {
  assert.match(viewSource, /\{isAdmin && \(/, 'header upload block must be admin-gated');
  const headerBlock = viewSource.slice(
    viewSource.indexOf('{/* Upload Media — admin only'),
    viewSource.indexOf('{/* ─── SEARCH FIELD')
  );
  assert.match(headerBlock, /Upload Media/, 'header button label');
  assert.match(headerBlock, /setUploadOpen\(true\)/, 'header button opens the upload modal');
  assert.match(viewSource, /: isAdmin\n\s*\? 'No media in your library\.'/);
  const emptyBlock = viewSource.slice(viewSource.indexOf('{state === \'empty\''), viewSource.indexOf('{state === \'ready\''));
  assert.match(emptyBlock, /Upload Media/, 'empty state also offers the admin upload action');
});

// ─── C. Admin sees admin controls on media rows ──────────────────────────────

test('C: admin controls (Edit / Publish-Unpublish / Delete) are admin-gated', () => {
  const adminControls = viewSource.slice(
    viewSource.indexOf('{/* Admin-only controls'),
    viewSource.indexOf('</div>\n    </div>\n  );')
  );
  assert.match(adminControls, /\{isAdmin && \(/, 'controls block must be gated on isAdmin');
  assert.match(adminControls, /aria-label=\{`Edit \$\{item\.title\}`\}/);
  assert.match(adminControls, /item\.published \? `Unpublish/);
  assert.match(adminControls, /`Publish \$\{item\.title\}`/);
  assert.match(adminControls, /aria-label=\{`Delete \$\{item\.title\}`\}/);
  assert.match(adminControls, /Trash2/, 'Delete uses the trash icon');
  assert.match(adminControls, /EyeOff/, 'Unpublish uses the eye-off icon');
  assert.match(adminControls, /Eye/, 'Publish uses the eye icon');
});

// ─── D/E. Normal users never see upload or admin controls ───────────────────

test('D+E: Upload/Edit/Publish/Delete are unreachable outside isAdmin branches', () => {
  // Header upload button.
  const headerStart = viewSource.indexOf('{/* Upload Media — admin only');
  const headerEnd = viewSource.indexOf('{/* ─── SEARCH FIELD');
  const header = viewSource.slice(headerStart, headerEnd);
  assert.match(header, /\{isAdmin && \(/, 'upload button requires isAdmin');
  assert.doesNotMatch(
    viewSource.slice(headerEnd, viewSource.indexOf('state === \'empty\'')),
    /Upload Media/,
    'no upload button between header and empty state'
  );
  // Empty-state upload.
  const emptyBlock = viewSource.slice(viewSource.indexOf('{state === \'empty\''), viewSource.indexOf('{state === \'ready\''));
  assert.match(emptyBlock, /isAdmin && !activeSearch \? \(/, 'empty-state upload requires isAdmin');
  // Admin row controls.
  const adminControls = viewSource.slice(
    viewSource.indexOf('{/* Admin-only controls'),
    viewSource.indexOf('</div>\n    </div>\n  );')
  );
  assert.match(adminControls, /\{isAdmin && \(/, 'row controls require isAdmin');
  assert.doesNotMatch(
    viewSource.slice(viewSource.indexOf('{state === \'ready\'')),
    /aria-label=\{`Edit /,
    'ready-state rows must not render Edit outside the admin branch'
  );
});

// ─── H. No password is present in client code ────────────────────────────────

test('H: no password or admin secret is hardcoded in any client source file', () => {
  const banned = [
    /ADMIN_PASSWORD/,
    /passw?0?rd\s*[:=]\s*['"][^'"]+['"]/i,
    /admin\s*[:=]\s*['"][^'"]{6,}['"]/i,
    /secret\s*[:=]\s*['"][^'"]+['"]/i,
    /'admin123'/,
    /"admin123"/,
  ];
  for (const src of clientSources) {
    for (const pattern of banned) {
      assert.doesNotMatch(src, pattern, `no hardcoded secret pattern ${pattern} in client code`);
    }
  }
});

// ─── I. Empty states are correct per role ───────────────────────────────────

test('I: role-specific empty-state copy', () => {
  assert.match(viewSource, /'No media available yet\.'/, 'normal-user empty copy');
  assert.match(viewSource, /'No media in your library\.'/, 'admin empty copy');
  const emptyBlock = viewSource.slice(viewSource.indexOf('{state === \'empty\''), viewSource.indexOf('{state === \'ready\''));
  assert.match(emptyBlock, /: isAdmin\n\s*\? 'No media in your library\.'\s*:\s*'No media available yet\.'/);
});

// ─── J. Upload UI opens for admin ───────────────────────────────────────────

test('J: Upload Media opens the upload modal (header + empty state)', () => {
  assert.match(viewSource, /setUploadOpen\(true\)/, 'admin button opens the modal');
  assert.match(viewSource, /onClose=\{\(\) => setUploadOpen\(false\)\}/);
  assert.match(viewSource, /onUploaded=\{\(\) => load\(1, activeSearch, 'initial'\)\}/, 'the modal refreshes the library after upload');
  assert.match(viewSource, /const \[uploadOpen, setUploadOpen\] = useState\(false\)/);
});

// ─── Modal shell: form fields + honest submit ────────────────────────────────

test('J2: the upload modal runs the real chunked pipeline and never fakes success', () => {
  assert.match(modalSource, /createAdminMediaApi/, 'create metadata first');
  assert.match(modalSource, /startMediaUploadSessionApi/, 'starts a resumable upload session');
  assert.match(modalSource, /uploadMediaChunkApi/, 'PUTs one chunk per request');
  assert.match(modalSource, /completeMediaUploadSessionApi/, 'finalizes the session');
  assert.match(modalSource, /fetchAdminMediaItemApi/, 'polls the real server item after finalize');
  assert.match(modalSource, /\.slice\(start, end\)/, 'chunks are file.slice Blobs — never whole-file buffering');
  assert.match(modalSource, /getMediaUploadSessionApi/, 'resumes by re-fetching the session');
  assert.match(modalSource, /missingChunks/, 'only missing chunks are re-sent after a retry');
  assert.match(modalSource, /cancelMediaUploadSessionApi/, 'a failed upload cancels the dangling session');
  assert.match(modalSource, /deleteAdminMediaApi/, 'a failed upload deletes the draft row');
  assert.match(modalSource, /Title/, 'title field');
  assert.match(modalSource, /Description/, 'description field');
  assert.match(modalSource, /accept="video\/\*"/, 'video file field');
  assert.match(modalSource, /Allow download/, 'download-allowed toggle');
  assert.match(modalSource, /Publish now/, 'published toggle');
  assert.match(modalSource, /Cancel/, 'cancel button');
  assert.match(modalSource, /Create \/ Upload/, 'create/upload button');
  assert.match(modalSource, /role="progressbar"/, 'a real progress bar is rendered');
  assert.match(modalSource, /session\.receivedBytes \/ session\.totalBytes/, 'progress derives from server-acknowledged bytes');
  assert.doesNotMatch(modalSource, /file\.arrayBuffer\(\)/, 'never buffers the whole file in memory');
  assert.doesNotMatch(modalSource, /result\.ok = true|return \{ ok: true \}/, 'never pretends completion');
  assert.doesNotMatch(modalSource, /setTimeout\(.*done|onProgress/, 'no fabricated progress or completion timing');
});

// ─── J3. Empty missing-chunk lists must never skip the whole upload ─────────

test('J3: a fresh/empty missing-chunk list never skips the upload loop', () => {
  assert.match(
    modalSource,
    /initial\.missingChunks && initial\.missingChunks\.length > 0/,
    'only a NON-EMPTY missing list gates the skip logic'
  );
  assert.match(
    modalSource,
    /initial\.receivedBytes > 0 \|\| initial\.receivedChunks > 0/,
    'zero-progress sessions resolve the missing list from the server'
  );
  assert.match(modalSource, /missingChunks/);
  assert.doesNotMatch(
    modalSource,
    /missingChunks && !missingChunks\.includes\(index\)/,
    'the old empty-list-skip bug must not return'
  );
});

// ─── J4. Chunk sequencing: awaited, bounded, retried, abortable, never complete-on-failure ─

test('J4: chunk PUTs are awaited with bounded concurrency; complete only after all succeed', () => {
  assert.match(modalSource, /MAX_IN_FLIGHT_CHUNKS/, 'bounded-concurrency constant exists');
  assert.match(modalSource, /Promise\.all\(/, 'all chunk workers are awaited together');
  assert.doesNotMatch(modalSource, /Promise\.allSettled/, 'chunk failures are never settled-and-ignored');
  assert.match(modalSource, /CHUNK_RETRY_ATTEMPTS/, 'per-chunk retry cap exists');
  assert.match(
    modalSource,
    /Upload stopped at chunk \$\{index\}\. Please retry\./,
    'retry exhaustion stops the upload with a resumable message'
  );
  assert.match(modalSource, /AbortController/, 'cancel aborts in-flight requests');
  assert.match(
    modalSource,
    /Upload could not be completed\. Some parts were not uploaded\./,
    'missing parts surface a user-facing message, not chunk indexes'
  );
  assert.match(modalSource, /Retry Upload/, 'a failed upload offers Retry/Resume');
  assert.match(modalSource, /MEDIA UPLOAD DEBUG/, 'dev diagnostics are present');
  assert.match(modalSource, /file\.slice\(start, end\)/, 'chunks stay file.slice Blobs');
});

// ─── Loading / error states are prepared ────────────────────────────────────

test('loading+error: the view prepares loading, error, empty, and ready states', () => {
  assert.match(viewSource, /MediaLibraryState/, 'view consumes the typed state machine');
  assert.match(viewSource, /'loading'/, 'loading state');
  assert.match(viewSource, /'error'/, 'error state');
  assert.match(viewSource, /'empty'/, 'empty state');
  assert.match(viewSource, /'ready'/, 'ready state');
  assert.match(viewSource, /Loading your library\.\.\./, 'loading copy');
  assert.match(viewSource, /Try again/, 'error retry action');
  assert.match(viewSource, /fetchMediaLibraryApi/, 'library data comes from the API client');
});

// ─── No fake media, no fake URLs, no client-side fake filtering ─────────────

test('no-fake: no fabricated video URLs or client-side filtering of data', () => {
  assert.doesNotMatch(viewSource, /blob:/, 'no blob URLs');
  assert.doesNotMatch(viewSource, /\.mp4['"]|'https?:/i, 'no hardcoded media URLs');
  assert.doesNotMatch(viewSource, /\.filter\(/, 'no client-side fake filtering');
  assert.doesNotMatch(viewSource, /currentMedia|RoomView/, 'library is not wired to room playback');
});

// ─── Phase D: Multi-Admin Identical UI + Search + Play/Download Integrity ───

test('Phase D: Admin A and Admin B use identical UI state without email differentiation', () => {
  // Authorization is strictly role-based (isAdmin), never differentiating by email or username
  assert.doesNotMatch(viewSource, /sumansourabhj|sumanj15122008/, 'no hardcoded admin emails in view');
  assert.doesNotMatch(viewSource, /currentUser\?\.email\s*===/, 'no email branching in view');
  assert.doesNotMatch(modalSource, /currentUser\?\.email\s*===/, 'no email branching in upload modal');
});

test('Phase D: play/download controls and search behavior preserved for both roles', () => {
  assert.match(viewSource, /handlePlay/, 'view includes play handler');
  assert.match(viewSource, /handleDownload/, 'view includes download handler');
  assert.match(viewSource, /placeholder="Search media\.\.\."/, 'search input placeholder');
  assert.match(viewSource, /activeSearch/, 'tracks active search query state');
});