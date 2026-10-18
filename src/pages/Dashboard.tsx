import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import ExportButton from "../components/ExportButton";
import NewOrderModal from "../components/NewOrderModal";
import OrdersTable, { type OrderRow } from "../components/OrdersTable";
import PayOrderModal from "../components/PayOrderModal";
import { Link } from "react-router-dom";
import { Button, Icon, KpiCard, PageTitle, notify } from "../components/ui";
import { api, qs } from "../lib/api";
import { cur, dh, money } from "../lib/format";
import type { Dashboard as DashboardData, Order } from "../lib/types";
import { useApi } from "../lib/useApi";

const MONTHS = ["Janv", "Fév", "Mars", "Avr", "Mai", "Juin", "Juil", "Août", "Sept", "Oct", "Nov", "Déc"];
const SLICE_COLORS = ["#2563eb", "#10b981", "#f59e0b", "#8b5cf6"];
const SLICE_CLASSES = ["bg-blue-600", "bg-emerald-500", "bg-amber-500", "bg-violet-500"];

function SalesChart({ series }: { series: DashboardData["series"] }) {
  const max = Math.max(1, ...series.flatMap(s => [s.sales, s.expenses]));
  const x = (i: number) => (series.length > 1 ? (i * 616) / (series.length - 1) : 0) + 18;
  const y = (v: number) => 150 - (v / max) * 125;
  const pts = (key: "sales" | "expenses") => series.map((s, i) => `${x(i)},${y(s[key])}`).join(" ");
  return <div className="mt-5 h-64 w-full overflow-hidden">
    <svg viewBox="0 0 650 190" className="h-full w-full" preserveAspectRatio="none" aria-label="Graphique des ventes et dépenses">
      {[25, 65, 105, 145].map(v => <line key={v} x1="10" y1={v} x2="640" y2={v} stroke="#e2e8f0" strokeDasharray="4 5"/>)}
      <defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity=".18"/><stop offset="100%" stopColor="#2563eb" stopOpacity="0"/></linearGradient></defs>
      <polygon points={`${x(0)},160 ${pts("sales")} ${x(series.length - 1)},160`} fill="url(#salesFill)"/>
      <polyline points={pts("sales")} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
      <polyline points={pts("expenses")} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 4"/>
      {series.map((s, i) => <circle key={s.month} cx={x(i)} cy={y(s.sales)} r="3.5" fill="white" stroke="#2563eb" strokeWidth="2"><title>{`${s.month} — ventes ${dh(s.sales)}, dépenses ${dh(s.expenses)}`}</title></circle>)}
      {series.map((s, i) => <text key={s.month} x={x(i)} y="180" textAnchor="middle" fontSize="10" fill="#94a3b8">{MONTHS[Number(s.month.slice(5)) - 1]}</text>)}
    </svg>
  </div>;
}

export default function DashboardPage() {
  const { user, settings } = useAuth();
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<OrderRow | null>(null);
  const { data: d, error, loading } = useApi(() => api.get<DashboardData>("/dashboard"));

  if (loading && !d) return <p className="py-20 text-center text-sm text-slate-400">Chargement…</p>;
  if (!d) return <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error || "Impossible de charger le tableau de bord."}</p>;

  // conic-gradient stops for the donut
  let acc = 0;
  const stops = d.top_items.map((t, i) => { const from = acc; acc += t.share; return `${SLICE_COLORS[i]} ${from}% ${acc}%`; });
  const donut = d.top_items.length ? `conic-gradient(${stops.join(",")}, #e2e8f0 ${acc}% 100%)` : "conic-gradient(#e2e8f0 0 100%)";

  return <>
    <PageTitle title={`Bonjour, ${user?.name.split(" ")[0] ?? ""}`} subtitle="Voici l'activité de votre imprimerie aujourd'hui." action={<div className="flex gap-2"><ExportButton kind="report" label="Rapport Excel"/><Button icon="plus" onClick={() => setCreating(true)}>Nouvelle commande</Button></div>}/>
    {user?.role === "owner" && !settings.logo && <Link to="/settings" className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-900 hover:bg-blue-100"><span><b>Ajoutez le logo de votre imprimerie.</b> Il s'imprimera sur chaque reçu, avec le nom, l'adresse et le téléphone.</span><span className="shrink-0 font-semibold">Ouvrir les paramètres →</span></Link>}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard title="Chiffre d'affaires du jour" value={dh(d.today_revenue)} detail="vs hier" trendValue={d.today_revenue_trend} icon="wallet"/>
      <KpiCard title="Chiffre d'affaires du mois" value={dh(d.monthly_revenue)} detail="vs mois dernier" trendValue={d.monthly_revenue_trend} icon="arrowUp" tone="green"/>
      <KpiCard title="Bénéfice estimé" value={dh(d.net_profit)} detail={`${money(d.monthly_expenses)} ${cur()} de dépenses`} icon="receipt" tone="orange"/>
      <KpiCard title="Total des impayés" value={dh(d.unpaid_debts)} detail={`sur ${d.unpaid_count} facture${d.unpaid_count > 1 ? "s" : ""}`} icon="cash" tone="red"/>
    </div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white px-5 py-4"><div className="flex items-center gap-4"><span className="rounded-xl bg-violet-50 p-2.5 text-violet-600"><Icon name="box"/></span><div><p className="text-xs font-medium uppercase tracking-wider text-slate-400">Valeur du stock</p><p className="mt-1 font-mono text-lg font-bold text-slate-900">{dh(d.stock_value)}</p></div></div></div>
      <div className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white px-5 py-4"><div className="flex items-center gap-4"><span className="rounded-xl bg-cyan-50 p-2.5 text-cyan-600"><Icon name="orders"/></span><div><p className="text-xs font-medium uppercase tracking-wider text-slate-400">Commandes ce mois</p><p className="mt-1 font-mono text-lg font-bold text-slate-900">{d.orders_month} commande{d.orders_month > 1 ? "s" : ""}</p></div></div>{d.orders_month_trend !== null && <span className={`text-xs font-semibold ${d.orders_month_trend >= 0 ? "text-emerald-600" : "text-red-600"}`}>{d.orders_month_trend >= 0 ? "+" : "−"} {Math.abs(d.orders_month_trend).toLocaleString("fr-FR")}%</span>}</div>
    </div>
    <div className="mt-6 grid gap-6 xl:grid-cols-[1.65fr_1fr]">
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-bold text-slate-900">Ventes & dépenses</p><p className="mt-1 text-xs text-slate-400">Évolution sur les 12 derniers mois</p></div><div className="flex items-center gap-4 text-xs font-semibold text-slate-500"><span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-blue-600"/>Ventes</span><span className="flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-amber-500"/>Dépenses</span></div></div><SalesChart series={d.series}/></section>
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm"><div><p className="font-bold text-slate-900">Produits les plus vendus</p><p className="mt-1 text-xs text-slate-400">Répartition du chiffre d'affaires du mois</p></div>
        {d.top_items.length === 0 ? <p className="flex h-64 items-center justify-center text-sm text-slate-400">Aucune vente ce mois-ci.</p> :
        <div className="flex h-64 items-center justify-center gap-8"><div className="relative h-36 w-36 shrink-0 rounded-full" style={{ background: donut }}><div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-white"><span className="font-mono text-xl font-bold text-slate-900">{d.top_items_total >= 1000 ? `${Math.round(d.top_items_total / 1000)}k` : Math.round(d.top_items_total)}</span><span className="text-[10px] text-slate-400">{cur()} total</span></div></div>
          <div className="min-w-0 space-y-3 text-xs">{d.top_items.map((t, i) => <div className="flex items-center gap-2" key={t.name}><i className={`h-2 w-2 shrink-0 rounded-full ${SLICE_CLASSES[i]}`}/><span className="w-24 truncate text-slate-500" title={t.name}>{t.name}</span><b className="font-mono text-slate-800">{t.share}%</b></div>)}</div></div>}
      </section>
    </div>
    <OrdersTable compact data={d.recent_orders} onPay={setPaying}/>
    {creating && <NewOrderModal onClose={() => setCreating(false)}/>}
    {paying && <PayOrderModal order={paying} onClose={() => setPaying(null)}/>}
  </>;
}
