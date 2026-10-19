import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import { API_URL, useAuth } from "./AuthContext";
import { PosPinPad } from "../components/PosPinPad";
import {
  isPendingApproval,
  pinIsValid,
  sessionIsIdle,
  shouldBounceToPos,
  terminalIdFromStorage,
} from "../utils/posCashier";

/** Firma Ayarları → Hızlı Satış Kuralları; kasiyer PIN'i PosRulesPanel'de atanır. */
const CASHIER_SETUP_HREF = "/settings?tab=pos_rules";

const PosSessionContext = createContext({
  session: null,
  rules: null,
  terminalId: "",
  locked: true,
  pending: [],
  shift: null,
  heldCarts: [],
  canApprove: false,
  requestAction: async () => ({}),
  login: async () => ({}),
  unlock: async () => ({}),
  lockNow: async () => {},
  switchCashier: async () => ({}),
  exitPos: async () => ({}),
  ping: async () => {},
  reload: async () => {},
  decide: async () => ({}),
});

export function usePosSession() {
  return useContext(PosSessionContext);
}

export function PosSessionProvider({ children }) {
  const { authenticated, activeCompany, user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const companyId = activeCompany?.id || activeCompany?._id;
  const terminalId = useMemo(() => terminalIdFromStorage(), []);
  const [session, setSession] = useState(null);
  const [rules, setRules] = useState(null);
  const [pending, setPending] = useState([]);
  const [shift, setShift] = useState(null);
  const [heldCarts, setHeldCarts] = useState([]);
  const [cashiers, setCashiers] = useState([]);
  const [cashiersLoaded, setCashiersLoaded] = useState(false);
  const [canApprove, setCanApprove] = useState(false);
  const [gate, setGate] = useState(null);
  const [pinErr, setPinErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [pickedId, setPickedId] = useState("");
  const idleRef = useRef(null);

  const headers = useMemo(() => ({ "X-Pos-Terminal": terminalId }), [terminalId]);

  const applyPayload = useCallback((data) => {
    if (data?.session) setSession(data.session);
    if (data?.my_rules) setRules(data.my_rules);
    if (data?.pending_approvals) setPending(data.pending_approvals);
    if (Object.prototype.hasOwnProperty.call(data || {}, "shift")) setShift(data.shift);
    if (data?.held_carts) setHeldCarts(data.held_carts);
    if (typeof data?.can_approve === "boolean") setCanApprove(data.can_approve);
  }, []);

  const reload = useCallback(async () => {
    if (!companyId || !authenticated) return;
    try {
      const { data } = await axios.get(`${API_URL}/pos/session`, {
        params: { company_id: companyId, terminal_id: terminalId },
        headers,
      });
      applyPayload(data);
      if (data?.session?.rules) setRules(data.session.rules);
    } catch {
      /* offline */
    }
  }, [applyPayload, authenticated, companyId, headers, terminalId]);

  const loadCashiers = useCallback(async () => {
    if (!companyId) {
      setCashiers([]);
      setCashiersLoaded(false);
      return;
    }
    setCashiersLoaded(false);
    try {
      const { data } = await axios.get(`${API_URL}/pos/cashiers`, { params: { company_id: companyId } });
      setCashiers(Array.isArray(data) ? data : []);
    } catch {
      setCashiers([]);
    } finally {
      setCashiersLoaded(true);
    }
  }, [companyId]);

  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { loadCashiers(); }, [loadCashiers]);

  const ping = useCallback(async () => {
    if (!companyId || !session?.cashier_user_id || session.locked) return;
    try {
      const { data } = await axios.post(`${API_URL}/pos/session/ping`, { company_id: companyId, terminal_id: terminalId }, { headers });
      if (data?.session) setSession(data.session);
    } catch {
      /* ignore */
    }
  }, [companyId, headers, session, terminalId]);

  useEffect(() => {
    if (!session?.cashier_user_id || session.locked) return undefined;
    const onAct = () => {
      clearTimeout(idleRef.current);
      idleRef.current = setTimeout(() => { ping(); }, 1500);
    };
    window.addEventListener("pointerdown", onAct);
    window.addEventListener("keydown", onAct);
    const t = setInterval(reload, 20000);
    return () => {
      window.removeEventListener("pointerdown", onAct);
      window.removeEventListener("keydown", onAct);
      clearInterval(t);
      clearTimeout(idleRef.current);
    };
  }, [ping, reload, session]);

  useEffect(() => {
    if (shouldBounceToPos(session, location.pathname)) {
      navigate("/hizli-satis", { replace: true });
    }
  }, [location.pathname, navigate, session]);

  const login = useCallback(async (pin, cashierUserId) => {
    setBusy(true);
    setPinErr("");
    try {
      const body = { company_id: companyId, terminal_id: terminalId, pin, cashier_user_id: cashierUserId };
      const { data } = await axios.post(`${API_URL}/pos/session/login`, body, { headers });
      applyPayload({ session: data.session, ...data });
      setGate(null);
      setSwitching(false);
      await reload();
      return data;
    } catch (err) {
      setPinErr(err.response?.data?.detail || "PIN hatalı.");
      throw err;
    } finally {
      setBusy(false);
    }
  }, [applyPayload, companyId, headers, reload, terminalId]);

  const unlock = useCallback(async (pin) => {
    setBusy(true);
    setPinErr("");
    try {
      const { data } = await axios.post(`${API_URL}/pos/session/unlock`, { company_id: companyId, terminal_id: terminalId, pin }, { headers });
      if (data.session) setSession(data.session);
      setGate(null);
      return data;
    } catch (err) {
      setPinErr(err.response?.data?.detail || "PIN hatalı.");
      throw err;
    } finally {
      setBusy(false);
    }
  }, [companyId, headers, terminalId]);

  const lockNow = useCallback(async () => {
    await axios.post(`${API_URL}/pos/session/lock`, { company_id: companyId, terminal_id: terminalId }, { headers }).catch(() => {});
    setSession((s) => (s ? { ...s, locked: true } : s));
  }, [companyId, headers, terminalId]);

  const switchCashier = useCallback(async () => {
    setSwitching(true);
    setPinErr("");
    await lockNow();
  }, [lockNow]);

  const decide = useCallback(async (id, action, pin, approverUserId) => {
    const { data } = await axios.post(
      `${API_URL}/pos/approvals/${id}/${action}`,
      { pin, company_id: companyId, terminal_id: terminalId, user_id: approverUserId },
      { headers },
    );
    await reload();
    return data;
  }, [companyId, headers, reload, terminalId]);

  const requestAction = useCallback(async (kind, payload = {}, extra = {}) => {
    const { data } = await axios.post(
      `${API_URL}/pos/approvals`,
      { company_id: companyId, terminal_id: terminalId, kind, payload, extra, summary: payload.summary, pin: payload.pin },
      { headers },
    );
    if (isPendingApproval(data)) {
      setPickedId("");
      setGate({ mode: "approve", kind, requestId: data.request_id, message: data.message });
    }
    await reload();
    return data;
  }, [companyId, headers, reload, terminalId]);

  const exitPos = useCallback(async (pin) => {
    const { data } = await axios.post(
      `${API_URL}/pos/session/exit`,
      { company_id: companyId, terminal_id: terminalId, pin },
      { headers },
    );
    if (isPendingApproval(data)) {
      setPickedId("");
      setGate({ mode: "exit", requestId: data.request_id, message: data.message });
      return data;
    }
    await reload();
    return data;
  }, [companyId, headers, reload, terminalId]);

  const onPosPage = location.pathname === "/hizli-satis" || location.pathname.startsWith("/hizli-satis/");
  const needsLogin = onPosPage && authenticated && (!session?.cashier_user_id || session?.ended_at);
  const idleLocked = !!(session?.cashier_user_id && sessionIsIdle(session, Date.now(), session.idle_timeout_sec || 120));
  const needsUnlock = onPosPage && authenticated && !!session?.cashier_user_id && !session?.ended_at && (session.locked || idleLocked || switching);
  const showLock = needsLogin || needsUnlock;
  const pickingCashier = needsLogin || switching;
  const pinCashiers = pickingCashier ? cashiers.filter((c) => c.has_cashier_pin) : undefined;
  const noPinCashiers = !!(pickingCashier && cashiersLoaded && pinCashiers.length === 0);
  const leaveLoginGate = useCallback(() => {
    navigate("/panel");
  }, [navigate]);

  useEffect(() => {
    if (!needsLogin) return undefined;
    const onEsc = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      leaveLoginGate();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [leaveLoginGate, needsLogin]);

  const value = {
    session,
    rules: session?.rules || rules,
    terminalId,
    locked: !!session?.locked || !session?.cashier_user_id,
    pending,
    shift,
    heldCarts,
    cashiers,
    canApprove,
    requestAction,
    login,
    unlock,
    lockNow,
    switchCashier,
    exitPos,
    ping,
    reload,
    decide,
    headers,
    companyId,
  };

  return (
    <PosSessionContext.Provider value={value}>
      {children}
      {showLock && (
        <PosPinPad
          title={needsLogin ? "Kasiyer girişi" : switching ? "Kasiyer değişimi" : "Ekran kilitli"}
          hint={noPinCashiers
            ? "Tanımlı kasiyer (PIN'li) yok."
            : needsLogin || switching
              ? "Önce kasiyeri seçin, sonra 4-6 haneli PIN yazın."
              : `${session?.cashier_name || "Kasiyer"} PIN'i ile kilidi açın.`}
          cashiers={pickingCashier ? (cashiersLoaded ? pinCashiers : undefined) : undefined}
          noCashiers={noPinCashiers}
          emptyHint={noPinCashiers ? "Tanımlı kasiyer (PIN'li) yok" : undefined}
          setupHref={noPinCashiers ? CASHIER_SETUP_HREF : undefined}
          selectedId={pickedId}
          onSelect={(c) => setPickedId(c?.id || "")}
          onSubmit={async (pin) => {
            try {
              if (needsLogin || switching) {
                if (!pickedId) {
                  setPinErr("Kullanıcı seçin.");
                  return;
                }
                await login(pin, pickedId);
                return;
              }
              await unlock(pin);
            } catch {
              /* pinErr already set */
            }
          }}
          onCancel={switching ? () => setSwitching(false) : undefined}
          onExit={needsLogin ? leaveLoginGate : undefined}
          busy={busy || (pickingCashier && !cashiersLoaded)}
          error={pinErr}
          testId={needsLogin ? "pos-login-pad" : switching ? "pos-switch-pad" : "pos-unlock-pad"}
        />
      )}
      {gate && (
        <PosPinPad
          title="Yönetici onayı"
          hint={gate.message || "Onaylayanı seçin ve PIN yazın, ya da bildirimden uzaktan onaylayın."}
          cashiers={cashiers.filter((c) => c.has_cashier_pin && c.pos_rules?.can_approve)}
          selectedId={pickedId}
          onSelect={(c) => setPickedId(c?.id || "")}
          onSubmit={async (pin) => {
            if (!pinIsValid(pin) || !gate.requestId) return;
            if (!pickedId) {
              setPinErr("Kullanıcı seçin.");
              return;
            }
            try {
              const data = await decide(gate.requestId, "approve", pin, pickedId);
              if (data.status === "approved") setGate(null);
            } catch (err) {
              setPinErr(err.response?.data?.detail || "Onay başarısız.");
            }
          }}
          onCancel={() => setGate(null)}
          busy={busy}
          error={pinErr}
          testId="pos-manager-pin"
        />
      )}
    </PosSessionContext.Provider>
  );
}

export function usePosUser() {
  return useAuth();
}
