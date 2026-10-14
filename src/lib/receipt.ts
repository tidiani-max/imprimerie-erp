import { cur, dh, fmtDay, money, num, todayStr } from "./format";
import type { Order, Settings } from "./types";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

type Fmt = Settings["receipt_format"];
// Paper presets. The page size is part of the HTML, so the print dialog opens on the right paper.
const PAPER: Record<Fmt, { page: string; body: string; logo: string }> = {
  // Ticket: no fixed page size (browsers cannot do "80mm × auto"); the printer's own paper setting rules and the content is 72 mm wide.
  ticket: { page: "@page{margin:3mm}", body: "width:72mm;font-size:11px", logo: "16mm" },
  a5: { page: "@page{size:A5;margin:12mm}", body: "font-size:13px", logo: "22mm" },
  a4: { page: "@page{size:A4;margin:16mm}", body: "font-size:14px", logo: "28mm" },
};
const STATUS: Record<string, { label: string; color: string }> = {
  Paid: { label: "PAYÉ", color: "#059669" }, Partial: { label: "PAIEMENT PARTIEL", color: "#d97706" }, Unpaid: { label: "NON PAYÉ", color: "#dc2626" },
};

export type OrderReceipt = Pick<Order, "order_number" | "client_name" | "product_service" | "quantity" | "unit_price" | "total_amount" | "amount_paid" | "amount_due" | "order_date" | "status">
  & Partial<Pick<Order, "support_type" | "width_cm" | "height_cm" | "rate_cm2" | "extra_fees">>
  & { payment_method?: string; client?: { debt: number; opening_due: number } | null };
export type PaymentReceipt = { client_name: string; amount: number; method: string; applied: { order_number: string; amount: number; is_opening?: boolean }[]; remaining: number };

function page(settings: Settings, title: string, inner: string) {
  const p = PAPER[settings.receipt_format] ?? PAPER.a5;
  const contact = [settings.shop_phone && `Tél : ${settings.shop_phone}`, settings.shop_email].filter(Boolean).join(" · ");
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    ${p.page}
    *{box-sizing:border-box} html,body{margin:0;padding:0}
    body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;color:#0f172a;${p.body};line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .head{text-align:center;padding-bottom:10px;border-bottom:2px solid #0f172a}
    .head img{max-height:${p.logo};max-width:70%;object-fit:contain;margin-bottom:6px}
    .head h1{margin:0;font-size:1.45em;letter-spacing:.01em} .head p{margin:2px 0;color:#475569;font-size:.9em}
    .title{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:14px 0 8px}
    .title b{font-size:1.1em;letter-spacing:.06em} .title span{color:#475569;font-size:.9em}
    .row{display:flex;justify-content:space-between;gap:10px;margin:4px 0} .muted{color:#64748b}
    table{width:100%;border-collapse:collapse;margin-top:10px} table,th,td{font-size:inherit}
    th{text-align:left;border-bottom:1.5px solid #0f172a;padding:6px 4px;font-size:.78em;text-transform:uppercase;letter-spacing:.05em}
    td{padding:7px 4px;border-bottom:1px solid #e2e8f0;vertical-align:top} .r{text-align:right;white-space:nowrap}
    .totals{margin:14px 0 0 auto;width:100%;max-width:300px} .totals .row{padding:2px 0}
    .due{font-weight:700;font-size:1.15em;border-top:2px solid #0f172a;margin-top:6px;padding-top:7px!important}
    .stamp{display:inline-block;margin:14px 0 0;padding:3px 10px;border:2px solid;border-radius:6px;font-weight:700;letter-spacing:.08em;font-size:.85em}
    .foot{margin-top:18px;padding-top:10px;border-top:1px dashed #94a3b8;text-align:center;color:#475569;font-size:.9em}
    .big{font-size:1.9em;font-weight:800;text-align:center;margin:12px 0 4px}
    .sub{color:#64748b;font-size:.85em;margin-top:2px}
    .acct{margin-top:12px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#f1f5f9}
  </style></head><body>
    <div class="head">${settings.logo ? `<img src="${settings.logo}" alt="">` : ""}<h1>${esc(settings.shop_name || "Imprimerie")}</h1>
      ${settings.shop_address ? `<p>${esc(settings.shop_address).replace(/\n/g, "<br>")}</p>` : ""}${contact ? `<p>${esc(contact)}</p>` : ""}</div>
    ${inner}
    <div class="foot">${esc(settings.receipt_footer || "Merci de votre confiance.")}</div>
  </body></html>`;
}

export function buildOrderReceiptHtml(o: OrderReceipt, settings: Settings) {
  const st = STATUS[o.status] ?? STATUS.Unpaid;
  const sized = o.support_type && o.width_cm && o.height_cm;
  const detail = sized
    ? `<div class="sub">${num(o.width_cm!)} × ${num(o.height_cm!)} cm (${num(o.width_cm! * o.height_cm!)} cm²${o.rate_cm2 ? ` × ${money(o.rate_cm2)} ${cur()}` : ""})${o.extra_fees ? ` + frais ${dh(o.extra_fees)} par pièce` : ""}</div>`
    : "";
  const account = o.client
    ? (o.client.debt > 0
        ? `<div class="acct"><div class="row"><b>Dette totale du client</b><b>${dh(o.client.debt)}</b></div>${o.client.opening_due > 0 ? `<div class="row muted"><span>dont dette antérieure</span><span>${dh(o.client.opening_due)}</span></div>` : ""}</div>`
        : `<div class="acct"><div class="row"><b>Dette du client</b><b>Aucune</b></div></div>`)
    : "";
  return page(settings, `Reçu ${o.order_number}`, `
    <div class="title"><b>REÇU ${esc(o.order_number)}</b><span>${esc(fmtDay(o.order_date))}</span></div>
    <div class="row"><span class="muted">Client</span><b>${esc(o.client_name ?? "—")}</b></div>
    <table><thead><tr><th>Désignation</th><th class="r">Qté</th><th class="r">P.U.</th><th class="r">Total</th></tr></thead>
      <tbody><tr><td>${esc(o.product_service)}${detail}</td><td class="r">${num(o.quantity)}</td><td class="r">${dh(o.unit_price)}</td><td class="r">${dh(o.total_amount)}</td></tr></tbody></table>
    <div class="totals"><div class="row"><span>Total</span><span>${dh(o.total_amount)}</span></div>
      <div class="row"><span>Payé</span><span>${dh(o.amount_paid)}</span></div>
      <div class="row due"><span>Reste à payer</span><span>${dh(o.amount_due)}</span></div></div>
    ${account}
    ${o.payment_method ? `<div class="row" style="margin-top:10px"><span class="muted">Mode de paiement</span><span>${esc(o.payment_method)}</span></div>` : ""}
    <div style="text-align:center"><span class="stamp" style="color:${st.color}">${st.label}</span></div>`);
}

export function buildPaymentReceiptHtml(r: PaymentReceipt, settings: Settings) {
  return page(settings, "Reçu de paiement", `
    <div class="title"><b>REÇU DE PAIEMENT</b><span>${esc(fmtDay(todayStr()))}</span></div>
    <div class="row"><span class="muted">Reçu de</span><b>${esc(r.client_name)}</b></div>
    <div class="big">${dh(r.amount)}</div><div style="text-align:center" class="muted">Mode de paiement : ${esc(r.method)}</div>
    ${r.applied.length ? `<table><thead><tr><th>Réglé sur</th><th class="r">Montant</th></tr></thead><tbody>${r.applied.map((a) => `<tr><td>${a.is_opening ? "Dette antérieure" : esc(a.order_number)}</td><td class="r">${dh(a.amount)}</td></tr>`).join("")}</tbody></table>` : ""}
    <div class="totals"><div class="row due"><span>Reste dû</span><span>${dh(r.remaining)}</span></div></div>`);
}

/** Prints through a hidden iframe (browsers and Electron, no popups). Waits for the logo to load first. */
export function printHtml(html: string) {
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open(); doc.write(html); doc.close();
  const loaded = Promise.all([...doc.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = () => r(0); }))));
  Promise.race([loaded, new Promise((r) => setTimeout(r, 1500))]).then(() => setTimeout(() => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 2000);
  }, 100));
}

export const currencyLabel = cur;

// ----- receipt window (preview, print, PDF) -----
export type ReceiptRequest = { kind: "order"; id: number } | { kind: "payment"; data: PaymentReceipt };
/** Opens the receipt window from anywhere in the app (the host lives in the page layout). */
export const openReceipt = (req: ReceiptRequest) => window.dispatchEvent(new CustomEvent("ims-receipt", { detail: req }));

declare global { interface Window { desktop?: { savePdf: (html: string, filename: string, format: string) => Promise<string> } } }

/**
 * Saves the receipt as a PDF. In the desktop app it is written straight to the Downloads folder (returns the path).
 * In a browser there is no such access: the print window opens instead (choose « Enregistrer au format PDF »); returns null.
 */
export async function downloadReceiptPdf(html: string, filename: string, format: Settings["receipt_format"]): Promise<string | null> {
  if (window.desktop?.savePdf) return window.desktop.savePdf(html, filename, format);
  printHtml(html);
  return null;
}
