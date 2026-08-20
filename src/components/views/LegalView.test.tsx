// src/components/views/LegalView.test.tsx
// Source-level structure and invariant tests for PraConnect Legal Page integration.
//
// Run: npx tsx --test src/components/views/LegalView.test.tsx

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const legalViewSource = readFileSync(resolve(here, './LegalView.tsx'), 'utf8');
const settingsViewSource = readFileSync(resolve(here, './SettingsView.tsx'), 'utf8');
const authViewSource = readFileSync(resolve(here, './AuthView.tsx'), 'utf8');
const appSource = readFileSync(resolve(here, '../../App.tsx'), 'utf8');
const appContextSource = readFileSync(resolve(here, '../../context/AppContext.tsx'), 'utf8');
const typesSource = readFileSync(resolve(here, '../../types.ts'), 'utf8');

// ─── 1. Types & NavigationTab ───────────────────────────────────────────────

test('1: types.ts defines legal in NavigationTab and LegalTab type', () => {
  assert.match(typesSource, /\|\s*'legal'/, 'NavigationTab must contain legal');
  assert.match(typesSource, /export type LegalTab\s*=\s*'privacy'\s*\|\s*'terms'/, 'LegalTab type must exist');
});

// ─── 2. LegalView Content Invariants ────────────────────────────────────────

test('2A: LegalView renders both Privacy Policy and Terms & Conditions tabs', () => {
  assert.match(legalViewSource, /role="tablist"/, 'must have tablist');
  assert.match(legalViewSource, /handleTabChange\('privacy'\)/, 'must allow switching to privacy');
  assert.match(legalViewSource, /handleTabChange\('terms'\)/, 'must allow switching to terms');
  assert.match(legalViewSource, /legalTab\s*===\s*'privacy'/, 'must conditionally render privacy');
  assert.match(legalViewSource, /legalTab\s*===\s*'terms'/, 'must conditionally render terms');
});

test('2B: LegalView preserves Privacy Policy sections and content', () => {
  assert.match(legalViewSource, /Privacy Policy/, 'must have Privacy Policy heading');
  assert.match(legalViewSource, /1\. Information we collect/, 'must have Section 1');
  assert.match(legalViewSource, /2\. How we use information/, 'must have Section 2');
  assert.match(legalViewSource, /3\. Messages, media, and calls/, 'must have Section 3');
  assert.match(legalViewSource, /4\. Camera, microphone, and browser permissions/, 'must have Section 4');
  assert.match(legalViewSource, /5\. Sharing and service providers/, 'must have Section 5');
  assert.match(legalViewSource, /6\. Security/, 'must have Section 6');
  assert.match(legalViewSource, /7\. Data retention/, 'must have Section 7');
  assert.match(legalViewSource, /8\. Your rights and choices/, 'must have Section 8');
  assert.match(legalViewSource, /9\. Children and age requirements/, 'must have Section 9');
  assert.match(legalViewSource, /10\. International processing/, 'must have Section 10');
  assert.match(legalViewSource, /11\. Changes to this policy/, 'must have Section 11');
  assert.match(legalViewSource, /12\. Contact/, 'must have Section 12');
  assert.match(legalViewSource, /praverse\.auth@gmail\.com/, 'must contain correct contact email');
});

test('2C: LegalView preserves Terms & Conditions sections and content', () => {
  assert.match(legalViewSource, /Terms &amp; Conditions|Terms & Conditions/, 'must have Terms heading');
  assert.match(legalViewSource, /1\. Eligibility/, 'must have Section 1');
  assert.match(legalViewSource, /2\. Account registration/, 'must have Section 2');
  assert.match(legalViewSource, /3\. Friends, messaging, rooms, and content/, 'must have Section 3');
  assert.match(legalViewSource, /4\. Camera and microphone/, 'must have Section 4');
  assert.match(legalViewSource, /5\. Acceptable use/, 'must have Section 5');
  assert.match(legalViewSource, /6\. Calls/, 'must have Section 6');
  assert.match(legalViewSource, /7\. User content and intellectual property/, 'must have Section 7');
  assert.match(legalViewSource, /8\. Third-party services/, 'must have Section 8');
  assert.match(legalViewSource, /9\. Suspension and termination/, 'must have Section 9');
  assert.match(legalViewSource, /10\. Service availability/, 'must have Section 10');
  assert.match(legalViewSource, /11\. Limitation of liability/, 'must have Section 11');
  assert.match(legalViewSource, /12\. Indemnification/, 'must have Section 12');
  assert.match(legalViewSource, /13\. Governing law/, 'must have Section 13');
  assert.match(legalViewSource, /14\. Changes to these Terms/, 'must have Section 14');
  assert.match(legalViewSource, /15\. Contact/, 'must have Section 15');
});

test('2D: LegalView preserves legal review note and product draft disclaimers', () => {
  assert.match(legalViewSource, /Legal review note:/, 'must preserve legal review note');
  assert.match(legalViewSource, /This is a product-policy draft, not legal advice\./, 'must preserve disclaimer footer');
});

// ─── 3. SettingsView Integration ────────────────────────────────────────────

test('3: SettingsView has a dedicated Legal section with direct tab links', () => {
  assert.match(settingsViewSource, /<SectionLabel>Legal<\/SectionLabel>/, 'SettingsView must have Legal SectionLabel');
  assert.match(settingsViewSource, /openLegal\('privacy'\)/, 'must have Privacy Policy link button');
  assert.match(settingsViewSource, /openLegal\('terms'\)/, 'must have Terms & Conditions link button');
});

// ─── 4. AuthView Integration ────────────────────────────────────────────────

test('4: AuthView has legal links and agreement text', () => {
  assert.match(authViewSource, /openLegal\('terms'\)/, 'must have clickable Terms link in AuthView');
  assert.match(authViewSource, /openLegal\('privacy'\)/, 'must have clickable Privacy link in AuthView');
  assert.match(authViewSource, /By continuing, you agree to our/, 'must have agreement disclaimer');
});

// ─── 5. App & Context Routing ───────────────────────────────────────────────

test('5A: App.tsx mounts LegalView for both Shell and unauthenticated states', () => {
  assert.match(appSource, /import\s*\{\s*LegalView\s*\}\s*from\s*'\.\/components\/views\/LegalView'/, 'must import LegalView');
  assert.match(appSource, /\{activeTab === 'legal' && <LegalView \/>\}/, 'must mount LegalView in MainContent');
  assert.match(appSource, /if\s*\(activeTab === 'legal'\)\s*\{\s*return\s*\([\s\S]*?<LegalView/, 'must render LegalView in AuthGate');
});

test('5B: AppContext provides openLegal and URL sync', () => {
  assert.match(appContextSource, /legalTab:\s*LegalTab/, 'AppContextType must declare legalTab');
  assert.match(appContextSource, /openLegal:\s*\(tab\?:\s*LegalTab\)\s*=>\s*void/, 'AppContextType must declare openLegal');
  assert.match(appContextSource, /popstate/, 'AppContext must listen to popstate for back/forward navigation');
  assert.match(appContextSource, /pushState/, 'AppContext must update URL on tab changes');
});
