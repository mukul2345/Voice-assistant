import { useState, useEffect, useCallback, createContext, useContext } from "react";

interface AuthUser {
  id: number;
  email: string;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  accessToken: string | null;
  trialRemaining: number | null;
  isSubscribed: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<string | null>;
  getAuthHeader: () => Record<string, string>;
}

const TOKEN_KEY = "copilot_access_token";
const REFRESH_KEY = "copilot_refresh_token";

// Store tokens in localStorage
function storeTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_KEY, refreshToken);
}

function clearTokens() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

function getStoredAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function useAuthProvider(): AuthContextValue {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    accessToken: getStoredAccessToken(),
    trialRemaining: null,
    isSubscribed: false,
  });

  // Try to restore session on mount
  useEffect(() => {
    const token = getStoredAccessToken();
    if (token) {
      // Validate token by calling /api/auth/me
      fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((res) => {
          if (res.ok) return res.json();
          throw new Error("Token invalid");
        })
        .then((data) => {
          setState((s) => ({
            ...s,
            user: data.user,
            isAuthenticated: true,
            isLoading: false,
            accessToken: token,
          }));
          // Fetch trial status
          fetchTrialStatus(token);
        })
        .catch(() => {
          // Token expired, try refresh
          attemptRefresh();
        });
    } else {
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, []);

  const fetchTrialStatus = useCallback(async (token: string) => {
    try {
      const res = await fetch("/api/trial/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setState((s) => ({
          ...s,
          trialRemaining: data.remainingSeconds,
          isSubscribed: data.isSubscribed,
        }));
      }
    } catch {}
  }, []);

  const attemptRefresh = useCallback(async () => {
    const refreshTokenValue = getStoredRefreshToken();
    if (!refreshTokenValue) {
      setState((s) => ({ ...s, isLoading: false, isAuthenticated: false, user: null }));
      clearTokens();
      return;
    }

    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refreshTokenValue }),
      });

      if (!res.ok) throw new Error("Refresh failed");

      const { accessToken } = await res.json();
      localStorage.setItem(TOKEN_KEY, accessToken);

      // Now get user info
      const meRes = await fetch("/api/auth/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (meRes.ok) {
        const data = await meRes.json();
        setState((s) => ({
          ...s,
          user: data.user,
          isAuthenticated: true,
          isLoading: false,
          accessToken,
        }));
        fetchTrialStatus(accessToken);
      } else {
        throw new Error("User fetch failed");
      }
    } catch {
      setState((s) => ({ ...s, isLoading: false, isAuthenticated: false, user: null }));
      clearTokens();
    }
  }, [fetchTrialStatus]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error?.message || "Login failed");
    }

    const { user, accessToken, refreshToken } = await res.json();
    storeTokens(accessToken, refreshToken);
    setState((s) => ({
      ...s,
      user,
      isAuthenticated: true,
      accessToken,
    }));
    fetchTrialStatus(accessToken);
  }, [fetchTrialStatus]);

  const register = useCallback(async (email: string, password: string) => {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error?.message || "Registration failed");
    }

    const { user, accessToken, refreshToken } = await res.json();
    storeTokens(accessToken, refreshToken);
    setState((s) => ({
      ...s,
      user,
      isAuthenticated: true,
      accessToken,
      trialRemaining: 3600,
    }));
  }, []);

  const logout = useCallback(async () => {
    const token = getStoredAccessToken();
    const refreshTokenValue = getStoredRefreshToken();

    if (token && refreshTokenValue) {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken: refreshTokenValue }),
      }).catch(() => {}); // Best-effort
    }

    clearTokens();
    setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      accessToken: null,
      trialRemaining: null,
      isSubscribed: false,
    });
  }, []);

  const refreshTokenFn = useCallback(async (): Promise<string | null> => {
    const refreshTokenValue = getStoredRefreshToken();
    if (!refreshTokenValue) return null;

    try {
      const res = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: refreshTokenValue }),
      });

      if (!res.ok) return null;

      const { accessToken } = await res.json();
      localStorage.setItem(TOKEN_KEY, accessToken);
      setState((s) => ({ ...s, accessToken }));
      return accessToken;
    } catch {
      return null;
    }
  }, []);

  const getAuthHeader = useCallback((): Record<string, string> => {
    const token = getStoredAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  return {
    ...state,
    login,
    register,
    logout,
    refreshToken: refreshTokenFn,
    getAuthHeader,
  };
}

// Context for providing auth state globally
import { type ReactNode } from "react";

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuthProvider();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
