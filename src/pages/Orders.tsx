import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import NewOrderModal from "../components/NewOrderModal";
import OrdersTable, { type OrderRow } from "../components/OrdersTable";
import ExportButton from "../components/ExportButton";
import PayOrderModal from "../components/PayOrderModal";
import { Button, PageTitle, SearchField, SelectField } from "../components/ui";
import { api, qs } from "../lib/api";
import type { Order } from "../lib/types";
import { useApi, useDebounced } from "../lib/useApi";

export default function OrdersPage() {
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const [period, setPeriod] = useState("");
  const [status, setStatus] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [method, setMethod] = useState("");
  const [service, setService] = useState("");
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<OrderRow | null>(null);
  const q = useDebounced(search.trim());
  const { data, error, loading } = useApi(() => api.get<{ orders: Order[]; services: string[] }>(`/orders${qs({ q, period, limit: 1000 })}`), [q, period]);

  const rows = (data?.orders ?? []).filter(o => (!method || o.payment_method === method) && (!service || o.product_service === service));
  const methods = [...new Set((data?.orders ?? []).map(o => o.payment_method))];

  return <>
    <PageTitle title="Ventes & commandes" subtitle="Suivez vos commandes, règlements et factures." action={<div className="flex gap-2"><ExportButton kind="orders" params={{ q, period, status, method, service }}/><Button icon="plus" onClick={() => setCreating(true)}>Créer une commande</Button></div>}/>
    <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
      <SearchField value={search} onChange={setSearch} placeholder="N° commande, client ou service"/>
      <SelectField value={period} onChange={setPeriod}><option value="">Toutes les dates</option><option value="today">Aujourd'hui</option><option value="week">Cette semaine</option><option value="month">Ce mois</option></SelectField>
      <Button variant="secondary" icon="filter" onClick={() => setAdvanced(!advanced)}>{advanced ? "Masquer les filtres" : "Plus de filtres"}</Button>
    </div>
    {advanced && <div className="mb-4 flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <SelectField value={method} onChange={setMethod}><option value="">Tous les paiements</option>{methods.map(m => <option key={m}>{m}</option>)}</SelectField>
      <SelectField value={service} onChange={setService}><option value="">Tous les services</option>{data?.services.map(s => <option key={s}>{s}</option>)}</SelectField>
      <Button variant="ghost" onClick={() => { setSearch(""); setMethod(""); setService(""); setPeriod(""); }}>Réinitialiser</Button>
    </div>}
    {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    {loading && !data ? <p className="py-10 text-center text-sm text-slate-400">Chargement…</p> : <OrdersTable data={rows} onPay={setPaying} filter={status} onFilter={setStatus}/>}
    {creating && <NewOrderModal onClose={() => setCreating(false)}/>}
    {paying && <PayOrderModal order={paying} onClose={() => setPaying(null)}/>}
  </>;
}
