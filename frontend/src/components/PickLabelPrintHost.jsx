import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL } from "../context/AuthContext";
import { LabelCanvas, builtinTemplates, printLabelJobs } from "./LabelDesigner";
import { labelCopyCount } from "../utils/pickLabels";
import { pickLineToLabelProduct, resolveLabelTemplate } from "../utils/resolveLabelTemplate";

/**
 * Sevkiyat toplama: stok kartına atanmış etiket şablonu (yoksa varsayılan) ile yazdır.
 * printRequest = { id, items }; yazdırma bitince onDone.
 */
export function PickLabelPrintHost({
  companyId,
  company,
  printRequest,
  onDone,
}) {
  const builtins = useMemo(() => builtinTemplates(), []);
  const [templates, setTemplates] = useState([]);
  const [templatesReady, setTemplatesReady] = useState(false);
  const [batch, setBatch] = useState(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const lastIdRef = useRef(null);

  useEffect(() => {
    if (!companyId) {
      setTemplates([]);
      setTemplatesReady(true);
      return undefined;
    }
    let cancelled = false;
    setTemplatesReady(false);
    axios.get(`${API_URL}/label-templates?company_id=${companyId}`).then((r) => {
      if (cancelled) return;
      setTemplates(Array.isArray(r.data) ? r.data : []);
      setTemplatesReady(true);
    }).catch(() => {
      if (cancelled) return;
      setTemplates([]);
      setTemplatesReady(true);
    });
    return () => { cancelled = true; };
  }, [companyId]);

  useEffect(() => {
    const reqId = printRequest?.id;
    const items = printRequest?.items;
    if (!templatesReady || !reqId || !items?.length) return undefined;
    if (lastIdRef.current === reqId) return undefined;
    lastIdRef.current = reqId;

    const groups = new Map();
    for (const line of items) {
      const product = pickLineToLabelProduct(line);
      if (!product) continue;
      const tpl = resolveLabelTemplate(templates, product, builtins);
      if (!tpl) continue;
      const key = String(tpl.id || tpl._id || "default");
      if (!groups.has(key)) groups.set(key, { tpl, products: [] });
      const copies = labelCopyCount(line);
      for (let i = 0; i < copies; i += 1) groups.get(key).products.push(product);
    }
    const list = [...groups.values()].filter((g) => g.products.length);
    if (!list.length) {
      toast.error("Yazdırılacak etiket yok.");
      onDoneRef.current?.();
      return undefined;
    }

    let cancelled = false;
    let idx = 0;
    const runNext = () => {
      if (cancelled) return;
      if (idx >= list.length) {
        toast.success(`${list.reduce((n, g) => n + g.products.length, 0)} ürün etiketi yazdırmaya gönderildi.`);
        onDoneRef.current?.();
        return;
      }
      const g = list[idx];
      idx += 1;
      const sourceId = `pick-label-print-source-${String(g.tpl.id || tplKey(g.tpl))}-${idx}`;
      setBatch({
        tpl: g.tpl,
        products: g.products,
        sourceId,
      });
      setTimeout(() => {
        if (cancelled) return;
        Promise.resolve(
          printLabelJobs(
            g.tpl,
            g.products,
            g.tpl.page || { mode: "thermal", cols: 1, rows: 1, gap_mm: 2 },
            sourceId,
          ),
        ).finally(() => {
          if (cancelled) return;
          setBatch(null);
          setTimeout(runNext, 400);
        });
      }, 280);
    };
    runNext();
    return () => { cancelled = true; };
  }, [printRequest, templates, builtins, templatesReady]);

  if (!batch) return null;
  return (
    <div
      id={batch.sourceId}
      className="fixed left-[-10000px] top-0 opacity-0 pointer-events-none"
      aria-hidden="true"
      data-testid="pick-label-print-host"
    >
      {batch.products.map((p, i) => (
        <div key={`${p.id}-${i}`} className="lbl">
          <LabelCanvas tpl={batch.tpl} product={p} company={company} scale={1} />
        </div>
      ))}
    </div>
  );
}

function tplKey(tpl) {
  return String(tpl?.id || tpl?._id || "x");
}
