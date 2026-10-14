import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";
import { buildOrderReceiptHtml, buildPaymentReceiptHtml, downloadReceiptPdf, printHtml, type ReceiptRequest } from "../lib/receipt";
import type { Order } from "../lib/types";
import { useApi } from "../lib/useApi";
import { Button, ErrorNote, Modal, notify } from "./ui";

type OrderReceiptData = { order: Order; client: { debt: number; opening_due: number } | null };
const fileSafe = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "recu";

function ReceiptModal({ req, onClose }: { req: ReceiptRequest; onClose: () => void }) {
  const { settings } = useAuth();
  const { data, error } = useApi<OrderReceiptData | null>(() => (req.kind === "order" ? api.get<OrderReceiptData>(`/orders/${req.id}/receipt`) : Promise.resolve(null)), [req.kind === "order" ? req.id : 0]);
  const [busy, setBusy] = useState(false);

  let html = "", filename = "recu";
  if (req.kind === "order" && data) {
    html = buildOrderReceiptHtml({ ...data.order, client: data.client }, settings);
    filename = `Recu-${data.order.order_number}`;
  } else if (req.kind === "payment") {
    html = buildPaymentReceiptHtml(req.data, settings);
    filename = `Recu-paiement-${fileSafe(req.data.client_name)}-${new Date().toISOString().slice(0, 10)}`;
  }

  const pdf = async () => {
    setBusy(true);
    try {
      const path = await downloadReceiptPdf(html, filename, settings.receipt_format);
      notify(path ? `PDF enregistré : ${path.split(/[\\/]/).pop()}` : "Dans la fenêtre d'impression, choisissez « Enregistrer au format PDF ».");
    } catch (e) { notify(e instanceof Error ? e.message : "PDF impossible"); }
    finally { setBusy(false); }
  };

  return <Modal wide title={req.kind === "order" ? (data?.order.order_number ?? "Reçu") : "Reçu de paiement"} eyebrow="Reçu" onClose={onClose}
    footer={<><Button variant="secondary" onClick={onClose}>Fermer</Button><Button variant="secondary" icon="download" disabled={!html || busy} onClick={pdf}>Télécharger le PDF</Button><Button icon="printer" disabled={!html} onClick={() => printHtml(html)}>Imprimer</Button></>}>
    <ErrorNote message={error}/>
    {!html && !error && <p className="text-sm text-slate-400">Chargement…</p>}
    {html && <iframe title="Aperçu du reçu" data-testid="receipt-frame" srcDoc={html} className="h-[460px] w-full rounded-xl border border-slate-200 bg-white"/>}
  </Modal>;
}

/** Mounted once in the page layout: any screen can open a receipt with openReceipt(). */
export default function ReceiptHost() {
  const [req, setReq] = useState<ReceiptRequest | null>(null);
  useEffect(() => {
    const open = (e: Event) => setReq((e as CustomEvent<ReceiptRequest>).detail);
    window.addEventListener("ims-receipt", open);
    return () => window.removeEventListener("ims-receipt", open);
  }, []);
  return req ? <ReceiptModal req={req} onClose={() => setReq(null)}/> : null;
}
