import React, { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { API_URL, useAuth } from "../context/AuthContext";
import { toast } from "sonner";

import {
  Bot,
  Sparkles,
  Send,
  TrendingUp,
  TrendingDown,
  ShieldAlert,
  Wallet,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  ArrowRight
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from "recharts";

export default function AIAssistantPage() {
  const { activeCompany } = useAuth();
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: `Merhaba! Ben **TamKobi AI Finansal ve Mali Danışmanınızım**.

Şirketinizin güncel faturaları, tahsilatları, kritik stok seviyeleri ve banka bakiyeleri entegre edilmiş durumdadır.
Aşağıdaki hızlı konulardan birini seçebilir veya şirketinize özel finansal danışmanlık sorunuzu yazabilirsiniz.`
    }
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [forecast, setForecast] = useState(null);
  const [aiBadge, setAiBadge] = useState("Yapay Zeka Destekli");
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadForecast = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/ai/cashflow-forecast?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`);
      setForecast(res.data);
    } catch (err) {
      console.error("Nakit tahmini yüklenemedi", err);
    }
  }, [activeCompany]);
  useEffect(() => { loadForecast(); }, [loadForecast]);
  useEffect(() => {
    axios.get(`${API_URL}/ai/status`).then((r) => { if (r.data?.badge) setAiBadge(r.data.badge); }).catch(() => {});
  }, []);

  const handleSendMessage = async (msgText) => {
    const textToSend = msgText || inputMessage;
    if (!textToSend.trim() || loading) return;

    const userMsg = { role: "user", content: textToSend };
    setMessages((prev) => [...prev, userMsg]);
    setInputMessage("");
    setLoading(true);

    try {
      const res = await axios.post(`${API_URL}/ai/financial-advisor`, {
        message: textToSend,
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"
      });

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: res.data.advice }
      ]);
    } catch (err) {
      toast.error("AI yanıt verirken bir sorun oluştu.");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Üzgünüm, şu an bağlantıda bir gecikme yaşandı. Lütfen biraz sonra tekrar deneyin." }
      ]);
    } finally {
      setLoading(false);
    }
  };

  const quickPrompts = [
    "30 günlük nakit akışı risklerimi ve fırsatlarımı özetle.",
    "Kritik stoktaki ürünler için acil sipariş ve tedarik planı çıkar.",
    "Pazaryeri komisyon ve kargo maliyetlerimi nasıl optimize ederim?",
    "Bu ay tahmini KDV ve gelir vergisi yüküm ne kadar olacak?"
  ];

  return (
    <div className="space-y-6" data-testid="ai-assistant-page">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 bg-purple-100 text-purple-800 px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider mb-1">
            <Sparkles className="w-3.5 h-3.5 text-purple-600" />
            <span>{aiBadge} Destekli</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">TamKobi AI Finansal Danışman</h1>
          <p className="text-xs sm:text-sm text-slate-500">Mali Müşavir Seviyesinde Nakit Akış Analizi, Vergi ve Büyüme Öngörüleri</p>
        </div>
      </div>

      {/* 30-Day Cash Flow Forecast Card */}
      {forecast && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-emerald-600" />
                <span>30 Günlük Yapay Zeka Nakit Akışı Projeksiyonu</span>
              </h2>
              <p className="text-xs text-slate-500">Bekleyen tahsilatlar, maaş ve hammadde ödeme takvimi simülasyonu</p>
            </div>
            <div className="text-right">
              <div className="text-xs text-slate-400">30 Gün Sonraki Tahmini Kasa:</div>
              <div className="text-lg font-bold text-emerald-600">{forecast.projected_30d_cash?.toLocaleString('tr-TR')} ₺</div>
            </div>
          </div>

          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={forecast.forecast_chart}>
                <defs>
                  <linearGradient id="colorCash" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="day" stroke="#94a3b8" fontSize={10} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} tickFormatter={(v) => `${Math.round(v/1000)}k ₺`} />
                <Tooltip formatter={(v) => `${Number(v).toLocaleString('tr-TR')} ₺`} />
                <Area type="monotone" dataKey="projected_cash" stroke="#8b5cf6" strokeWidth={2.5} fillOpacity={1} fill="url(#colorCash)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-purple-50/70 border border-purple-200/60 rounded-xl p-3 text-xs text-purple-950 flex items-start gap-2">
            <Lightbulb className="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">AI Özeti:</span> {forecast.ai_summary}
            </div>
          </div>
        </div>
      )}

      {/* Interactive AI Chat Box */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm flex flex-col h-[520px] overflow-hidden">
        {/* Chat Messages */}
        <div className="flex-1 p-5 overflow-y-auto space-y-4 bg-slate-50/50">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex gap-3 text-xs ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {m.role === 'assistant' && (
                <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center flex-shrink-0 shadow-md shadow-purple-600/30">
                  <Bot className="w-4 h-4" />
                </div>
              )}
              <div
                className={`max-w-2xl rounded-2xl p-4 space-y-2 leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-emerald-600 text-white font-medium rounded-tr-none shadow-md shadow-emerald-600/20'
                    : 'bg-white border border-slate-200/90 text-slate-800 shadow-sm rounded-tl-none whitespace-pre-wrap'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 text-xs items-center">
              <div className="w-8 h-8 rounded-xl bg-purple-600 text-white flex items-center justify-center animate-pulse">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl p-3 text-slate-500 shadow-sm flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-500 animate-bounce"></span>
                <span className="w-2 h-2 rounded-full bg-purple-500 animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-2 h-2 rounded-full bg-purple-500 animate-bounce [animation-delay:0.4s]"></span>
                <span className="text-[11px] font-medium ml-1">TamKobi AI şirketinizi analiz ediyor...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Quick Prompts Bar */}
        <div className="px-4 py-2 bg-slate-100/70 border-t border-slate-200 flex gap-2 overflow-x-auto text-xs">
          {quickPrompts.map((p, i) => (
            <button
              key={i}
              onClick={() => handleSendMessage(p)}
              className="px-3 py-1.5 bg-white hover:bg-purple-50 hover:text-purple-700 text-slate-700 rounded-lg border border-slate-200 whitespace-nowrap transition text-[11px] font-medium"
              data-testid={`quick-prompt-${i}`}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Input Bar */}
        <div className="p-3 bg-white border-t border-slate-200">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              placeholder="Finansal durumunuz, vergi, kârlılık veya nakit akışı hakkında soru sorun..."
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-purple-500 font-medium"
              data-testid="ai-chat-input"
            />
            <button
              type="submit"
              disabled={loading || !inputMessage.trim()}
              className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-200 text-white rounded-xl text-xs font-bold shadow-md shadow-purple-600/20 transition flex items-center gap-1.5"
              data-testid="ai-chat-send-btn"
            >
              <Send className="w-4 h-4" />
              <span>Gönder</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
