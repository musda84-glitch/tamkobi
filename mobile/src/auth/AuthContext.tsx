import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { get, post, type ApiClient } from "../api/client";
import { ApiHttpError, apiErrorMessage } from "../api/errors";
import type { B2BForgotResult, B2BLoginResult, B2BPortal, Company, License, SessionKind, SessionPayload, User } from "../types";
import { setPriceDecimals } from "../utils/money";
import { parseB2bToken } from "../utils/b2bToken";
import { can as canPerm, moduleOn as moduleOnPerm } from "../utils/permissions";
import {
  clearB2bSession,
  clearToken,
  loadApiBase,
  loadB2bName,
  loadB2bToken,
  loadSessionCache,
  loadSessionKind,
  loadToken,
  saveApiBase,
  saveB2bName,
  saveB2bToken,
  saveSessionCache,
  saveSessionKind,
  saveToken,
} from "./storage";

type AuthState = {
  ready: boolean;
  baseUrl: string;
  token: string | null;
  user: User | null;
  companies: Company[];
  activeCompany: Company | null;
  license: License | null;
  error: string | null;
  sessionKind: SessionKind | null;
  b2bToken: string | null;
  b2bName: string | null;
};

type AuthContextValue = AuthState & {
  client: ApiClient;
  companyId: string;
  login: (email: string, password: string, serverUrl?: string) => Promise<void>;
  loginB2b: (email: string, password: string, serverUrl?: string) => Promise<void>;
  enterB2bToken: (tokenOrLink: string, serverUrl?: string) => Promise<void>;
  forgotB2b: (email: string) => Promise<B2BForgotResult>;
  resetB2b: (resetToken: string, password: string) => Promise<void>;
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

/** Sunucu oturumu reddetmediyse (ağ/timeout) kaydedilmiş token korunur. */
function isAuthRejection(err: unknown): boolean {
  return err instanceof ApiHttpError && (err.status === 401 || err.status === 403);
}

const loggedOut = {
  token: null as string | null,
  user: null as User | null,
  companies: [] as Company[],
  activeCompany: null as Company | null,
  license: null as License | null,
  sessionKind: null as SessionKind | null,
  b2bToken: null as string | null,
  b2bName: null as string | null,
  error: null as string | null,
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    ready: false,
    baseUrl: "https://tamkobi.com",
    ...loggedOut,
  });

  const applySession = useCallback((baseUrl: string, token: string | null, payload: SessionPayload | null, error: string | null = null) => {
    const user = payload?.user || null;
    const companies = payload?.companies || [];
    const active = pickCompany(companies, user?.active_company_id);
    setPriceDecimals(active?.price_decimals);
    setState({
      ready: true,
      baseUrl,
      token,
      user,
      companies,
      activeCompany: active,
      license: payload?.license || null,
      error,
      sessionKind: token && user ? "erp" : null,
      b2bToken: null,
      b2bName: null,
    });
  }, []);

  const applyB2b = useCallback((baseUrl: string, token: string, name?: string | null) => {
    setState({
      ready: true,
      baseUrl,
      ...loggedOut,
      error: null,
      sessionKind: "b2b",
      b2bToken: token,
      b2bName: name || null,
    });
  }, []);

  const persistB2b = useCallback(async (baseUrl: string, token: string, name?: string | null) => {
    await clearToken();
    await saveB2bToken(token);
    await saveB2bName(name || "");
    await saveSessionKind("b2b");
    applyB2b(baseUrl, token, name);
  }, [applyB2b]);

  const bootstrap = useCallback(async () => {
    const baseUrl = await loadApiBase();
    const kind = await loadSessionKind();
    const token = await loadToken();
    const b2bToken = await loadB2bToken();
    const b2bStoredName = await loadB2bName();
    const useB2b = kind === "b2b" || (!kind && !!b2bToken && !token);
    if (useB2b) {
      if (!b2bToken) {
        setState((s) => ({ ...s, ready: true, baseUrl, ...loggedOut }));
        return;
      }
      try {
        const portal = await get<B2BPortal>({ baseUrl, token: null }, `/public/b2b/${b2bToken}`);
        setPriceDecimals(portal?.company?.price_decimals);
        applyB2b(baseUrl, b2bToken, portal?.contact?.name || b2bStoredName);
      } catch (err) {
        if (!isAuthRejection(err) && !(err instanceof ApiHttpError && err.status === 404)) {
          applyB2b(baseUrl, b2bToken, b2bStoredName);
          return;
        }
        await clearB2bSession();
        await saveSessionKind(null);
        setState((s) => ({ ...s, ready: true, baseUrl, ...loggedOut }));
      }
      return;
    }
    if (!token) {
      setState((s) => ({ ...s, ready: true, baseUrl, ...loggedOut }));
      return;
    }
    try {
      const me = await get<SessionPayload>({ baseUrl, token }, "/auth/me");
      if (!me?.authenticated || !me.user) {
        await clearToken();
        await saveSessionCache(null);
        applySession(baseUrl, null, null);
        return;
      }
      await saveSessionCache(me);
      applySession(baseUrl, token, me);
    } catch (err) {
      const cached = isAuthRejection(err) ? null : await loadSessionCache();
      if (cached) {
        applySession(baseUrl, token, cached, apiErrorMessage(err, "Sunucuya ulaşılamadı; son bilinen oturum kullanılıyor."));
        return;
      }
      await clearToken();
      await saveSessionCache(null);
      setState((s) => ({ ...s, ready: true, baseUrl, ...loggedOut }));
    }
  }, [applyB2b, applySession]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const login = useCallback(async (email: string, password: string, serverUrl?: string) => {
    const baseUrl = serverUrl ? await saveApiBase(serverUrl) : state.baseUrl;
    if (serverUrl) setState((s) => ({ ...s, baseUrl }));
    const res = await post<SessionPayload>({ baseUrl, token: null }, "/auth/login", { email, password, remember: true });
    if (!res?.token || !res.user) throw new Error("Giriş yanıtı geçersiz.");
    await clearB2bSession();
    await saveToken(res.token);
    await saveSessionKind("erp");
    await saveSessionCache(res);
    applySession(baseUrl, res.token, res);
  }, [applySession, state.baseUrl]);

  const loginB2b = useCallback(async (email: string, password: string, serverUrl?: string) => {
    const baseUrl = serverUrl ? await saveApiBase(serverUrl) : state.baseUrl;
    if (serverUrl) setState((s) => ({ ...s, baseUrl }));
    const res = await post<B2BLoginResult>({ baseUrl, token: null }, "/public/b2b/login", { email, password });
    if (!res?.token) throw new Error("Giriş yanıtı geçersiz.");
    await persistB2b(baseUrl, res.token, res.name);
  }, [persistB2b, state.baseUrl]);

  const enterB2bToken = useCallback(async (tokenOrLink: string, serverUrl?: string) => {
    const token = parseB2bToken(tokenOrLink);
    if (!token) throw new Error("Geçerli bir B2B portal linki veya token girin.");
    const baseUrl = serverUrl ? await saveApiBase(serverUrl) : state.baseUrl;
    if (serverUrl) setState((s) => ({ ...s, baseUrl }));
    const portal = await get<B2BPortal>({ baseUrl, token: null }, `/public/b2b/${token}`);
    setPriceDecimals(portal?.company?.price_decimals);
    await persistB2b(baseUrl, token, portal?.contact?.name);
  }, [persistB2b, state.baseUrl]);

  const forgotB2b = useCallback(async (email: string) => {
    return post<B2BForgotResult>(
      { baseUrl: state.baseUrl, token: null },
      "/public/b2b/forgot-password",
      { email, base_url: state.baseUrl }
    );
  }, [state.baseUrl]);

  const resetB2b = useCallback(async (resetToken: string, password: string) => {
    const res = await post<B2BLoginResult>(
      { baseUrl: state.baseUrl, token: null },
      `/public/b2b/reset/${resetToken}`,
      { password }
    );
    if (!res?.token) throw new Error("Şifre güncellendi ancak giriş yanıtı geçersiz.");
    await persistB2b(state.baseUrl, res.token, res.name);
  }, [persistB2b, state.baseUrl]);

  const logout = useCallback(async () => {
    try {
      if (state.token) {
        const { unregisterDevicePush } = await import("../utils/pushRegister");
        await unregisterDevicePush({ baseUrl: state.baseUrl, token: state.token });
      }
    } catch {
      /* token kaydı çıkışı engellemesin */
    }
    try {
      if (state.token) await post({ baseUrl: state.baseUrl, token: state.token }, "/auth/logout", {});
    } catch {
      /* ignore */
    }
    await clearToken();
    await clearB2bSession();
    await saveSessionKind(null);
    await saveSessionCache(null);
    setPriceDecimals(2);
    setState((s) => ({ ...s, ...loggedOut }));
  }, [state.baseUrl, state.token]);

  const switchCompany = useCallback(
    async (companyId: string) => {
      if (!state.token) return;
      await post({ baseUrl: state.baseUrl, token: state.token }, "/auth/switch-company", { company_id: companyId });
      const me = await get<SessionPayload>({ baseUrl: state.baseUrl, token: state.token }, "/auth/me");
      await saveSessionCache(me);
      applySession(state.baseUrl, state.token, me);
    },
    [applySession, state.baseUrl, state.token]
  );

  const setServer = useCallback(async (url: string) => {
    const next = await saveApiBase(url);
    await clearToken();
    await clearB2bSession();
    await saveSessionKind(null);
    await saveSessionCache(null);
    setPriceDecimals(2);
    setState((s) => ({
      ...s,
      baseUrl: next,
      ...loggedOut,
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
      loginB2b,
      enterB2bToken,
      forgotB2b,
      resetB2b,
      logout,
      switchCompany,
      setServer,
      reload: bootstrap,
      can: (path, level = "view") => (state.sessionKind === "b2b" ? false : canPerm(state.user, path, level)),
      moduleOn: (path) => (state.sessionKind === "b2b" ? false : moduleOnPerm(state.license, path)),
    }),
    [bootstrap, client, companyId, enterB2bToken, forgotB2b, login, loginB2b, logout, resetB2b, setServer, state, switchCompany]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth AuthProvider dışında kullanıldı.");
  return ctx;
}

export { apiErrorMessage };
