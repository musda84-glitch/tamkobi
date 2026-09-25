
/** Platform panelinin bölümleri: sol menü de içerik de bu tek listeden gelir.
 *
 * Menü ayrı bir listeden gelirken Kotalar, Posta Sunucusu, Destek Talepleri ve
 * AI & Destek bağlantıları paneli olmadan menüde duruyordu: tıklanınca başlık
 * görünüyor, içerik alanı bomboş kalıyordu. Bölümü buraya eklemek hem menüyü
 * hem içeriği doğurduğu için o durum artık oluşamaz.
 *
 * Grupların sırası ve etiketleri navGroups.js → SYSTEM_NAV_GROUPS'ta.
 */
import React from "react";
import { LayoutGrid, Building2, Package, Boxes, Inbox, CreditCard, Settings, Bell, Users, Globe, Sparkles, Mail, Gauge, Bot, Headset, Database, HardDrive, UserX, Megaphone, ScrollText, MessageSquare } from "lucide-react";
import { SaasOverview } from "./SaasOverview";
import { CompaniesTable } from "./CompaniesTable";
import { PlansPanel } from "./PlansPanel";
import { RequestsPanel } from "./RequestsPanel";
import { PaymentsPanel, RemindersPanel, PlatformSettingsPanel } from "./PlatformPanels";
import { AiProviderPanel } from "./AiProviderPanel";
import { PlatformUsersPanel } from "./PlatformUsersPanel";
import { UserDataErasePanel } from "./UserDataErasePanel";
import { WebsiteAdminPanel } from "./WebsiteAdminPanel";
import { ModuleCatalogPanel } from "./ModuleCatalogPanel";
import { QuotasPanel } from "./QuotasPanel";
import { StorageManagerPanel } from "./StorageManagerPanel";
import { PlatformMailPanel } from "./PlatformMailPanel";
import { PlatformSmsPanel } from "./PlatformSmsPanel";
import { AddonsPanel } from "./AddonsPanel";
import { SupportTicketsPanel } from "./SupportTicketsPanel";
import { DatabasePanel } from "./DatabasePanel";
import { MaintenanceAnnouncePanel } from "./MaintenanceAnnouncePanel";
import { SystemLogsPanel } from "./SystemLogsPanel";

/** `key` yol sonudur: "" → /sistem, "kotalar" → /sistem/kotalar. */
export const sectionPath = (key) => (key ? `/sistem/${key}` : "/sistem");

/** `render` bağlamı SystemAdminPage'den gelir: yüklenen veriler ve eylemler. */
export const SYSTEM_SECTIONS = [
  { key: "", label: "Genel Bakış", icon: LayoutGrid, render: (c) => <SaasOverview data={c.overview} catalog={c.catalog} onOpenCompany={c.openCompany} onGoRequests={c.goRequests} /> },
  { key: "web", label: "Web Sitesi", icon: Globe, render: (c) => <WebsiteAdminPanel plans={c.plans} onChanged={c.changed} /> },
  { key: "paketler", label: "Paketler", icon: Package, render: (c) => <PlansPanel plans={c.plans} catalog={c.catalog} onChanged={c.changed} /> },
  { key: "moduller", label: "Modül Kataloğu", icon: Boxes, render: (c) => <ModuleCatalogPanel catalog={c.catalog} plans={c.plans} onChanged={c.changed} /> },
  { key: "sirketler", label: "Şirketler & Lisanslar", icon: Building2, render: (c) => <CompaniesTable rows={c.companies} plans={c.plans} onOpen={c.openCompany} onCreated={(r) => { c.changed(); c.openCompany(r.id); }} /> },
  { key: "kotalar", label: "Kotalar", icon: Gauge, render: (c) => <QuotasPanel onOpenCompany={c.openCompany} /> },
  { key: "depolama", label: "Depolama", icon: HardDrive, render: (c) => <StorageManagerPanel onOpenCompany={c.openCompany} /> },
  { key: "kullanicilar", label: "Panel Yöneticileri", icon: Users, render: () => <PlatformUsersPanel /> },
  { key: "veri-silme", label: "Veri Silme", icon: UserX, render: () => <UserDataErasePanel /> },
  { key: "destek", label: "Destek Talepleri", icon: Headset, badge: "open_tickets", render: (c) => <SupportTicketsPanel onOpenCompany={c.openCompany} /> },
  { key: "talepler", label: "Yükseltme Talepleri", icon: Inbox, badge: "pending_requests", render: (c) => <RequestsPanel requests={c.requests} onChanged={c.changed} onOpenCompany={c.openCompany} /> },
  { key: "odemeler", label: "Ödemeler", icon: CreditCard, render: () => <PaymentsPanel /> },
  { key: "hatirlatmalar", label: "Hatırlatmalar", icon: Bell, render: () => <RemindersPanel /> },
  { key: "duyurular", label: "Güncelleme & Duyuru", icon: Megaphone, render: () => <MaintenanceAnnouncePanel /> },
  { key: "loglar", label: "Sistem Logları", icon: ScrollText, render: () => <SystemLogsPanel /> },
  { key: "posta", label: "Posta Sunucusu", icon: Mail, render: () => <PlatformMailPanel /> },
  { key: "sms", label: "SMS Modülü", icon: MessageSquare, render: () => <PlatformSmsPanel /> },
  { key: "ai", label: "AI Entegrasyonu", icon: Sparkles, render: () => <AiProviderPanel /> },
  { key: "araclar", label: "AI & Destek", icon: Bot, render: () => <AddonsPanel /> },
  { key: "veritabani", label: "Veritabanı", icon: Database, render: () => <DatabasePanel /> },
  { key: "ayarlar", label: "Platform Ayarları", icon: Settings, render: () => <PlatformSettingsPanel /> },
].map((s) => ({ ...s, path: sectionPath(s.key) }));

export const findSystemSection = (key) => SYSTEM_SECTIONS.find((s) => s.key === (key || ""));
