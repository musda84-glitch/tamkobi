import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { get, post, type ApiClient } from "../api/client";
import { apiErrorMessage } from "../api/errors";
import type { Company, License, SessionPayload, User } from "../types";
import { can as canPerm, moduleOn as moduleOnPerm } from "../utils/permissions";
import { clearToken, loadApiBase, loadToken, saveApiBase, saveToken } from "./storage";

type AuthState = {
  ready: boolean;
  baseUrl: string;
  token: string | null;
  user: User | null;
  companies: Company[];
  activeCompany: Company | null;
  license: License | null;
  error: string | null;
};

type AuthContextValue = AuthState & {
  client: ApiClient;
  companyId: string;
  login: (email: string, password: string, serverUrl?: string) => Promise<void>;
  logout: () => Promise<void>;
  switchCompany: (companyId: string) => Promise<void>;
  setServer: (url: string) => Promise<void>;
  reload: () => Promise<void>;
  can: (path: string, level?: "view" | "edit") => boolean;
  moduleOn: (path: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function pickCompany(companies: Company[], activeId?: string | null): Company | null {
  if (!companies.length) return null;
  return companies.find((c) => (c.id || c._id) === activeId) || companies[0];
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    ready: false,
    baseUrl: "https://tamkobi.com",
    token: null,
    user: null,
    companies: [],
    activeCompany: null,
    license: null,
    error: null,
  });

  const applySession = useCallback((baseUrl: string, token: string | null, payload: SessionPayload | null) => {
    const user = payload?.user || null;
    const companies = payload?.companies || [];
    setState({
      ready: true,
      baseUrl,
      token,
      user,
      companies,
      activeCompany: pickCompany(companies, user?.active_company_id),
      license: payload?.license || null,
      error: null,
    });
  }, []);

  const bootstrap = useCallback(async () => {
    const baseUrl = await loadApiBase();
    const token = await loadToken();
    if (!token) {
      setState((s) => ({ ...s, ready: true, baseUrl, token: null, user: null, companies: [], activeCompany: null, license: null }));
      return;
    }
    try {
      const me = await get<SessionPayload>({ baseUrl, token }, "/auth/me");
      if (!me?.authenticated || !me.user) {
        await clearToken();
        applySession(baseUrl, null, null);
        return;
      }
      applySession(baseUrl, token, me);
    } catch {
      await clearToken();
      setState((s) => ({ ...s, ready: true, baseUrl, token: null, user: null, companies: [], activeCompany: null, license: null }));
    }
  }, [applySession]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const login = useCallback(async (email: string, password: string, serverUrl?: string) => {
    const baseUrl = serverUrl ? await saveApiBase(serverUrl) : state.baseUrl;
    if (serverUrl) setState((s) => ({ ...s, baseUrl }));
    const res = await post<SessionPayload>({ baseUrl, token: null }, "/auth/login", { email, password, remember: true });
    if (!res?.token || !res.user) throw new Error("Giriş yanıtı geçersiz.");
    await saveToken(res.token);
    applySession(baseUrl, res.token, res);
  }, [applySession, state.baseUrl]);

  const logout = useCallback(async () => {
    try {
      if (state.token) await post({ baseUrl: state.baseUrl, token: state.token }, "/auth/logout", {});
    } catch {
      /* ignore */
    }
    await clearToken();
    setState((s) => ({ ...s, token: null, user: null, companies: [], activeCompany: null, license: null }));
  }, [state.baseUrl, state.token]);

  const switchCompany = useCallback(
    async (companyId: string) => {
      if (!state.token) return;
      await post({ baseUrl: state.baseUrl, token: state.token }, "/auth/switch-company", { company_id: companyId });
      const me = await get<SessionPayload>({ baseUrl: state.baseUrl, token: state.token }, "/auth/me");
      applySession(state.baseUrl, state.token, me);
    },
    [applySession, state.baseUrl, state.token]
  );

  const setServer = useCallback(async (url: string) => {
    const next = await saveApiBase(url);
    await clearToken();
    setState((s) => ({
      ...s,
      baseUrl: next,
      token: null,
      user: null,
      companies: [],
      activeCompany: null,
      license: null,
    }));
  }, []);

  const client = useMemo<ApiClient>(() => ({ baseUrl: state.baseUrl, token: state.token }), [state.baseUrl, state.token]);
  const companyId = state.activeCompany?.id || state.activeCompany?._id || state.user?.active_company_id || "";

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      client,
      companyId,
      login,
      logout,
      switchCompany,
      setServer,
      reload: bootstrap,
      can: (path, level = "view") => canPerm(state.user, path, level),
      moduleOn: (path) => moduleOnPerm(state.license, path),
    }),
    [bootstrap, client, companyId, login, logout, setServer, state, switchCompany]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth AuthProvider dışında kullanıldı.");
  return ctx;
}

export { apiErrorMessage };
