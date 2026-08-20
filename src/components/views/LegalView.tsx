import React, { useEffect } from 'react';
import { Shield, FileText, ArrowLeft, AlertCircle, ExternalLink, Mail, CheckCircle2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { LegalTab } from '../../types';
import { GlassPanel } from '../common/GlassPanel';

interface LegalViewProps {
  /** When rendered outside the AppShell (e.g., unauthenticated directly from login) */
  isStandalone?: boolean;
}

export const LegalView: React.FC<LegalViewProps> = ({ isStandalone = false }) => {
  const { legalTab, openLegal, setActiveTab, authState } = useApp();

  const handleTabChange = (tab: LegalTab) => {
    openLegal(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Scroll to top whenever the active document tab changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [legalTab]);

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      if (authState === 'unauthenticated') {
        setActiveTab('auth');
      } else {
        setActiveTab('settings');
      }
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto text-[var(--text-primary)] font-['Inter',sans-serif] select-text pb-16">
      {/* ─── TOP HEADER BAR ─────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-[var(--bg-canvas)]/85 backdrop-blur-md border-b border-[var(--border-hairline)] -mx-4 sm:-mx-8 md:-mx-16 px-4 sm:px-8 md:px-16 py-3.5 mb-8 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-colors duration-200">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBack}
            className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
            aria-label="Go back"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{authState === 'unauthenticated' ? 'Back to Sign In' : 'Back'}</span>
          </button>

          <div className="flex items-center gap-2 pl-2 border-l border-[var(--border-hairline)]">
            <span className="w-2 h-2 rounded-full bg-[var(--emphasis)] shadow-[0_0_8px_var(--emphasis-glow)] inline-block" />
            <span className="font-display font-bold text-sm tracking-tight text-[var(--text-primary)]">
              PraConnect Legal
            </span>
          </div>
        </div>

        {/* Tab switcher */}
        <nav
          className="flex items-center gap-1 p-1 bg-[var(--bg-surface)] border border-[var(--border-strong)] rounded-xl backdrop-blur-sm self-stretch sm:self-auto justify-center"
          role="tablist"
          aria-label="Legal Documents"
        >
          <button
            type="button"
            role="tab"
            aria-selected={legalTab === 'privacy'}
            onClick={() => handleTabChange('privacy')}
            className={`flex-1 sm:flex-initial px-4 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer ${
              legalTab === 'privacy'
                ? 'bg-[var(--emphasis)] text-[var(--bg)] shadow-[0_2px_10px_var(--emphasis-glow)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass)]'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Privacy Policy</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={legalTab === 'terms'}
            onClick={() => handleTabChange('terms')}
            className={`flex-1 sm:flex-initial px-4 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150 flex items-center justify-center gap-1.5 cursor-pointer ${
              legalTab === 'terms'
                ? 'bg-[var(--emphasis)] text-[var(--bg)] shadow-[0_2px_10px_var(--emphasis-glow)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-glass)]'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Terms &amp; Conditions</span>
          </button>
        </nav>
      </header>

      {/* ─── MAIN LEGAL DOCUMENT CONTAINER ─────────────────────────────────── */}
      <GlassPanel className="p-6 sm:p-10 md:p-12 shadow-2xl relative">
        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* 1. PRIVACY POLICY DOCUMENT                                          */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {legalTab === 'privacy' && (
          <article className="animate-fade-in space-y-6 text-sm text-[var(--text-secondary)] leading-relaxed">
            <div>
              <h1 className="font-display font-bold text-2xl sm:text-3xl text-[var(--text-primary)] tracking-tight">
                Privacy Policy
              </h1>
              <p className="text-xs font-mono text-[var(--text-tertiary)] mt-1">
                Last updated August 20, 2026
              </p>
            </div>

            {/* Legal Review Note Banner */}
            <div className="p-3.5 sm:p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs leading-relaxed flex items-start gap-3">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
              <div>
                <strong className="text-amber-200 font-semibold">Legal review note:</strong> This draft reflects PraConnect's current product features and data flows. Before public launch, confirm the legal entity/address, applicable jurisdiction, exact retention periods, age/consent flow, hosting region, and specific third-party providers with qualified counsel.
              </div>
            </div>

            <section className="space-y-3">
              <p>
                PraConnect (&quot;PraConnect&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) operates the PraConnect application and website (the &quot;Service&quot;). This Privacy Policy explains what information we collect, how we use it, how we protect it, and the choices available to you.
              </p>
              <p>
                By using the Service, you acknowledge the practices described in this policy.
              </p>
            </section>

            {/* Section 1 */}
            <section className="space-y-4 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                1. Information we collect
              </h2>

              <div className="space-y-3">
                <h3 className="font-display font-semibold text-sm text-[var(--text-primary)]">
                  1.1 Account and profile information
                </h3>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li><strong className="text-[var(--text-primary)]">Name</strong> — used to create and display your profile.</li>
                  <li><strong className="text-[var(--text-primary)]">Email address</strong> — used for authentication, verification, and service communications. Your email address is not displayed to other users through public profiles, search, friends, messaging, rooms, or realtime events.</li>
                  <li><strong className="text-[var(--text-primary)]">Username, bio, and avatar</strong> — used to identify and present your profile.</li>
                  <li><strong className="text-[var(--text-primary)]">Session information</strong> — used to maintain secure authenticated access.</li>
                </ul>

                <h3 className="font-display font-semibold text-sm text-[var(--text-primary)] pt-2">
                  1.2 Friends and social activity
                </h3>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>Friend requests, accepted friendships, room invitations, and related relationship state.</li>
                  <li>Online/offline presence and, where enabled, last-seen information.</li>
                </ul>

                <h3 className="font-display font-semibold text-sm text-[var(--text-primary)] pt-2">
                  1.3 Messages and shared files
                </h3>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li><strong className="text-[var(--text-primary)]">Direct messages</strong> — message content and metadata needed for messaging, delivery/read state, synchronization, search, replies, edits, reactions, pins, stars, forwarding, and deletion features.</li>
                  <li><strong className="text-[var(--text-primary)]">Chat attachments</strong> — images, videos, documents, and other supported files shared in conversations.</li>
                  <li><strong className="text-[var(--text-primary)]">Room chat</strong> — messages and related room activity.</li>
                </ul>

                <h3 className="font-display font-semibold text-sm text-[var(--text-primary)] pt-2">
                  1.4 Media Library and watch rooms
                </h3>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>Room membership, host/member state, room codes, invitations, playback state, and room chat.</li>
                  <li>Media metadata required for the Admin Media Library and room playback experience.</li>
                </ul>

                <h3 className="font-display font-semibold text-sm text-[var(--text-primary)] pt-2">
                  1.5 Calls and device permissions
                </h3>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li><strong className="text-[var(--text-primary)]">Camera</strong> — requested when you start or join a video call.</li>
                  <li><strong className="text-[var(--text-primary)]">Microphone</strong> — requested when you start or join an audio or video call.</li>
                  <li><strong className="text-[var(--text-primary)]">Call metadata</strong> — limited signaling information such as participants, call state, timestamps, and duration may be processed to establish, secure, maintain, and troubleshoot calls.</li>
                </ul>
                <p>
                  PraConnect does not intentionally record or store the audio or video content of 1-to-1 calls. WebRTC may establish a direct peer connection or use a TURN relay when direct connectivity is unavailable.
                </p>

                <h3 className="font-display font-semibold text-sm text-[var(--text-primary)] pt-2">
                  1.6 Realtime and notifications
                </h3>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>WebSocket/SSE connection state used for messaging, presence, typing, room updates, and call signaling.</li>
                  <li>Web Push subscription information when browser notifications are enabled.</li>
                </ul>

                <h3 className="font-display font-semibold text-sm text-[var(--text-primary)] pt-2">
                  1.7 Technical information
                </h3>
                <ul className="list-disc pl-5 space-y-1.5">
                  <li>IP address and basic connection information needed to operate and secure the Service.</li>
                  <li>Browser/device and diagnostic information when needed for security, troubleshooting, or reliability.</li>
                  <li>Operational logs needed to investigate errors, abuse, and service reliability.</li>
                </ul>
              </div>
            </section>

            {/* Section 2 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                2. How we use information
              </h2>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Create, authenticate, and maintain accounts.</li>
                <li>Provide profiles, friendships, messaging, rooms, media playback, and calling.</li>
                <li>Deliver messages, invitations, notifications, and realtime updates.</li>
                <li>Protect accounts, prevent abuse, enforce access controls, and maintain service security.</li>
                <li>Troubleshoot reliability, performance, and technical issues.</li>
                <li>Comply with applicable legal obligations.</li>
              </ul>
              <p>We do not sell your personal data to advertisers.</p>
            </section>

            {/* Section 3 */}
            <section className="space-y-4 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                3. Messages, media, and calls
              </h2>

              <div className="space-y-3">
                <h3 className="font-display font-semibold text-sm text-[var(--text-primary)]">
                  3.1 Messages
                </h3>
                <p>
                  PraConnect stores direct messages so conversations, delivery/read states, synchronization, search, and related features can work across sessions. PraConnect does not currently provide end-to-end encryption for direct messages.
                </p>

                <h3 className="font-display font-semibold text-sm text-[var(--text-primary)] pt-2">
                  3.2 Media
                </h3>
                <p>
                  Files shared in chat and videos published to the Media Library are stored as needed to provide those features. Large Media Library videos are streamed using partial HTTP range requests rather than being fully downloaded before playback.
                </p>

                <h3 className="font-display font-semibold text-sm text-[var(--text-primary)] pt-2">
                  3.3 Calls
                </h3>
                <p>
                  PraConnect uses WebRTC for 1-to-1 audio and video calls. Signaling is handled through PraConnect&apos;s realtime infrastructure. Network conditions may require a TURN relay to carry media traffic. PraConnect does not intentionally record calls.
                </p>
              </div>
            </section>

            {/* Section 4 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                4. Camera, microphone, and browser permissions
              </h2>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Camera and microphone access is requested only when a calling feature needs it.</li>
                <li>PraConnect does not intentionally access the camera or microphone while the Service is closed.</li>
                <li>You can revoke browser/device permissions at any time, although calling features may stop working.</li>
              </ul>
            </section>

            {/* Section 5 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                5. Sharing and service providers
              </h2>
              <p>
                PraConnect may use third-party infrastructure for services such as email delivery, push delivery, hosting/storage, network traversal or relay, and related operations. Those providers may process limited information required to provide their services.
              </p>
              <p>We do not sell chat content or call content to advertisers.</p>
              <p>
                The final published policy should list the actual providers and legal entity responsible for PraConnect once deployment details are finalized.
              </p>
            </section>

            {/* Section 6 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                6. Security
              </h2>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Data in transit is protected using HTTPS/TLS where supported by the Service.</li>
                <li>Authenticated requests are protected by server-side session and authorization checks.</li>
                <li>Private information such as email addresses is not included in public user objects or normal social/realtime payloads.</li>
                <li>Large media is streamed instead of being buffered as a complete file in application memory.</li>
              </ul>
              <p>No method of transmission or storage is completely secure, and we cannot guarantee absolute security.</p>
            </section>

            {/* Section 7 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                7. Data retention
              </h2>
              <p>
                We retain information only for as long as reasonably necessary to provide the Service, maintain security, comply with legal obligations, resolve disputes, and enforce our Terms.
              </p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Account and profile information is generally retained while your account remains active.</li>
                <li>Messages and shared content may remain until deleted, expired by a feature, or removed with the account, subject to applicable legal and operational requirements.</li>
                <li>Disappearing messages are removed according to the timer configured for the conversation.</li>
                <li>Some security, audit, and backup records may persist for a limited additional period.</li>
              </ul>
              <p>Exact retention periods should be finalized before public launch.</p>
            </section>

            {/* Section 8 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                8. Your rights and choices
              </h2>
              <p>
                Depending on where you live, you may have rights to access, correct, delete, or obtain a copy of your personal data, withdraw consent where consent is the legal basis, and raise complaints with the applicable data protection authority.
              </p>
              <p>
                Privacy and account requests can be sent to{' '}
                <a
                  href="mailto:praverse.auth@gmail.com"
                  className="text-[var(--text-primary)] underline hover:text-[var(--emphasis)] font-medium inline-flex items-center gap-1"
                >
                  <Mail className="w-3.5 h-3.5 inline" />
                  <span>praverse.auth@gmail.com</span>
                </a>.
              </p>
            </section>

            {/* Section 9 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                9. Children and age requirements
              </h2>
              <p>
                PraConnect must follow the minimum-age and consent requirements that apply in the user&apos;s jurisdiction. In India, the Digital Personal Data Protection Act defines a child as a person who has not completed eighteen years of age and requires verifiable parental or guardian consent for processing children&apos;s personal data, subject to statutory exemptions.
              </p>
              <p>
                The final PraConnect age gate and parental-consent flow should be confirmed and implemented before public launch.
              </p>
            </section>

            {/* Section 10 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                10. International processing
              </h2>
              <p>
                Your information may be processed in countries where PraConnect or its service providers operate, subject to applicable data-transfer laws and safeguards.
              </p>
              <p>
                The final published policy should identify the actual hosting/storage region and any material cross-border transfer arrangements.
              </p>
            </section>

            {/* Section 11 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                11. Changes to this policy
              </h2>
              <p>
                We may update this policy as the Service changes or legal requirements develop. We will update the &quot;Last updated&quot; date when material changes are made.
              </p>
            </section>

            {/* Section 12 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                12. Contact
              </h2>
              <p>
                Privacy questions:{' '}
                <a
                  href="mailto:praverse.auth@gmail.com"
                  className="text-[var(--text-primary)] underline hover:text-[var(--emphasis)] font-medium inline-flex items-center gap-1"
                >
                  <Mail className="w-3.5 h-3.5 inline" />
                  <span>praverse.auth@gmail.com</span>
                </a>
              </p>
            </section>

            {/* Document Footer */}
            <footer className="pt-6 border-t border-[var(--border-hairline)] text-xs text-[var(--text-tertiary)] italic">
              This is a product-policy draft, not legal advice. Before public launch, have it reviewed by qualified counsel for the jurisdictions in which PraConnect will operate.
            </footer>
          </article>
        )}

        {/* ─────────────────────────────────────────────────────────────────── */}
        {/* 2. TERMS & CONDITIONS DOCUMENT                                      */}
        {/* ─────────────────────────────────────────────────────────────────── */}
        {legalTab === 'terms' && (
          <article className="animate-fade-in space-y-6 text-sm text-[var(--text-secondary)] leading-relaxed">
            <div>
              <h1 className="font-display font-bold text-2xl sm:text-3xl text-[var(--text-primary)] tracking-tight">
                Terms &amp; Conditions
              </h1>
              <p className="text-xs font-mono text-[var(--text-tertiary)] mt-1">
                Last updated August 20, 2026
              </p>
            </div>

            <section className="space-y-3">
              <p>
                Welcome to PraConnect. These Terms &amp; Conditions (&quot;Terms&quot;) govern your use of the PraConnect application and website (the &quot;Service&quot;). By creating an account or using the Service, you agree to these Terms.
              </p>
              <p>
                If you do not agree to these Terms, do not use the Service.
              </p>
            </section>

            {/* Section 1 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                1. Eligibility
              </h2>
              <p>
                You may use PraConnect only if you meet the minimum-age and any parental-consent requirements that apply where you live. Where applicable law requires verified parental or guardian consent, the Service must obtain that consent before processing the relevant user&apos;s personal data.
              </p>
            </section>

            {/* Section 2 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                2. Account registration
              </h2>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Provide accurate information when creating or updating your account.</li>
                <li>Use an email address you control for authentication and verification.</li>
                <li>Keep your account credentials and session access secure.</li>
                <li>Do not impersonate another person or misuse another user&apos;s account.</li>
              </ul>
            </section>

            {/* Section 3 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                3. Friends, messaging, rooms, and content
              </h2>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>You are responsible for content you send through direct messages, room chat, attachments, and shared media.</li>
                <li>You may only access private conversations, rooms, media, and calling features you are authorized to access.</li>
                <li>Room hosts and participants must use shared content lawfully and respect other users&apos; rights.</li>
              </ul>
            </section>

            {/* Section 4 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                4. Camera and microphone
              </h2>
              <p>
                Certain features require camera and/or microphone access. You can deny or revoke permissions in your browser or device settings. Revoking them may disable audio/video calling.
              </p>
            </section>

            {/* Section 5 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                5. Acceptable use
              </h2>
              <p>You agree not to:</p>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>Harass, threaten, abuse, or intentionally harm other users.</li>
                <li>Share unlawful, defamatory, infringing, or otherwise prohibited content.</li>
                <li>Record or distribute another person&apos;s audio/video without the consent required by applicable law.</li>
                <li>Impersonate another person or misuse another user&apos;s account.</li>
                <li>Attempt to bypass authentication, authorization, rate limits, or other security controls.</li>
                <li>Interfere with the Service, its infrastructure, or another user&apos;s access.</li>
                <li>Use the Service to distribute malware or other harmful code.</li>
              </ul>
            </section>

            {/* Section 6 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                6. Calls
              </h2>
              <p>
                PraConnect provides 1-to-1 audio/video calls using WebRTC. Signaling and call authorization are handled by PraConnect, while media may travel directly between participants or through a TURN relay when required by network conditions.
              </p>
              <p>PraConnect does not intentionally record or store call audio/video.</p>
            </section>

            {/* Section 7 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                7. User content and intellectual property
              </h2>
              <p>You retain ownership of content you create, subject to rights others may have in that content.</p>
              <p>
                You grant PraConnect the limited rights necessary to host, store, transmit, process, display, synchronize, and deliver your content solely to operate the features you use.
              </p>
              <p>
                PraConnect&apos;s software, branding, interface, and original materials remain protected by applicable intellectual-property laws.
              </p>
            </section>

            {/* Section 8 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                8. Third-party services
              </h2>
              <p>
                PraConnect may depend on third-party infrastructure for hosting, email delivery, push notifications, network traversal/relay, storage, or other operational functions. Third-party availability and policies may affect the Service.
              </p>
            </section>

            {/* Section 9 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                9. Suspension and termination
              </h2>
              <p>
                PraConnect may restrict, suspend, or terminate access when reasonably necessary for security, abuse prevention, legal compliance, serious violations of these Terms, or protection of other users and the Service.
              </p>
              <p>
                You may request account deletion by contacting{' '}
                <a
                  href="mailto:praverse.auth@gmail.com"
                  className="text-[var(--text-primary)] underline hover:text-[var(--emphasis)] font-medium inline-flex items-center gap-1"
                >
                  <Mail className="w-3.5 h-3.5 inline" />
                  <span>praverse.auth@gmail.com</span>
                </a>, subject to verification and applicable legal/retention requirements.
              </p>
            </section>

            {/* Section 10 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                10. Service availability
              </h2>
              <ul className="list-disc pl-5 space-y-1.5">
                <li>The Service is provided on an &quot;as available&quot; basis.</li>
                <li>We do not guarantee uninterrupted or error-free operation.</li>
                <li>Network conditions, browsers, device permissions, third-party services, and maintenance may affect availability.</li>
              </ul>
            </section>

            {/* Section 11 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                11. Limitation of liability
              </h2>
              <p>
                To the maximum extent permitted by applicable law, PraConnect will not be liable for indirect, incidental, special, consequential, or similar losses arising from use of the Service, subject to any rights or remedies that cannot lawfully be excluded.
              </p>
            </section>

            {/* Section 12 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                12. Indemnification
              </h2>
              <p>
                To the extent permitted by applicable law, you agree to be responsible for claims or losses arising from your unlawful use of the Service or violation of these Terms.
              </p>
            </section>

            {/* Section 13 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                13. Governing law
              </h2>
              <p>
                The governing law and dispute venue must be finalized based on the legal entity operating PraConnect and the jurisdictions in which the Service is offered.
              </p>
            </section>

            {/* Section 14 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                14. Changes to these Terms
              </h2>
              <p>
                We may update these Terms as the Service or applicable law changes. Material updates will be reflected by changing the &quot;Last updated&quot; date.
              </p>
            </section>

            {/* Section 15 */}
            <section className="space-y-3 pt-2 border-t border-[var(--border-hairline)]">
              <h2 className="font-display font-semibold text-base sm:text-lg text-[var(--text-primary)]">
                15. Contact
              </h2>
              <p>
                Questions about these Terms:{' '}
                <a
                  href="mailto:praverse.auth@gmail.com"
                  className="text-[var(--text-primary)] underline hover:text-[var(--emphasis)] font-medium inline-flex items-center gap-1"
                >
                  <Mail className="w-3.5 h-3.5 inline" />
                  <span>praverse.auth@gmail.com</span>
                </a>
              </p>
            </section>

            {/* Document Footer */}
            <footer className="pt-6 border-t border-[var(--border-hairline)] text-xs text-[var(--text-tertiary)] italic">
              This is a product-policy draft, not legal advice. Before public launch, have it reviewed by qualified counsel for the jurisdictions in which PraConnect will operate.
            </footer>
          </article>
        )}
      </GlassPanel>
    </div>
  );
};
