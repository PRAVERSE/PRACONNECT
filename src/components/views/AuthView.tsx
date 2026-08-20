import React, { useState, useEffect } from 'react';
import {
  Mail,
  Lock,
  User,
  AtSign,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  KeyRound,
  ArrowLeft,
  ShieldCheck,
  Eye,
  EyeOff
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import {
  loginApi,
  signupApi,
  verifyEmailApi,
  resendVerificationApi,
  forgotPasswordApi,
  verifyPasswordResetApi,
  resetPasswordApi
} from '../../api/auth';

type AuthMode =
  | 'login'
  | 'signup'
  | 'verify-email'
  | 'forgot-password'
  | 'verify-password-reset'
  | 'new-password';

export const AuthView: React.FC = () => {
  const { login, openLegal } = useApp();

  const [mode, setMode] = useState<AuthMode>('login');

  // Form Fields
  const [identifier, setIdentifier] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  // UI State
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  // Parse OAuth errors from URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get('error');
    if (oauthError) {
      const errorMap: Record<string, string> = {
        google_denied: 'Google sign-in was cancelled or denied.',
        google_error: 'Google sign-in failed. Please try again.',
        google_unverified_email: 'Your Google email is not verified.',
        invalid_state: 'Security validation expired. Please try Google sign-in again.',
        invalid_callback: 'Invalid OAuth response received from Google.',
        server_error: 'An internal server error occurred during Google sign-in.',
      };
      setErrorMsg(errorMap[oauthError] || 'Authentication error. Please try again.');
      // Clean URL without reload
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Cooldown countdown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  const clearFeedback = () => {
    setErrorMsg('');
    setSuccessMsg('');
  };

  const switchMode = (newMode: AuthMode) => {
    clearFeedback();
    setMode(newMode);
  };

  // ─── LOGIN ──────────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();

    if (!identifier.trim() || !password) {
      setErrorMsg('Please enter your email/username and password.');
      return;
    }

    setLoading(true);
    try {
      const res = await loginApi(identifier.trim(), password);
      if (res.authenticated && res.user) {
        setSuccessMsg('Signed in successfully! Loading PraConnect...');
        setTimeout(() => {
          login(res.user!);
        }, 300);
      } else {
        if (res.error?.code === 'EMAIL_NOT_VERIFIED') {
          // If identifier looks like an email, prefill it for verification
          if (identifier.includes('@')) {
            setEmail(identifier.trim());
          }
          setErrorMsg('Please verify your email before logging in.');
        } else {
          setErrorMsg(res.error?.message || 'Invalid credentials. Please try again.');
        }
      }
    } catch {
      setErrorMsg('Network error. Unable to reach PraConnect servers.');
    } finally {
      setLoading(false);
    }
  };

  // ─── SIGNUP ─────────────────────────────────────────────────────────────────
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();

    if (!name.trim()) {
      setErrorMsg('Please enter your name.');
      return;
    }
    if (!username.trim()) {
      setErrorMsg('Please enter a username.');
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters long.');
      return;
    }
    if (!/[A-Z]/.test(password)) {
      setErrorMsg('Password must contain at least one uppercase letter.');
      return;
    }
    if (!/[0-9]/.test(password)) {
      setErrorMsg('Password must contain at least one number.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await signupApi(name.trim(), username.trim(), email.trim(), password);
      if (res.error) {
        setErrorMsg(res.error.message);
      } else {
        setSuccessMsg('Account created! Please check your email for the 6-digit verification code.');
        setResendCooldown(60);
        setMode('verify-email');
      }
    } catch {
      setErrorMsg('Network error. Unable to create account.');
    } finally {
      setLoading(false);
    }
  };

  // ─── VERIFY EMAIL OTP ───────────────────────────────────────────────────────
  const handleVerifyEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();

    if (!email.trim()) {
      setErrorMsg('Email address is required.');
      return;
    }
    const cleanOtp = otp.trim();
    if (!cleanOtp || cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
      setErrorMsg('Please enter the valid 6-digit code sent to your email.');
      return;
    }

    setLoading(true);
    try {
      const res = await verifyEmailApi(email.trim(), cleanOtp);
      if (res.authenticated && res.user) {
        setSuccessMsg('Email verified! Opening PraConnect workspace...');
        setTimeout(() => {
          login(res.user!);
        }, 300);
      } else {
        setErrorMsg(res.error?.message || 'Verification failed. Please try again.');
      }
    } catch {
      setErrorMsg('Network error. Unable to verify code.');
    } finally {
      setLoading(false);
    }
  };

  // ─── RESEND VERIFICATION OTP ────────────────────────────────────────────────
  const handleResendVerification = async () => {
    if (resendCooldown > 0 || !email.trim()) return;
    clearFeedback();
    setLoading(true);
    try {
      const res = await resendVerificationApi(email.trim());
      if (res.error) {
        setErrorMsg(res.error.message);
      } else {
        setSuccessMsg('A new verification code has been sent to your email.');
        setResendCooldown(60);
      }
    } catch {
      setErrorMsg('Unable to resend code right now. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  // ─── FORGOT PASSWORD ────────────────────────────────────────────────────────
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();

    if (!email.trim()) {
      setErrorMsg('Please enter your account email address.');
      return;
    }

    setLoading(true);
    try {
      const res = await forgotPasswordApi(email.trim());
      if (res.error) {
        setErrorMsg(res.error.message);
      } else {
        setSuccessMsg('If an account exists with this email, a 6-digit reset code has been sent.');
        setResendCooldown(60);
        setMode('verify-password-reset');
      }
    } catch {
      setErrorMsg('Network error. Unable to process request.');
    } finally {
      setLoading(false);
    }
  };

  // ─── VERIFY PASSWORD RESET OTP ──────────────────────────────────────────────
  const handleVerifyPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();

    if (!email.trim()) {
      setErrorMsg('Email address is required.');
      return;
    }
    const cleanOtp = otp.trim();
    if (!cleanOtp || cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
      setErrorMsg('Please enter the 6-digit code from your email.');
      return;
    }

    setLoading(true);
    try {
      const res = await verifyPasswordResetApi(email.trim(), cleanOtp);
      if (res.error || !res.resetToken) {
        setErrorMsg(res.error?.message || 'Invalid or expired code.');
      } else {
        setResetToken(res.resetToken);
        setSuccessMsg('Code verified! Please enter your new password.');
        setMode('new-password');
      }
    } catch {
      setErrorMsg('Network error. Unable to verify code.');
    } finally {
      setLoading(false);
    }
  };

  // ─── SET NEW PASSWORD ───────────────────────────────────────────────────────
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFeedback();

    if (newPassword.length < 8) {
      setErrorMsg('Password must be at least 8 characters long.');
      return;
    }
    if (!/[A-Z]/.test(newPassword)) {
      setErrorMsg('Password must contain at least one uppercase letter.');
      return;
    }
    if (!/[0-9]/.test(newPassword)) {
      setErrorMsg('Password must contain at least one number.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await resetPasswordApi(resetToken, newPassword);
      if (res.error) {
        setErrorMsg(res.error.message);
      } else {
        setSuccessMsg('Password reset successfully! You can now sign in with your new password.');
        setPassword('');
        setConfirmPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
        setResetToken('');
        setOtp('');
        setMode('login');
      }
    } catch {
      setErrorMsg('Network error. Unable to reset password.');
    } finally {
      setLoading(false);
    }
  };

  // ─── GOOGLE AUTH ────────────────────────────────────────────────────────────
  const handleGoogleAuth = () => {
    window.location.href = '/api/auth/google';
  };

  return (
    <div className="viewport-min-fill w-full flex flex-col justify-between items-center py-8 px-4 text-[var(--text-primary)] bg-[var(--bg-canvas)] select-none">
      <div className="w-full max-w-md my-auto flex flex-col items-center">
        {/* Top Logo & Brand */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-[var(--control-primary-bg)] text-[var(--control-primary-text)] flex items-center justify-center font-black text-xl shadow-md">
            P
          </div>
          <div className="flex flex-col">
            <span className="text-xl font-bold tracking-tight text-[var(--text-primary)] font-heading leading-tight">
              PraConnect
            </span>
            <span className="text-[10px] text-[var(--text-secondary)] font-mono uppercase tracking-widest font-semibold">
              WATCH TOGETHER
            </span>
          </div>
        </div>

        {/* Dynamic Heading & Subtitle */}
        <div className="text-center mb-6 w-full">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] font-heading">
            {mode === 'login' && 'Welcome back'}
            {mode === 'signup' && 'Create your PraConnect account'}
            {mode === 'verify-email' && 'Verify your email'}
            {mode === 'forgot-password' && 'Reset your password'}
            {mode === 'verify-password-reset' && 'Enter verification code'}
            {mode === 'new-password' && 'Set new password'}
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1.5 max-w-sm mx-auto">
            {mode === 'login' && 'Sign in to join live rooms, watch streams, and hangout with friends.'}
            {mode === 'signup' && 'Create an account to start streaming videos and gaming with your squad.'}
            {mode === 'verify-email' && `We sent a 6-digit verification code to ${email || 'your email'}.`}
            {mode === 'forgot-password' && "Enter your email address and we'll send you a password reset code."}
            {mode === 'verify-password-reset' && `Enter the 6-digit reset code sent to ${email || 'your email'}.`}
            {mode === 'new-password' && 'Create a strong, secure new password for your account.'}
          </p>
        </div>

        {/* Feedback Banners */}
        {errorMsg && (
          <div className="w-full mb-4 px-3.5 py-3 bg-[var(--bg-surface)] border border-[var(--status-error,#ef4444)] text-[var(--status-error,#ef4444)] text-xs font-semibold rounded-xl flex items-start gap-2.5 shadow-sm animate-fadeIn">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 text-left">
              <span>{errorMsg}</span>
              {errorMsg.includes('verify your email') && mode === 'login' && (
                <button
                  type="button"
                  onClick={() => switchMode('verify-email')}
                  className="block mt-1.5 text-xs text-[var(--text-primary)] hover:underline font-bold cursor-pointer"
                >
                  Enter verification code &rarr;
                </button>
              )}
            </div>
          </div>
        )}

        {successMsg && (
          <div className="w-full mb-4 px-3.5 py-3 bg-[var(--bg-surface)] border border-[var(--status-success,#10b981)] text-[var(--text-primary)] text-xs font-semibold rounded-xl flex items-start gap-2.5 shadow-sm animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[var(--status-success,#10b981)]" />
            <span className="flex-1 text-left">{successMsg}</span>
          </div>
        )}

        {/* ─── 1. LOGIN FORM ────────────────────────────────────────────── */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="w-full flex flex-col gap-3.5">
            {/* Google Sign-in Action */}
            <button
              type="button"
              onClick={handleGoogleAuth}
              className="w-full h-10 bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-strong)] rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2.5 shadow-sm cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>

            {/* Divider */}
            <div className="flex items-center my-0.5">
              <div className="flex-1 border-t border-[var(--border-subtle)]" />
              <span className="px-3 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold">
                OR
              </span>
              <div className="flex-1 border-t border-[var(--border-subtle)]" />
            </div>

            {/* Email / Username Field */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Email or Username
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="Enter email or username"
                  required
                  autoComplete="username"
                  className="w-full h-10 pl-9 pr-3.5 bg-[var(--bg-surface)] border border-[var(--border-strong)] focus:border-[var(--text-primary)] focus:outline-none rounded-xl text-xs text-[var(--text-primary)] transition-colors"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  autoComplete="current-password"
                  className="w-full h-10 pl-9 pr-10 bg-[var(--bg-surface)] border border-[var(--border-strong)] focus:border-[var(--text-primary)] focus:outline-none rounded-xl text-xs text-[var(--text-primary)] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Remember Me & Forgot Password */}
            <div className="flex items-center justify-between text-xs py-0.5">
              <label className="flex items-center gap-2 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-[var(--border-strong)] bg-[var(--bg-surface)]"
                />
                <span>Remember me</span>
              </label>
              <button
                type="button"
                onClick={() => switchMode('forgot-password')}
                className="text-[var(--text-primary)] hover:underline text-xs font-semibold transition-colors cursor-pointer"
              >
                Forgot password?
              </button>
            </div>

            {/* Primary Action Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 mt-1 bg-[var(--control-primary-bg)] text-[var(--control-primary-text)] rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {/* Switch to Signup */}
            <div className="mt-4 text-center text-xs text-[var(--text-secondary)]">
              Don't have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className="text-[var(--text-primary)] hover:underline font-bold ml-1 cursor-pointer"
              >
                Sign up
              </button>
            </div>
          </form>
        )}

        {/* ─── 2. SIGNUP FORM ───────────────────────────────────────────── */}
        {mode === 'signup' && (
          <form onSubmit={handleSignup} className="w-full flex flex-col gap-3">
            {/* Google Sign-in Action */}
            <button
              type="button"
              onClick={handleGoogleAuth}
              className="w-full h-10 bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-strong)] rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-2.5 shadow-sm cursor-pointer"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>

            {/* Divider */}
            <div className="flex items-center my-0.5">
              <div className="flex-1 border-t border-[var(--border-subtle)]" />
              <span className="px-3 text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold">
                OR
              </span>
              <div className="flex-1 border-t border-[var(--border-subtle)]" />
            </div>

            {/* Name Field */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Full Name
              </label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your name"
                  required
                  autoComplete="name"
                  className="w-full h-10 pl-9 pr-3.5 bg-[var(--bg-surface)] border border-[var(--border-strong)] focus:border-[var(--text-primary)] focus:outline-none rounded-xl text-xs text-[var(--text-primary)] transition-colors"
                />
              </div>
            </div>

            {/* Username Field */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Username
              </label>
              <div className="relative">
                <AtSign className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Choose a handle (e.g. alex)"
                  required
                  autoComplete="username"
                  className="w-full h-10 pl-9 pr-3.5 bg-[var(--bg-surface)] border border-[var(--border-strong)] focus:border-[var(--text-primary)] focus:outline-none rounded-xl text-xs text-[var(--text-primary)] transition-colors"
                />
              </div>
            </div>

            {/* Email Field */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  autoComplete="email"
                  className="w-full h-10 pl-9 pr-3.5 bg-[var(--bg-surface)] border border-[var(--border-strong)] focus:border-[var(--text-primary)] focus:outline-none rounded-xl text-xs text-[var(--text-primary)] transition-colors"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min 8 chars, 1 uppercase, 1 number"
                  required
                  autoComplete="new-password"
                  className="w-full h-10 pl-9 pr-10 bg-[var(--bg-surface)] border border-[var(--border-strong)] focus:border-[var(--text-primary)] focus:outline-none rounded-xl text-xs text-[var(--text-primary)] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Confirm Password Field */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  required
                  autoComplete="new-password"
                  className="w-full h-10 pl-9 pr-10 bg-[var(--bg-surface)] border border-[var(--border-strong)] focus:border-[var(--text-primary)] focus:outline-none rounded-xl text-xs text-[var(--text-primary)] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-3 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-10 mt-2 bg-[var(--control-primary-bg)] text-[var(--control-primary-text)] rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>Create Account</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {/* Switch to Login */}
            <div className="mt-3 text-center text-xs text-[var(--text-secondary)]">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-[var(--text-primary)] hover:underline font-bold ml-1 cursor-pointer"
              >
                Sign in
              </button>
            </div>
          </form>
        )}

        {/* ─── 3. EMAIL OTP VERIFICATION ───────────────────────────────── */}
        {mode === 'verify-email' && (
          <form onSubmit={handleVerifyEmail} className="w-full flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  className="w-full h-10 pl-9 pr-3.5 bg-[var(--bg-surface)] border border-[var(--border-strong)] focus:border-[var(--text-primary)] focus:outline-none rounded-xl text-xs text-[var(--text-primary)] transition-colors"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                6-Digit Verification Code
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
                <input
                  type="text"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  required
                  autoFocus
                  className="w-full h-11 pl-9 pr-3.5 bg-[var(--bg-surface)] border border-[var(--border-strong)] focus:border-[var(--text-primary)] focus:outline-none rounded-xl text-center text-lg font-mono font-bold tracking-widest text-[var(--text-primary)] transition-colors"
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={resendCooldown > 0 || loading}
                className="text-[var(--text-primary)] hover:underline font-semibold disabled:opacity-50 disabled:hover:no-underline flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${resendCooldown > 0 ? 'animate-spin' : ''}`} />
                <span>
                  {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-semibold cursor-pointer"
              >
                Back to Sign in
              </button>
            </div>

            <button
              type="submit"
              disabled={loading || otp.trim().length !== 6}
              className="w-full h-10 mt-2 bg-[var(--control-primary-bg)] text-[var(--control-primary-text)] rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>Verify & Enter PraConnect</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* ─── 4. FORGOT PASSWORD FORM ─────────────────────────────────── */}
        {mode === 'forgot-password' && (
          <form onSubmit={handleForgotPassword} className="w-full flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Your Account Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  autoFocus
                  className="w-full h-10 pl-9 pr-3.5 bg-[var(--bg-surface)] border border-[var(--border-strong)] focus:border-[var(--text-primary)] focus:outline-none rounded-xl text-xs text-[var(--text-primary)] transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full h-10 mt-1 bg-[var(--control-primary-bg)] text-[var(--control-primary-text)] rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>Send Reset Code</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => switchMode('login')}
              className="w-full text-center text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-semibold mt-2 flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Sign In</span>
            </button>
          </form>
        )}

        {/* ─── 5. VERIFY PASSWORD RESET OTP ───────────────────────────── */}
        {mode === 'verify-password-reset' && (
          <form onSubmit={handleVerifyPasswordReset} className="w-full flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  className="w-full h-10 pl-9 pr-3.5 bg-[var(--bg-surface)] border border-[var(--border-strong)] focus:border-[var(--text-primary)] focus:outline-none rounded-xl text-xs text-[var(--text-primary)] transition-colors"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                6-Digit Reset Code
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
                <input
                  type="text"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  required
                  autoFocus
                  className="w-full h-11 pl-9 pr-3.5 bg-[var(--bg-surface)] border border-[var(--border-strong)] focus:border-[var(--text-primary)] focus:outline-none rounded-xl text-center text-lg font-mono font-bold tracking-widest text-[var(--text-primary)] transition-colors"
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-xs pt-1">
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={resendCooldown > 0 || loading}
                className="text-[var(--text-primary)] hover:underline font-semibold disabled:opacity-50 disabled:hover:no-underline flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${resendCooldown > 0 ? 'animate-spin' : ''}`} />
                <span>
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-semibold cursor-pointer"
              >
                Back to Sign in
              </button>
            </div>

            <button
              type="submit"
              disabled={loading || otp.trim().length !== 6}
              className="w-full h-10 mt-2 bg-[var(--control-primary-bg)] text-[var(--control-primary-text)] rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>Verify Code</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* ─── 6. SET NEW PASSWORD FORM ────────────────────────────────── */}
        {mode === 'new-password' && (
          <form onSubmit={handleResetPassword} className="w-full flex flex-col gap-3.5">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                New Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Min 8 chars, 1 uppercase, 1 number"
                  required
                  autoFocus
                  autoComplete="new-password"
                  className="w-full h-10 pl-9 pr-10 bg-[var(--bg-surface)] border border-[var(--border-strong)] focus:border-[var(--text-primary)] focus:outline-none rounded-xl text-xs text-[var(--text-primary)] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                Confirm New Password
              </label>
              <div className="relative">
                <ShieldCheck className="w-4 h-4 absolute left-3 top-3 text-[var(--text-muted)]" />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  required
                  autoComplete="new-password"
                  className="w-full h-10 pl-9 pr-10 bg-[var(--bg-surface)] border border-[var(--border-strong)] focus:border-[var(--text-primary)] focus:outline-none rounded-xl text-xs text-[var(--text-primary)] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-3 text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !newPassword || !confirmNewPassword}
              className="w-full h-10 mt-2 bg-[var(--control-primary-bg)] text-[var(--control-primary-text)] rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <span>Save New Password & Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* Bottom Legal Links & Status */}
      <div className="flex flex-col items-center gap-2.5 pt-8">
        <p className="text-[11px] text-[var(--text-tertiary)] text-center max-w-sm leading-relaxed">
          By continuing, you agree to our{' '}
          <button
            type="button"
            onClick={() => openLegal('terms')}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline cursor-pointer"
          >
            Terms &amp; Conditions
          </button>{' '}
          and{' '}
          <button
            type="button"
            onClick={() => openLegal('privacy')}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] underline cursor-pointer"
          >
            Privacy Policy
          </button>.
        </p>

        <footer className="flex items-center justify-center gap-4 text-[11px] text-[var(--text-muted)]">
          <button
            type="button"
            onClick={() => openLegal('terms')}
            className="hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            Terms &amp; Conditions
          </button>
          <span>•</span>
          <button
            type="button"
            onClick={() => openLegal('privacy')}
            className="hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            Privacy Policy
          </button>
          <span>•</span>
          <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-success,#10b981)]" />
            Systems Normal
          </span>
        </footer>
      </div>
    </div>
  );
};
