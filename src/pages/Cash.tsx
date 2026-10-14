import { useState } from "react";
import ExportButton from "../components/ExportButton";
import { Button, EmptyRow, ErrorNote, Field, Icon, Modal, PageTitle, SearchField, SelectField, inputCls, notify, notifyChange } from "../components/ui";
import { api, qs } from "../lib/api";
import { cur, dh, fmtDateTime, money } from "../lib/format";
import { PAYMENT_METHODS, type CashEntry } from "../lib/types";
import { useApi, useDebounced } from "../lib/useApi";

function CashModal({ type, onClose }: { type: "IN" | "OUT"; onClose: () => void }) {
  const [f, setF] = useState({ description: "", amount: "", method: "Espèces" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.description.trim() || !(Number(f.amount) > 0)) return setError("Libellé et montant (> 0) sont obligatoires.");
    setBusy(true);
    try {
      await api.post("/cash/transaction", { type, amount: Number(f.amount), description: f.description, payment_method: f.method });
      notify(`${type === "IN" ? "Encaissement" : "Décaissement"} de ${dh(Number(f.amount))} enregistré.`); notifyChange(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); setBusy(false); }
  };
  return <Modal title={type === "IN" ? "Encaissement" : "Décaissement"} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button disabled={busy} onClick={save}>Enregistrer</Button></>}>
    <Field label="Libellé"><input autoFocus value={f.description} onChange={e => setF({ ...f, description: e.target.value })} className={inputCls} placeholder={type === "IN" ? "Vente comptoir…" : "Achat consommables…"}/></Field>
    <Field label={`Montant (${cur()})`}><input type="number" min="0" step="any" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} className={`${inputCls} font-mono`} placeholder="0,00"/></Field>
    <Field label="Mode de règlement"><SelectField value={f.method} onChange={v => setF({ ...f, method: v })} className={`${inputCls} !h-11 w-full`}>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</SelectField></Field>
    <ErrorNote message={error}/>
  </Modal>;
}

export default function CashPage() {
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("today");
  const [modal, setModal] = useState<"IN" | "OUT" | null>(null);
  const q = useDebounced(query.trim());
  const { data, error, loading } = useApi(() => api.get<{ entries: CashEntry[]; balance: number; today: { in: number; out: number; net: number } }>(`/cash${qs({ q, period })}`), [q, period]);
  const net = data?.today.net ?? 0;

  return <>
    <PageTitle title="Caisse" subtitle="Visualisez chaque entrée, sortie et le solde en temps réel." action={<div className="flex gap-2"><ExportButton kind="cash" params={{ q, period }}/><Button variant="secondary" icon="arrowDown" onClick={() => setModal("OUT")}>Décaissement</Button><Button icon="arrowUp" onClick={() => setModal("IN")}>Encaissement</Button></div>}/>
    <div className="mb-6 overflow-hidden rounded-2xl bg-slate-950 p-6 text-white shadow-xl shadow-slate-900/10"><div className="flex items-start justify-between"><div><p className="text-sm font-medium text-slate-400">Solde de caisse actuel</p><p className="mt-2 font-mono text-3xl font-bold">{dh(data?.balance)}</p><p className={`mt-3 text-xs ${net >= 0 ? "text-emerald-400" : "text-red-400"}`}>{net >= 0 ? "+" : "−"} {dh(Math.abs(net))} aujourd'hui</p></div><span className="rounded-2xl bg-white/10 p-3 text-blue-400"><Icon name="cash" className="h-7 w-7"/></span></div></div>
    <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]"><SearchField value={query} onChange={setQuery} placeholder="Rechercher un libellé"/><SelectField value={period} onChange={setPeriod}><option value="today">Aujourd'hui</option><option value="week">Cette semaine</option><option value="month">Ce mois</option><option value="all">Tout</option></SelectField></div>
    {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[750px] text-left text-sm">
      <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400"><th className="px-5 py-3">Date</th><th className="px-4 py-3">Libellé</th><th className="px-4 py-3 text-right">Entrée</th><th className="px-4 py-3 text-right">Sortie</th><th className="px-4 py-3 text-right">Solde</th><th className="px-5 py-3">Type</th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {loading && !data && <EmptyRow colSpan={6}>Chargement…</EmptyRow>}
        {data && data.entries.length === 0 && <EmptyRow colSpan={6}>Aucun mouvement sur cette période.</EmptyRow>}
        {data?.entries.map(r => <tr key={r.id} className="hover:bg-slate-50">
          <td className="px-5 py-4 text-xs text-slate-500">{fmtDateTime(r.created_at)}</td><td className="px-4 py-4 font-semibold">{r.description}</td>
          <td className="px-4 py-4 text-right font-mono text-xs font-bold text-emerald-600">{r.type === "IN" ? `+ ${money(r.amount)} ${cur()}` : "—"}</td>
          <td className="px-4 py-4 text-right font-mono text-xs font-bold text-red-600">{r.type === "OUT" ? `− ${money(r.amount)} ${cur()}` : "—"}</td>
          <td className="px-4 py-4 text-right font-mono text-xs font-bold">{dh(r.running_balance)}</td><td className="px-5 py-4 text-slate-500">{r.payment_method}</td>
        </tr>)}
      </tbody></table></div></section>
    {modal && <CashModal type={modal} onClose={() => setModal(null)}/>}
  </>;
}
