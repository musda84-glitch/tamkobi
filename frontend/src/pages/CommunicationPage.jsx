
import React, { useEffect, useState } from "react";
import axios from "axios";
import { useSearchParams } from "react-router-dom";
import { Mail, MessageSquare, Megaphone, MessageCircle } from "lucide-react";
import { WhatsAppCenter } from "../components/WhatsAppCenter";
import { API_URL, useAuth } from "../context/AuthContext";
import { MailClient } from "../components/MailClient";
import { SmsCenter } from "../components/SmsCenter";
import { BulkCampaign } from "../components/BulkCampaign";

const TABS = [
  { key: "mail", label: "E-posta (Outlook)", icon: Mail },
  { key: "sms", label: "SMS (Netgsm)", icon: MessageSquare },
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "campaign", label: "Toplu Kampanya", icon: Megaphone }
];

export default function CommunicationPage() {
  const { activeCompany } = useAuth();
  const [searchParams] = useSearchParams();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [tab, setTab] = useState(searchParams.get("tab") || "mail");
  const [contacts, setContacts] = useState([]);

  useEffect(() => { axios.get(`${API_URL}/contacts?company_id=${companyId}`).then((r) => setContacts(r.data)).catch(() => {}); }, [companyId]);

  return (
    <div className="space-y-6" data-testid="communication-page">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">İletişim Merkezi</h1>
        <p className="text-xs sm:text-sm text-slate-500">E-posta kutunuz, Netgsm SMS, WhatsApp görüşmeleri ve toplu kampanyalar tek ekranda</p>
      </div>
      <div className="flex items-center gap-1 border-b border-slate-200 overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key)} className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px whitespace-nowrap transition ${tab === key ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"}`} data-testid={`comm-tab-${key}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>
      {tab === "mail" && <MailClient companyId={companyId} />}
      {tab === "sms" && <SmsCenter companyId={companyId} contacts={contacts} />}
      {tab === "whatsapp" && <WhatsAppCenter companyId={companyId} contacts={contacts} />}
      {tab === "campaign" && <BulkCampaign companyId={companyId} contacts={contacts} />}
    </div>
  );
}
