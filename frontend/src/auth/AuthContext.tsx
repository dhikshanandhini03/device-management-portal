import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api, setUnauthorizedHandler, TOKEN_KEY, USER_KEY } from "../api/client";
import type { CurrentUser } from "../api/types";

interface AuthState {
  user: CurrentUser | null;
  login: (username: string, password: string) => Promise<CurrentUser>;
  logout: (reason?: "expired" | "manual") => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

function tokenExpiry(token: string | null): number | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return 0;
  }
}

function loadUser(): CurrentUser | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const exp = tokenExpiry(token);
  if (!token || exp === null || exp <= Date.now()) return null;
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? "null");
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(loadUser);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const clearSession = useCallback(
    (reason?: "expired" | "manual") => {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      setUser(null);
      queryClient.clear();
      navigate(reason === "expired" ? "/login?expired=1" : "/login", { replace: true });
    },
    [navigate, queryClient],
  );

  const login = useCallback(async (username: string, password: string) => {
    const { data } = await api.post("/auth/login", { username, password });
    localStorage.setItem(TOKEN_KEY, data.access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    setUser(data.user);
    return data.user as CurrentUser;
  }, []);

  const logout = useCallback(
    async (reason: "expired" | "manual" = "manual") => {
      if (reason === "manual") {
        try {
          await api.post("/auth/logout");
        } catch {
          /* session may already be invalid */
        }
      }
      clearSession(reason);
    },
    [clearSession],
  );

  useEffect(() => {
    setUnauthorizedHandler((reason) => {
      if (localStorage.getItem(TOKEN_KEY) || reason === "expired") clearSession("expired");
    });
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  // Client-side session expiry check (server also rejects expired tokens).
  useEffect(() => {
    if (!user) return;
    const check = () => {
      const exp = tokenExpiry(localStorage.getItem(TOKEN_KEY));
      if (exp === null || exp <= Date.now()) clearSession("expired");
    };
    check();
    const id = window.setInterval(check, 15000);
    return () => window.clearInterval(id);
  }, [user, clearSession]);

  const can = useCallback((permission: string) => !!user?.permissions.includes(permission), [user]);

  const value = useMemo(() => ({ user, login, logout, can }), [user, login, logout, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

export const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrator",
  SUPPORT_ENGINEER: "Support Engineer",
  READ_ONLY: "Read Only",
};
