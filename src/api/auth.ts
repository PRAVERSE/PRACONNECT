// src/api/auth.ts
// Frontend API client for PraConnect authentication.
// Uses relative /api/auth paths with credentials: 'include'.

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  email: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  /** Server-verified role: 'admin' (owner account) or 'user'. Always comes
   *  from the authenticated session — the client never decides it. */
  role: 'admin' | 'user';
  createdAt: string;
}

export interface AuthResponse {
  authenticated: boolean;
  user?: AuthUser;
  error?: {
    code: string;
    message: string;
  };
}

export interface SignupResponse {
  message?: string;
  emailVerificationRequired?: boolean;
  email?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface GenericResponse {
  message?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface VerifyPasswordResetResponse {
  resetToken?: string;
  error?: {
    code: string;
    message: string;
  };
}

/** Fetch current session user from /api/auth/me */
export async function getCurrentUser(): Promise<AuthResponse> {
  try {
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) {
      return { authenticated: false };
    }
    return await res.json();
  } catch {
    return { authenticated: false };
  }
}

/** Login with identifier (email or username) + password */
export async function loginApi(identifier: string, password: string): Promise<AuthResponse> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ identifier, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        authenticated: false,
        error: data.error || { code: 'LOGIN_FAILED', message: 'Failed to sign in. Please check your credentials.' },
      };
    }
    return data;
  } catch {
    return {
      authenticated: false,
      error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server. Please check your connection.' },
    };
  }
}

/** Signup a new user */
export async function signupApi(
  name: string,
  username: string,
  email: string,
  password: string
): Promise<SignupResponse> {
  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name, username, email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        error: data.error || { code: 'SIGNUP_FAILED', message: 'Failed to create account.' },
      };
    }
    return data;
  } catch {
    return {
      error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server. Please check your connection.' },
    };
  }
}

/** Verify email OTP */
export async function verifyEmailApi(email: string, otp: string): Promise<AuthResponse> {
  try {
    const res = await fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, otp }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        authenticated: false,
        error: data.error || { code: 'VERIFY_FAILED', message: 'Invalid or expired verification code.' },
      };
    }
    return data;
  } catch {
    return {
      authenticated: false,
      error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server. Please check your connection.' },
    };
  }
}

/** Resend verification email OTP */
export async function resendVerificationApi(email: string): Promise<GenericResponse> {
  try {
    const res = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        error: data.error || { code: 'RESEND_FAILED', message: 'Failed to resend verification code.' },
      };
    }
    return data;
  } catch {
    return {
      error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server. Please check your connection.' },
    };
  }
}

/** Request password reset OTP */
export async function forgotPasswordApi(email: string): Promise<GenericResponse> {
  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        error: data.error || { code: 'FORGOT_FAILED', message: 'Failed to request password reset.' },
      };
    }
    return data;
  } catch {
    return {
      error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server. Please check your connection.' },
    };
  }
}

/** Verify password reset OTP to receive resetToken */
export async function verifyPasswordResetApi(email: string, otp: string): Promise<VerifyPasswordResetResponse> {
  try {
    const res = await fetch('/api/auth/verify-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, otp }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        error: data.error || { code: 'VERIFY_FAILED', message: 'Invalid or expired reset code.' },
      };
    }
    return data;
  } catch {
    return {
      error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server. Please check your connection.' },
    };
  }
}

/** Reset password using resetToken */
export async function resetPasswordApi(resetToken: string, newPassword: string): Promise<GenericResponse> {
  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ resetToken, newPassword }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        error: data.error || { code: 'RESET_FAILED', message: 'Failed to reset password.' },
      };
    }
    return data;
  } catch {
    return {
      error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server. Please check your connection.' },
    };
  }
}

/** Logout current session */
export async function logoutApi(): Promise<void> {
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // Ignore network error on logout
  }
}

export interface UpdateProfileData {
  name?: string;
  username?: string;
  avatar?: string;
  avatarUrl?: string;
  bio?: string;
}

export interface UpdateProfileResponse {
  ok?: boolean;
  user?: AuthUser;
  profile?: {
    name: string;
    username: string;
    avatar: string;
    bio: string;
    email: string;
  };
  error?: {
    code: string;
    message: string;
  };
}

/** Update user profile via PATCH /api/profile */
export async function updateProfileApi(data: UpdateProfileData): Promise<UpdateProfileResponse> {
  try {
    const res = await fetch('/api/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    });
    const result = (await res.json().catch(() => ({}))) as UpdateProfileResponse;
    if (!res.ok) {
      return {
        ok: false,
        error: result.error || { code: 'UPDATE_FAILED', message: 'Failed to update profile.' },
      };
    }
    return { ok: true, user: result.user, profile: result.profile };
  } catch {
    return {
      ok: false,
      error: { code: 'NETWORK_ERROR', message: 'Unable to connect to the server. Please check your connection.' },
    };
  }
}
