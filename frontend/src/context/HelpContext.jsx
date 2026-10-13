import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { API_URL, useAuth } from "./AuthContext";
import { resolvePageHelp, tourStorageKey } from "../help/pageRegistry";
import { shouldShowWizard } from "../help/onboarding";
import { buildClientAssistantContext } from "../help/assistantContext";

const HelpContext = createContext(null);

export function HelpProvider({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { authenticated, activeCompany, loading } = useAuth();
  const pageHelp = useMemo(
    () => resolvePageHelp(location.pathname, location.search),
    [location.pathname, location.search],
  );

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourIndex, setTourIndex] = useState(0);
  const [onboarding, setOnboarding] = useState(null);
  const [wizardForced, setWizardForced] = useState(false);
  const [articles, setArticles] = useState([]);
  const [assistantRemote, setAssistantRemote] = useState(null);

  const companyId = activeCompany?.id || activeCompany?._id;

  const loadOnboarding = useCallback(async () => {
    if (!authenticated || !companyId) return null;
    try {
      const r = await axios.get(`${API_URL}/onboarding/status`, { params: { company_id: companyId } });
      setOnboarding(r.data);
      return r.data;
    } catch {
      return null;
    }
  }, [authenticated, companyId]);

  useEffect(() => {
    loadOnboarding();
  }, [loadOnboarding]);

  useEffect(() => {
    const params = { product: "tamkobi", page_key: pageHelp.pageKey, limit: 8 };
    const url = authenticated ? `${API_URL}/help/articles` : `${API_URL}/public/help/articles`;
    axios
      .get(url, { params })
      .then((r) => setArticles(r.data.articles || []))
      .catch(() => setArticles([]));
    if (!authenticated) {
      setAssistantRemote(null);
      return;
    }
    axios
      .get(`${API_URL}/help/assistant/context`, {
        params: { page: pageHelp.pageKey, product: "tamkobi", summary: pageHelp.intro },
      })
      .then((r) => setAssistantRemote(r.data))
      .catch(() => setAssistantRemote(null));
  }, [authenticated, pageHelp.pageKey, pageHelp.intro]);

  const patchOnboarding = useCallback(
    async (body) => {
      if (!companyId) return null;
      const r = await axios.put(`${API_URL}/onboarding/progress`, { ...body, company_id: companyId });
      setOnboarding(r.data);
      return r.data;
    },
    [companyId],
  );

  const showWizard = wizardForced || shouldShowWizard(onboarding, { authenticated: authenticated && !loading, pathname: location.pathname });

  const openHelp = useCallback(() => setPopoverOpen(true), []);
  const closeHelp = useCallback(() => setPopoverOpen(false), []);

  const startTour = useCallback(() => {
    setPopoverOpen(false);
    setTourIndex(0);
    setTourOpen(true);
  }, []);

  const stopTour = useCallback(
    (markDone = false) => {
      setTourOpen(false);
      if (markDone) {
        try {
          localStorage.setItem(tourStorageKey(pageHelp.key), "1");
        } catch {
          /* ignore */
        }
      }
    },
    [pageHelp.key],
  );

  const openHelpCenter = useCallback(
    (q = "") => {
      setPopoverOpen(false);
      const qs = new URLSearchParams();
      if (q) qs.set("q", q);
      if (pageHelp.pageKey) qs.set("page", pageHelp.pageKey);
      navigate(`/yardim${qs.toString() ? `?${qs}` : ""}`);
    },
    [navigate, pageHelp.pageKey],
  );

  const openWizard = useCallback(() => {
    setPopoverOpen(false);
    setWizardForced(true);
  }, []);

  const closeWizard = useCallback(() => setWizardForced(false), []);

  const assistantContext = useMemo(
    () => buildClientAssistantContext({ pageHelp, articles, remote: assistantRemote }),
    [pageHelp, articles, assistantRemote],
  );

  const value = {
    pageHelp,
    popoverOpen,
    openHelp,
    closeHelp,
    tourOpen,
    tourIndex,
    setTourIndex,
    startTour,
    stopTour,
    onboarding,
    showWizard,
    loadOnboarding,
    patchOnboarding,
    openWizard,
    closeWizard,
    articles,
    openHelpCenter,
    assistantContext,
    companyId,
  };

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

export function useHelp() {
  const ctx = useContext(HelpContext);
  if (!ctx) throw new Error("useHelp must be used within HelpProvider");
  return ctx;
}

export function useHelpOptional() {
  return useContext(HelpContext);
}
