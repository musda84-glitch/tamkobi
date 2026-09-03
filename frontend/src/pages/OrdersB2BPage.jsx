import React, { useState, useEffect } from "react";
import axios from "axios";
import { API_URL, useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import {
  Boxes,
  ShoppingCart,
  FileText,
  Truck,
  CheckCircle2,
  Clock,
  Send,
  Plus,
  Search,
  Filter,
  Layers,
  Sparkles,
  ShoppingBag,
  X,
  MessageSquare
} from "lucide-react";
import { QuickMessageModal, TEMPLATES } from "../components/QuickMessageModal";
import { PrintDocument, PrintTemplateEditor } from "../components/PrintDocument";
import { useSearchParams } from "react-router-dom";
import { Printer, Tag, CheckCircle, RotateCcw, FileText as FileIcon } from "lucide-react";
import { CargoLabel } from "../components/CargoLabel";

export default function OrdersB2BPage() {
  const { activeCompany } = useAuth();
  const [activeTab, setActiveTab] = useState("orders"); // orders | b2b_portal
  const [orders, setOrders] = useState([]);
  const [notifyOrder, setNotifyOrder] = useState(null);
  const [printOrder, setPrintOrder] = useState(null);
  const [labelOrder, setLabelOrder] = useState(null);
  const [dispatchDoc, setDispatchDoc] = useState(null);
  const [returnOrder, setReturnOrder] = useState(null);
  const [returnReason, setReturnReason] = useState("");
  const approve = async (ord) => { try { const carrier = window.prompt("Kargo firması seçin (yurtici / aras / mng / surat / ptt / trendyol_express / hepsijet):", ord.cargo_carrier || "yurtici"); if (carrier === null) return; await axios.post(`${API_URL}/orders/${ord.id}/approve`, { cargo_carrier: carrier }); toast.success("Sipariş onaylandı."); loadData(); } catch (err) { toast.error(err.response?.data?.detail || "Onaylanamadı."); } };
  const doReturn = async () => { try { const r = await axios.post(`${API_URL}/orders/${returnOrder.id}/return`, { reason: returnReason, restock: true }); toast.success(r.data.message); setReturnOrder(null); setReturnReason(""); loadData(); } catch (err) { toast.error(err.response?.data?.detail || "İade kaydedilemedi."); } };
  const makeDispatch = async (ord) => { try { const r = await axios.post(`${API_URL}/orders/${ord.id}/create-dispatch`); toast.success(r.data.message); setDispatchDoc(r.data.dispatch); loadData(); } catch (err) { toast.error(err.response?.data?.detail || "İrsaliye oluşturulamadı."); } };
  const [editTpl, setEditTpl] = useState(false);
  const [searchParams] = useSearchParams();
  const customerFilter = searchParams.get("customer") || "";
  const [products, setProducts] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);

  // B2B Cart State
  const [cart, setCart] = useState({});
  const [b2bCustomer, setB2bCustomer] = useState("");

  useEffect(() => {
    loadData();
  }, [activeCompany]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [ordRes, prodRes, cntRes] = await Promise.all([
        axios.get(`${API_URL}/orders?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}`),
        axios.get(`${API_URL}/products?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}&b2b_only=true`),
        axios.get(`${API_URL}/contacts?company_id=${activeCompany?.id || activeCompany?._id || 'comp_nexus_main_01'}&type=customer`)
      ]);
      setOrders(ordRes.data);
      setProducts(prodRes.data);
      setContacts(cntRes.data);
      if (cntRes.data.length > 0) setB2bCustomer(cntRes.data[0].id || cntRes.data[0]._id);
    } catch (err) {
      toast.error("Sipariş verileri yüklenemedi.");
    } finally {
      setLoading(false);
    }
  };

  const handleConvertToInvoice = async (orderId) => {
    try {
      const res = await axios.post(`${API_URL}/orders/${orderId}/convert-to-invoice`);
      toast.success(res.data.message);
      loadData();
    } catch (err) {
      toast.error("Faturaya dönüştürme başarısız.");
    }
  };

  const handleUpdateOrderStatus = async (orderId, newStatus) => {
    try {
      await axios.put(`${API_URL}/orders/${orderId}/status`, { status: newStatus });
      toast.success("Sipariş durumu güncellendi.");
      loadData();
    } catch (err) {
      toast.error("Durum güncellenemedi.");
    }
  };

  const handleCreateCargoForOrder = async (order) => {
    try {
      const res = await axios.post(`${API_URL}/cargo/create-shipment`, {
        carrier_code: "yurtici",
        order_id: order.id || order._id,
        customer_name: order.customer_name,
        address: order.shipping_address,
        city: order.city,
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"
      });
      toast.success(`Kargo fişi oluşturuldu! Takip No: ${res.data.tracking_number}`);
      loadData();
    } catch (err) {
      toast.error("Kargo kaydı oluşturulamadı.");
    }
  };

  // B2B Cart logic
  const handleAddToCart = (product, qty = 1) => {
    const current = cart[product.id || product._id] || 0;
    setCart({ ...cart, [product.id || product._id]: current + qty });
    toast.success(`${product.name} sepete eklendi.`);
  };

  const handlePlaceB2BOrder = async () => {
    const items = [];
    let total = 0;
    const selectedContact = contacts.find(c => (c.id === b2bCustomer || c._id === b2bCustomer));

    Object.keys(cart).forEach(prodId => {
      const p = products.find(prod => (prod.id === prodId || prod._id === prodId));
      const qty = cart[prodId];
      if (p && qty > 0) {
        // Apply B2B wholesale discount 15%
        const b2bPrice = p.sale_price * 0.85;
        const itmTotal = b2bPrice * qty;
        total += itmTotal;
        items.push({
          product_id: p.id || p._id,
          product_name: p.name,
          sku: p.sku,
          quantity: qty,
          unit_price: b2bPrice,
          total: itmTotal
        });
      }
    });

    if (items.length === 0) {
      toast.error("Sepetiniz boş.");
      return;
    }

    try {
      await axios.post(`${API_URL}/orders`, {
        company_id: activeCompany?.id || activeCompany?._id || "comp_nexus_main_01",
        channel: "b2b",
        customer_name: selectedContact?.name || "B2B Bayi",
        customer_email: selectedContact?.email || "bayi@nexus.com",
        customer_phone: selectedContact?.phone || "0555 111 22 33",
        shipping_address: selectedContact?.address || "Bayi Deposu",
        city: selectedContact?.city || "İstanbul",
        items: items,
        total_amount: total,
        currency: "TRY",
        order_status: "approved"
      });
      toast.success("B2B Toptan Sipariş başarıyla oluşturuldu!");
      setCart({});
      setActiveTab("orders");
      loadData();
    } catch (err) {
      toast.error("Sipariş oluşturulamadı.");
    }
  };

  const cartItemsCount = Object.values(cart).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-6" data-testid="orders-b2b-page">
      {dispatchDoc && <PrintDocument docType="dispatch" doc={dispatchDoc} company={activeCompany} onClose={() => setDispatchDoc(null)} />}
      {returnOrder && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"><div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-3 text-xs" data-testid="return-modal">
          <h3 className="text-sm font-bold">İade — {returnOrder.order_number}</h3><p className="text-slate-500">Tüm kalemler iade alınır, stok geri eklenir ve iade kaydı oluşturulur.</p>
          <textarea value={returnReason} onChange={(e) => setReturnReason(e.target.value)} rows={3} placeholder="İade nedeni" className="w-full bg-slate-50 border rounded-lg p-2" data-testid="return-reason-input" />
          <div className="flex justify-end gap-2"><button onClick={() => setReturnOrder(null)} className="px-3 py-1.5 border rounded-lg">İptal</button><button onClick={doReturn} className="px-4 py-1.5 bg-rose-600 text-white rounded-lg font-semibold" data-testid="return-confirm-btn">İadeyi Kaydet</button></div>
        </div></div>
      )}
      {labelOrder && <CargoLabel order={labelOrder} company={activeCompany} onClose={() => setLabelOrder(null)} />}
      {printOrder && <PrintDocument docType="order" doc={printOrder} company={activeCompany} onClose={() => setPrintOrder(null)} onEditTemplate={() => setEditTpl(true)} />}
      {editTpl && <PrintTemplateEditor companyId={activeCompany?.id || "comp_nexus_main_01"} docType="order" onClose={() => setEditTpl(false)} />}
      {notifyOrder && (
        <QuickMessageModal
          companyId={activeCompany?.id || activeCompany?._id || "comp_nexus_main_01"}
          recipient={{ name: notifyOrder.customer_name, phone: notifyOrder.customer_phone, email: notifyOrder.customer_email }}
          defaultSubject={`Siparişiniz Yola Çıktı - ${notifyOrder.order_number}`}
          defaultMessage={TEMPLATES.order(notifyOrder)}
          context="order"
          refId={notifyOrder.id}
          onClose={() => setNotifyOrder(null)}
        />
      )}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">Sipariş Modülü & B2B Bayi Portalı</h1>
          <p className="text-xs sm:text-sm text-slate-500">Pazaryeri & B2B Sipariş Takibi, Kargo Barkodu ve Tek Tıkla Faturalama</p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 bg-slate-200/80 p-1 rounded-xl self-start sm:self-auto text-xs font-semibold">
          <button
            onClick={() => setActiveTab("orders")}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeTab === "orders" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
            data-testid="tab-orders"
          >
            Gelen Siparişler ({orders.length})
          </button>
          <button
            onClick={() => setActiveTab("b2b_portal")}
            className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
              activeTab === "b2b_portal" ? "bg-indigo-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
            data-testid="tab-b2b-portal"
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>B2B Bayi Kataloğu {cartItemsCount > 0 && `(${cartItemsCount})`}</span>
          </button>
        </div>
      </div>

      {activeTab === "orders" ? (
        /* ORDERS LIST VIEW */
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
                <tr>
                  <th className="px-4 py-3">Sipariş No & Kanal</th>
                  <th className="px-4 py-3">Müşteri / Alıcı</th>
                  <th className="px-4 py-3">Ürünler</th>
                  <th className="px-4 py-3 text-right">Tutar</th>
                  <th className="px-4 py-3">Sipariş Durumu</th>
                  <th className="px-4 py-3 text-center">İşlemler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.filter((o) => !customerFilter || o.customer_name === customerFilter).map((ord) => (
                  <tr key={ord.id || ord._id || ord.order_number} className="hover:bg-slate-50/70 transition" data-testid={`order-row-${ord.order_number}`}>
                    <td className="px-4 py-3 font-medium">
                      <div className="font-bold text-slate-900 font-mono">{ord.order_number}</div>
                      <span className="text-[10px] uppercase font-semibold text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded">
                        {ord.channel}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{ord.customer_name}</div>
                      <div className="text-[11px] text-slate-400">{ord.city}</div>
                    </td>
                    <td className="px-4 py-3">
                      {ord.items?.map((it, idx) => (
                        <div key={idx} className="text-slate-700">
                          {it.quantity}x {it.product_name || it.name}
                        </div>
                      ))}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                      {ord.total_amount?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={ord.order_status}
                        onChange={(e) => handleUpdateOrderStatus(ord.id || ord._id, e.target.value)}
                        className="bg-slate-100 border border-slate-200 rounded p-1 text-[11px] font-semibold"
                        data-testid={`order-status-select-${ord.order_number}`}
                      >
                        <option value="pending">Beklemede</option>
                        <option value="approved">Onaylandı</option>
                        <option value="preparing">Hazırlanıyor</option>
                        <option value="shipped">Kargolandı</option>
                        <option value="completed">Tamamlandı</option>
                        <option value="returned">İade Edildi</option>
                        <option value="partially_returned">Kısmi İade</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {!ord.is_invoiced ? (
                          <button
                            onClick={() => handleConvertToInvoice(ord.id || ord._id)}
                            className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 shadow-sm"
                            title="Tek Tıkla E-Faturaya Dönüştür"
                            data-testid={`convert-inv-btn-${ord.order_number}`}
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>Faturala</span>
                          </button>
                        ) : (
                          <span className="text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded">
                            Faturalandı
                          </span>
                        )}

                        {!ord.cargo_tracking_number ? (
                          <button
                            onClick={() => handleCreateCargoForOrder(ord)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg text-xs font-semibold flex items-center gap-1"
                            title="Kargo Fişi Oluştur"
                            data-testid={`create-cargo-btn-${ord.order_number}`}
                          >
                            <Truck className="w-3.5 h-3.5" />
                            <span>Kargola</span>
                          </button>
                        ) : (
                          <span className="text-[10px] font-mono font-semibold text-slate-600">
                            {ord.cargo_tracking_number}
                          </span>
                        )}
                        {["pending", "new"].includes(ord.order_status) && <button onClick={() => approve(ord)} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg transition" title="Siparişi Onayla + Kargo Seç" data-testid={`approve-order-btn-${ord.order_number}`}><CheckCircle className="w-4 h-4" /></button>}
                        <button onClick={() => makeDispatch(ord)} className="p-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition" title={ord.dispatch_number ? `İrsaliye: ${ord.dispatch_number}` : "E-İrsaliye Oluştur & Yazdır"} data-testid={`dispatch-btn-${ord.order_number}`}><FileIcon className="w-4 h-4" /></button>
                        {!["returned"].includes(ord.order_status) && <button onClick={() => setReturnOrder(ord)} className="p-1.5 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition" title="İade Al" data-testid={`return-order-btn-${ord.order_number}`}><RotateCcw className="w-4 h-4" /></button>}
                        <button onClick={() => setLabelOrder(ord)} className="p-1.5 text-slate-600 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition" title="Kargo Etiketi Yazdır" data-testid={`cargo-label-btn-${ord.order_number}`}><Tag className="w-4 h-4" /></button>
                        <button onClick={() => setPrintOrder(ord)} className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition" title="Sipariş Formu Yazdır" data-testid={`print-order-btn-${ord.order_number}`}><Printer className="w-4 h-4" /></button>
                        <button
                          onClick={() => setNotifyOrder(ord)}
                          className="p-1.5 text-slate-600 hover:text-violet-600 hover:bg-violet-50 rounded-lg transition"
                          title="Müşteriye Sipariş / Kargo Takip Bildirimi Gönder"
                          data-testid={`notify-order-btn-${ord.order_number}`}
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* B2B WHOLESALE PORTAL VIEW */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" data-testid="b2b-portal-view">
          {/* Products Catalog */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-900">B2B Toptan Bayi Ürün Kataloğu</h2>
              <span className="text-xs bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full font-semibold">
                Bayi Özel İskontosu (%15 İndirimli Fiyatlar)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {products.map((p) => {
                const b2bPrice = p.sale_price * 0.85;
                return (
                  <div key={p.id || p._id} className="bg-white p-4 rounded-2xl border border-slate-200/90 shadow-sm flex flex-col justify-between space-y-3">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-400">{p.category}</span>
                      <h3 className="font-bold text-sm text-slate-900 mt-0.5">{p.name}</h3>
                      <div className="text-[11px] font-mono text-slate-500">SKU: {p.sku} • Stok: {p.stock_quantity} {p.unit}</div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                      <div>
                        <div className="text-[10px] text-slate-400 line-through">{p.sale_price?.toLocaleString('tr-TR')} ₺</div>
                        <div className="text-base font-bold text-indigo-700">{b2bPrice?.toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ₺</div>
                      </div>
                      <button
                        onClick={() => handleAddToCart(p, 5)}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm flex items-center gap-1"
                        data-testid={`b2b-add-btn-${p.sku}`}
                      >
                        <Plus className="w-3.5 h-3.5" /> +5 Koli Ekle
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* B2B Cart & Checkout */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200/90 shadow-sm space-y-4 h-fit">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-indigo-600" />
              <span>B2B Sipariş Sepeti</span>
            </h3>

            <div className="space-y-2 text-xs">
              <label className="block font-semibold text-slate-700">Sipariş Veren Bayi</label>
              <select
                value={b2bCustomer}
                onChange={(e) => setB2bCustomer(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg p-2 font-medium"
              >
                {contacts.map(c => (
                  <option key={c.id || c._id} value={c.id || c._id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="divide-y divide-slate-100 text-xs max-h-56 overflow-y-auto">
              {Object.keys(cart).length === 0 ? (
                <p className="py-6 text-center text-slate-400">Sepetinizde ürün bulunmuyor.</p>
              ) : (
                Object.keys(cart).map(prodId => {
                  const p = products.find(prod => (prod.id === prodId || prod._id === prodId));
                  const qty = cart[prodId];
                  if (!p || qty <= 0) return null;
                  const price = p.sale_price * 0.85;
                  return (
                    <div key={prodId} className="py-2 flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-slate-900">{p.name}</div>
                        <div className="text-slate-400 text-[11px]">{qty} Adet x {price.toLocaleString('tr-TR')} ₺</div>
                      </div>
                      <div className="font-bold text-slate-900">
                        {(qty * price).toLocaleString('tr-TR')} ₺
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <button
              onClick={handlePlaceB2BOrder}
              disabled={cartItemsCount === 0}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition"
              data-testid="b2b-submit-order-btn"
            >
              Toptan Siparişi Tamamla
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
