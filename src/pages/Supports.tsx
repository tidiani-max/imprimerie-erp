import { useState } from "react";
import ExportButton from "../components/ExportButton";
import NewOrderModal from "../components/NewOrderModal";
import PayOrderModal from "../components/PayOrderModal";
import type { OrderRow } from "../components/OrdersTable";
import { Badge, Button, EmptyRow, Field, KpiCard, PageTitle, SearchField, SelectField, inputCls } from "../components/ui";
import { useAuth } from "../auth/AuthContext";
import { api, qs } from "../lib/api";
import { cur, dh, fmtShortDay, money, num } from "../lib/format";
import { openReceipt } from "../lib/receipt";
import { SUPPORT_TYPES, type Order } from "../lib/types";
import { useApi, useDebounced } from "../lib/useApi";

type Stats = { orders_month: number; area_m2_month: number; revenue_month: number; unpaid: number };
const STATUSES: [string, string][] = [["Tous", ""], ["Payé", "Paid"], ["Partiel", "Partial"], ["Impayé", "Unpaid"]];
const card = "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm";
const small = `${inputCls.replace("h-11", "h-10")} font-mono`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Own page for bâches, autocollants, perforé, étiquettes, transparents: instant price calculator + the list of these orders. */
export default function SupportsPage() {
  const { settings } = useAuth();
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState("");
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<OrderRow | null>(null);
  // price calculator (a quote: nothing is saved)
  const [cType, setCType] = useState<string>(SUPPORT_TYPES[0]);
  const [cW, setCW] = useState("");
  const [cH, setCH] = useState("");
  const [cQty, setCQty] = useState("1");
  const [cExtra, setCExtra] = useState("");

  const q = useDebounced(search.trim());
  const { data, error, loading } = useApi(() => api.get<{ orders: Order[]; stats: Stats }>(`/orders${qs({ q, period, support: type || "all", limit: 1000 })}`), [q, period, type]);
  const rows = (data?.orders ?? []).filter(o => !status || o.status === status);
  const s = data?.stats;

  const rate = settings.print_rates?.[cType] ?? 0;
  const area = (Number(cW) || 0) * (Number(cH) || 0);
  const unit = round2(area * rate + (Number(cExtra) || 0));
  const quantity = Math.max(0, Number(cQty) || 0);
  const ready = area > 0 && quantity > 0;

  return <>
    <PageTitle title="Bâches & autocollants" subtitle="Calcul automatique : surface = largeur × hauteur, puis montant = surface × tarif (hors frais supplémentaires)."
      action={<div className="flex gap-2"><ExportButton kind="orders" params={{ q, period, status, support: type || "all" }}/><Button icon="plus" onClick={() => setCreating(true)}>Nouvelle commande</Button></div>}/>

    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard title="Commandes ce mois" value={String(s?.orders_month ?? 0)} detail="bâches, autocollants, étiquettes…" icon="banner"/>
      <KpiCard title="Surface ce mois" value={`${num(s?.area_m2_month ?? 0)} m²`} detail="toutes pièces comprises" icon="box" tone="orange"/>
      <KpiCard title="Chiffre d'affaires ce mois" value={dh(s?.revenue_month)} detail="supports uniquement" icon="wallet" tone="green"/>
      <KpiCard title="Reste à encaisser" value={dh(s?.unpaid)} detail="sur ces commandes" icon="receipt" tone="red"/>
    </div>

    <section className={`${card} mb-6`} data-testid="calculator">
      <p className="text-lg font-bold text-slate-950">Calculateur de prix</p>
      <p className="mt-1 text-sm text-slate-500">Donnez un prix tout de suite à un client. Rien n'est enregistré tant que vous ne créez pas la commande.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Type de support"><SelectField value={cType} onChange={setCType} className="mt-2 w-full">{SUPPORT_TYPES.map(t => <option key={t}>{t}</option>)}</SelectField></Field>
        <Field label="Largeur (cm)"><input type="number" min="0" step="any" value={cW} onChange={e => setCW(e.target.value)} className={small} placeholder="ex. 200"/></Field>
        <Field label="Hauteur (cm)"><input type="number" min="0" step="any" value={cH} onChange={e => setCH(e.target.value)} className={small} placeholder="ex. 100"/></Field>
        <Field label="Quantité"><input type="number" min="1" step="any" value={cQty} onChange={e => setCQty(e.target.value)} className={small}/></Field>
        <Field label={`Frais suppl. par pièce (${cur()})`}><input type="number" min="0" step="any" value={cExtra} onChange={e => setCExtra(e.target.value)} className={small} placeholder="0"/></Field>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Surface", `${num(area)} cm²`, `${num(area / 10000)} m²`],
          ["Tarif", `${money(rate)} ${cur()}/cm²`, cType],
          ["Montant (surface × tarif)", dh(area * rate), "par pièce"],
          ["Prix unitaire", dh(unit), (Number(cExtra) || 0) > 0 ? "frais inclus" : "sans frais suppl."],
          ["Total", dh(ready ? round2(unit * quantity) : 0), `${num(quantity)} pièce${quantity > 1 ? "s" : ""}`],
        ].map(([label, value, note], i) => <div key={label} className={`rounded-xl p-4 ${i === 4 ? "bg-slate-900 text-white" : "bg-slate-50"}`} data-testid={`calc-${i}`}>
          <p className={`text-[11px] font-semibold uppercase tracking-wider ${i === 4 ? "text-slate-400" : "text-slate-400"}`}>{label}</p>
          <p className="mt-1.5 font-mono text-lg font-bold">{value}</p><p className={`text-xs ${i === 4 ? "text-slate-400" : "text-slate-400"}`}>{note}</p>
        </div>)}
      </div>
      <div className="mt-4"><Button variant="secondary" icon="plus" disabled={!ready} onClick={() => setCreating(true)}>Créer la commande avec ces valeurs</Button></div>
    </section>

    <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
      <SearchField value={search} onChange={setSearch} placeholder="N° commande ou client"/>
      <SelectField value={type} onChange={setType}><option value="">Tous les supports</option>{SUPPORT_TYPES.map(t => <option key={t}>{t}</option>)}</SelectField>
      <SelectField value={period} onChange={setPeriod}><option value="">Toutes les dates</option><option value="today">Aujourd'hui</option><option value="week">Cette semaine</option><option value="month">Ce mois</option></SelectField>
    </div>
    {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pb-3 pt-5">
        <div><p className="text-lg font-bold text-slate-950">Commandes de supports</p><p className="text-xs text-slate-400">{rows.length} résultat{rows.length > 1 ? "s" : ""}</p></div>
        <div className="inline-flex rounded-xl bg-slate-100 p-1">{STATUSES.map(([label, value]) => <button key={label} onClick={() => setStatus(value)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${status === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"}`}>{label}</button>)}</div>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-sm" data-testid="supports-table">
        <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400">
          <th className="px-5 py-3">Commande</th><th className="px-4 py-3">Client</th><th className="px-4 py-3">Type de support</th>
          <th className="px-4 py-3 text-right">Largeur (cm)</th><th className="px-4 py-3 text-right">Hauteur (cm)</th><th className="px-4 py-3 text-right">Surface (m²)</th>
          <th className="px-4 py-3 text-right">Qté</th><th className="px-4 py-3 text-right">Prix unitaire</th><th className="px-4 py-3 text-right">Total</th><th className="px-4 py-3 text-right">Reste</th>
          <th className="px-4 py-3">Statut</th><th className="px-5 py-3 text-right">Actions</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {loading && !data && <EmptyRow colSpan={12}>Chargement…</EmptyRow>}
          {data && rows.length === 0 && <EmptyRow colSpan={12}>Aucune commande de bâche ou d'autocollant. Cliquez sur « Nouvelle commande ».</EmptyRow>}
          {rows.map(o => <tr key={o.id} className="hover:bg-slate-50">
            <td className="px-5 py-4"><span className="font-mono text-xs font-bold text-blue-600">{o.order_number}</span><span className="block text-xs text-slate-400">{fmtShortDay(o.order_date)}</span></td>
            <td className="px-4 py-4 font-semibold text-slate-800">{o.client_name ?? "—"}</td>
            <td className="px-4 py-4">{o.support_type}</td>
            <td className="px-4 py-4 text-right font-mono text-xs">{num(o.width_cm ?? 0)}</td><td className="px-4 py-4 text-right font-mono text-xs">{num(o.height_cm ?? 0)}</td>
            <td className="px-4 py-4 text-right font-mono text-xs">{num(((o.width_cm ?? 0) * (o.height_cm ?? 0)) / 10000)}</td>
            <td className="px-4 py-4 text-right font-mono text-xs">{num(o.quantity)}</td><td className="px-4 py-4 text-right font-mono text-xs">{dh(o.unit_price)}</td>
            <td className="px-4 py-4 text-right font-mono text-xs font-bold">{dh(o.total_amount)}</td>
            <td className={`px-4 py-4 text-right font-mono text-xs font-bold ${o.amount_due > 0 ? "text-red-600" : "text-slate-400"}`}>{dh(o.amount_due)}</td>
            <td className="px-4 py-4"><Badge status={o.status}/></td>
            <td className="px-5 py-4"><div className="flex justify-end gap-1">
              <Button variant="ghost" icon="printer" title="Voir / imprimer le reçu" className="h-8 w-8 p-0 text-slate-400" onClick={() => openReceipt({ kind: "order", id: o.id })}/>
              {o.amount_due > 0 && <Button variant="ghost" icon="wallet" title="Enregistrer un paiement" className="h-8 w-8 p-0 text-slate-400" onClick={() => setPaying(o)}/>}
            </div></td>
          </tr>)}
        </tbody></table></div>
    </section>
    {creating && <NewOrderModal supportOnly preset={{ supportType: cType, width: cW, height: cH, qty: quantity || 1, extra: cExtra }} onClose={() => setCreating(false)}/>}
    {paying && <PayOrderModal order={paying} onClose={() => setPaying(null)}/>}
  </>;
}
