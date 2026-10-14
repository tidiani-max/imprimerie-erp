import { useEffect, useState } from "react";
import { dh, fmtDateTime, fmtShortDay, money, num } from "../lib/format";
import { openReceipt } from "../lib/receipt";
import type { Order } from "../lib/types";
import { Badge, Button, EmptyRow } from "./ui";

export type OrderRow = Pick<Order, "id" | "order_number" | "client_name" | "product_service" | "quantity" | "total_amount" | "amount_paid" | "amount_due" | "status" | "order_date"> & Partial<Pick<Order, "unit_price" | "created_at" | "support_type" | "width_cm" | "height_cm">>;

const FILTERS: [string, string][] = [["Tous", ""], ["Payé", "Paid"], ["Partiel", "Partial"], ["Impayé", "Unpaid"]];

export default function OrdersTable({ compact = false, data, onPay, filter: filterProp, onFilter }: { compact?: boolean; data: OrderRow[]; onPay?: (o: OrderRow) => void; filter?: string; onFilter?: (f: string) => void }) {
    const [innerFilter, setInnerFilter] = useState("");
  const filter = filterProp ?? innerFilter;
  const setFilter = onFilter ?? setInnerFilter;
  const [page, setPage] = useState(0);
  const filtered = data.filter(o => !filter || o.status === filter);
  const perPage = 5;
  const maxPage = Math.max(0, Math.ceil(filtered.length / perPage) - 1);
  useEffect(() => { if (page > maxPage) setPage(maxPage); }, [page, maxPage]);
  const shown = filtered.slice(page * perPage, page * perPage + perPage);

  return <section className={`${compact ? "mt-6" : ""} overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm`}>
    <div className="flex flex-col justify-between gap-4 border-b border-slate-100 p-5 sm:flex-row sm:items-center">
      <div><p className="font-bold text-slate-900">{compact ? "Commandes récentes" : "Toutes les commandes"}</p><p className="mt-1 text-xs text-slate-400">{compact ? "Les 5 dernières transactions enregistrées" : `${filtered.length} résultat${filtered.length > 1 ? "s" : ""}`}</p></div>
      {!compact && <div className="flex gap-1 rounded-xl bg-slate-100 p-1">{FILTERS.map(([label, value]) => <button key={label} onClick={() => { setFilter(value); setPage(0); }} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${filter === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{label}</button>)}</div>}
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm">
      <thead><tr className="bg-slate-50/70 text-[11px] uppercase tracking-wider text-slate-400"><th className="px-5 py-3 font-semibold">Commande</th><th className="px-4 py-3 font-semibold">Client</th><th className="px-4 py-3 font-semibold">Service</th><th className="px-4 py-3 font-semibold">Qté</th><th className="px-4 py-3 text-right font-semibold">Total</th><th className="px-4 py-3 text-right font-semibold">Reste</th><th className="px-4 py-3 font-semibold">Statut</th><th className="px-5 py-3"/></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {shown.length === 0 && <EmptyRow colSpan={8}>Aucune commande à afficher.</EmptyRow>}
        {shown.map(o => <tr className="transition hover:bg-slate-50/70" key={o.id}>
          <td className="px-5 py-4"><p className="font-mono text-xs font-bold text-blue-600">{o.order_number}</p><p className="mt-1 text-[11px] text-slate-400">{o.created_at ? fmtDateTime(o.created_at) : fmtShortDay(o.order_date)}</p></td>
          <td className="px-4 py-4 font-semibold text-slate-800">{o.client_name ?? "—"}</td>
          <td className="px-4 py-4 text-slate-500">{o.product_service}{o.support_type && o.width_cm && o.height_cm ? <span className="block text-xs text-slate-400">{num(o.width_cm)} × {num(o.height_cm)} cm</span> : null}</td>
          <td className="px-4 py-4 font-mono text-xs text-slate-600">{num(o.quantity)}</td>
          <td className="px-4 py-4 text-right font-mono text-xs font-semibold text-slate-800">{dh(o.total_amount)}</td>
          <td className={`px-4 py-4 text-right font-mono text-xs font-semibold ${o.amount_due > 0 ? "text-red-600" : "text-slate-400"}`}>{dh(o.amount_due)}</td>
          <td className="px-4 py-4"><Badge status={o.status}/></td>
          <td className="px-5 py-4"><div className="flex justify-end gap-1">
            <Button variant="ghost" icon="printer" title="Imprimer le reçu" className="h-8 w-8 p-0" onClick={() => openReceipt({ kind: "order", id: o.id })}/>
            {onPay && o.amount_due > 0 && <Button variant="ghost" icon="wallet" title="Enregistrer un paiement" className="h-8 w-8 p-0" onClick={() => onPay(o)}/>}
          </div></td>
        </tr>)}
      </tbody></table></div>
    <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-xs text-slate-400"><span>Affichage {filtered.length ? page * perPage + 1 : 0}–{Math.min((page + 1) * perPage, filtered.length)} sur {filtered.length}</span><div className="flex gap-2"><Button variant="secondary" className="h-8 px-3" disabled={page === 0} onClick={() => setPage(page - 1)}>Précédent</Button><Button variant="secondary" className="h-8 px-3" disabled={page >= maxPage} onClick={() => setPage(page + 1)}>Suivant</Button></div></div>
  </section>;
}
