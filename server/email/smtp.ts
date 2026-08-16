// server/email/smtp.ts
// Gmail SMTP email delivery service for PraConnect OTP verification and password reset.
// Uses Nodemailer directly with Google App Password authentication.
// Never logs plaintext OTPs or sensitive credentials.
// Always awaits SMTP send operation and strictly propagates delivery errors.

import nodemailer from 'nodemailer';

function getSmtpConfig() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();

  if (!user || !pass) {
    throw new Error('SMTP_NOT_CONFIGURED');
  }

  return {
    host,
    port,
    secure,
    auth: {
      user,
      // Google app passwords may include spaces when copied — strip them safely
      pass: pass.replace(/\s+/g, ''),
    },
  };
}

let cachedTransporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  const config = getSmtpConfig();
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport(config);
  }
  return cachedTransporter;
}

function getFromAddress(): string {
  const from = process.env.EMAIL_FROM;
  if (from && from.trim()) {
    return from.trim();
  }
  const user = process.env.SMTP_USER?.trim() || 'praverse.auth@gmail.com';
  return `PraConnect <${user}>`;
}

function getAppName(): string {
  return 'PraConnect';
}

// ─── Email Template Layout & Generators ───────────────────────────────────────

function renderEmailLayout({
  badgeText,
  title,
  greeting,
  description,
  otp,
  expiryMinutes,
  securityNote,
}: {
  badgeText: string;
  title: string;
  greeting: string;
  description: string;
  otp: string;
  expiryMinutes: number;
  securityNote: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#090a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f3f4f6;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#090a0f;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width:500px;background-color:#12151e;border-radius:16px;border:1px solid #1f2536;overflow:hidden;box-shadow:0 12px 36px rgba(0,0,0,0.45);">
          
          <!-- Header Branding -->
          <tr>
            <td style="padding:32px 32px 20px 32px;border-bottom:1px solid #1a2030;">
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <div style="display:inline-flex;align-items:center;gap:10px;">
                      <table role="presentation" border="0" cellspacing="0" cellpadding="0">
                        <tr>
                          <td style="width:36px;height:36px;background:linear-gradient(135deg, #6366f1 0%, #4338ca 100%);border-radius:10px;text-align:center;vertical-align:middle;color:#ffffff;font-size:20px;font-weight:900;line-height:36px;">
                            P
                          </td>
                          <td style="padding-left:12px;">
                            <span style="font-size:20px;font-weight:800;letter-spacing:-0.5px;color:#ffffff;">PraConnect</span>
                          </td>
                        </tr>
                      </table>
                    </div>
                  </td>
                  <td align="right">
                    <span style="display:inline-block;padding:4px 10px;background-color:#1c2233;color:#818cf8;border:1px solid #2d3748;border-radius:20px;font-size:11px;font-weight:600;letter-spacing:0.3px;text-transform:uppercase;">
                      ${badgeText}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding:32px 32px 28px 32px;">
              <h1 style="margin:0 0 12px 0;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.4px;line-height:1.3;">
                ${title}
              </h1>
              <p style="margin:0 0 8px 0;font-size:15px;color:#e2e8f0;line-height:1.5;">
                ${greeting}
              </p>
              <p style="margin:0 0 24px 0;font-size:14px;color:#94a3b8;line-height:1.6;">
                ${description}
              </p>

              <!-- OTP Box -->
              <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:24px 0;background-color:#0a0c12;border:1px solid #232a3d;border-radius:12px;text-align:center;">
                <tr>
                  <td style="padding:24px 16px;">
                    <div style="font-size:11px;font-weight:600;color:#64748b;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">
                      Your One-Time Code
                    </div>
                    <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#ffffff;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,Courier,monospace;padding-left:8px;">
                      ${otp}
                    </div>
                    <div style="margin-top:10px;font-size:12px;color:#94a3b8;">
                      Expires in <strong style="color:#f8fafc;">${expiryMinutes} minutes</strong>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Security Notice -->
              <div style="padding:14px 16px;background-color:#161b26;border-radius:10px;border-left:3px solid #6366f1;margin-bottom:20px;">
                <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">
                  <strong style="color:#e2e8f0;">Security tip:</strong> ${securityNote}
                </p>
              </div>

              <p style="margin:0;font-size:12px;line-height:1.5;color:#64748b;">
                If you did not make this request, you can safely ignore this email. No changes will be made to your account.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px 32px;background-color:#0e1017;border-top:1px solid #1a2030;text-align:center;">
              <p style="margin:0;font-size:11px;color:#475569;line-height:1.4;">
                &copy; ${new Date().getFullYear()} ${getAppName()}. All rights reserved.<br>
                This is an automated security transmission. Please do not reply directly to this email.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// 1. Account Verification Template
function emailAccountVerificationHtml(name: string, otp: string): string {
  return renderEmailLayout({
    badgeText: 'Account Verification',
    title: 'Verify your PraConnect account',
    greeting: `Hi ${name},`,
    description: `Welcome to ${getAppName()}! To complete your registration and secure your account, please enter the 6-digit verification code below.`,
    otp,
    expiryMinutes: 10,
    securityNote: 'Never share this code with anyone. PraConnect representatives will never ask for your code.',
  });
}

function emailAccountVerificationText(name: string, otp: string): string {
  return `Verify your PraConnect account\n\nHi ${name},\n\nWelcome to ${getAppName()}! To complete your registration, use the verification code below:\n\nVerification Code: ${otp}\n\nThis code expires in 10 minutes.\n\nNever share this code with anyone. If you did not create a PraConnect account, you can safely ignore this email.\n\n© ${new Date().getFullYear()} ${getAppName()}`;
}

// 2. Verification-Code Resend Template
function emailResendVerificationHtml(name: string, otp: string): string {
  return renderEmailLayout({
    badgeText: 'New Verification Code',
    title: 'Your PraConnect verification code',
    greeting: `Hi ${name},`,
    description: `You requested a new verification code for your ${getAppName()} account. Use the updated 6-digit code below to finish verifying your email address.`,
    otp,
    expiryMinutes: 10,
    securityNote: 'This code replaces any previously sent verification code and expires in 10 minutes.',
  });
}

function emailResendVerificationText(name: string, otp: string): string {
  return `Your PraConnect verification code\n\nHi ${name},\n\nHere is your requested PraConnect verification code:\n\nVerification Code: ${otp}\n\nThis code expires in 10 minutes.\n\nNever share this code with anyone. If you did not request this code, you can safely ignore this email.\n\n© ${new Date().getFullYear()} ${getAppName()}`;
}

// 3. Password Reset Template
function emailPasswordResetHtml(name: string, otp: string): string {
  return renderEmailLayout({
    badgeText: 'Password Reset',
    title: 'Update your PraConnect password',
    greeting: `Hi ${name},`,
    description: `We received a request to reset the password for your ${getAppName()} account. Enter the 6-digit code below to proceed with setting a new password.`,
    otp,
    expiryMinutes: 10,
    securityNote: 'If you did not request a password reset, please secure your email account immediately. Your PraConnect password remains unchanged until verified.',
  });
}

function emailPasswordResetText(name: string, otp: string): string {
  return `Update your PraConnect password\n\nHi ${name},\n\nWe received a request to reset your ${getAppName()} password. Use the 6-digit code below to proceed:\n\nPassword Reset Code: ${otp}\n\nThis code expires in 10 minutes.\n\nIf you did not request a password reset, you can safely ignore this email. Never share this code with anyone.\n\n© ${new Date().getFullYear()} ${getAppName()}`;
}

// ─── Core SMTP Send Service ───────────────────────────────────────────────────

export type OtpPurpose = 'email_verification' | 'account_verification' | 'resend_verification' | 'password_reset';

export interface SendOtpResult {
  success: boolean;
  messageId?: string;
}

export async function sendOtpEmail(
  to: string,
  name: string,
  otp: string,
  purpose: OtpPurpose
): Promise<SendOtpResult> {
  let subject: string;
  let html: string;
  let text: string;

  switch (purpose) {
    case 'resend_verification':
      subject = 'Your PraConnect verification code';
      html = emailResendVerificationHtml(name, otp);
      text = emailResendVerificationText(name, otp);
      break;

    case 'password_reset':
      subject = 'Update your PraConnect password';
      html = emailPasswordResetHtml(name, otp);
      text = emailPasswordResetText(name, otp);
      break;

    case 'account_verification':
    case 'email_verification':
    default:
      subject = 'Verify your PraConnect account';
      html = emailAccountVerificationHtml(name, otp);
      text = emailAccountVerificationText(name, otp);
      break;
  }

  try {
    const transporter = getTransporter();
    const from = getFromAddress();

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html,
    });

    if (!info || !info.messageId) {
      console.error('[smtp] Send completed but no messageId returned.');
      throw new Error('EMAIL_DELIVERY_FAILED');
    }

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (err) {
    if ((err as Error).message === 'SMTP_NOT_CONFIGURED') {
      console.error('[smtp] SMTP credentials missing in environment.');
      throw new Error('EMAIL_DELIVERY_FAILED');
    }
    // Log error message only — NEVER log the password or OTP
    console.error('[smtp] Email delivery error:', (err as Error).message);
    throw new Error('EMAIL_DELIVERY_FAILED');
  }
}

/**
 * Sends initial account verification email
 * Subject: "Verify your PraConnect account"
 */
export async function sendEmailVerificationOtp(
  to: string,
  name: string,
  otp: string
): Promise<SendOtpResult> {
  return sendOtpEmail(to, name, otp, 'account_verification');
}

/**
 * Sends resend verification code email
 * Subject: "Your PraConnect verification code"
 */
export async function sendResendVerificationOtp(
  to: string,
  name: string,
  otp: string
): Promise<SendOtpResult> {
  return sendOtpEmail(to, name, otp, 'resend_verification');
}

/**
 * Sends password reset code email
 * Subject: "Update your PraConnect password"
 */
export async function sendPasswordResetOtp(
  to: string,
  name: string,
  otp: string
): Promise<SendOtpResult> {
  return sendOtpEmail(to, name, otp, 'password_reset');
}

/**
 * Validates SMTP configuration at server startup without sending emails or exposing secrets.
 */
export async function validateSmtpConfiguration(): Promise<boolean> {
  try {
    const config = getSmtpConfig();
    const isConfigured = Boolean(config.auth.user && config.auth.pass);
    return isConfigured;
  } catch {
    return false;
  }
}
