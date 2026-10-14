import { useState } from "react";
import ExportButton from "../components/ExportButton";
import { Button, EmptyRow, ErrorNote, Field, KpiCard, Modal, PageTitle, SearchField, SelectField, inputCls, notify, notifyChange } from "../components/ui";
import { api, qs } from "../lib/api";
import { cur, dh, fmtShortDay, money, todayStr } from "../lib/format";
import { PAYMENT_METHODS, type Expense } from "../lib/types";
import { useApi, useDebounced } from "../lib/useApi";

const BASE_CATEGORIES = ["Encre", "Bâche", "Vinyle", "Papier", "Électricité", "Salaire", "Transport", "Entretien", "Loyer"];

function ExpenseModal({ categories, onClose }: { categories: string[]; onClose: () => void }) {
  const options = [...new Set([...BASE_CATEGORIES, ...categories])];
  const [f, setF] = useState({ category: options[0], custom: "", supplier: "", amount: "", method: "Espèces", date: todayStr(), note: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const category = f.category === "__other" ? f.custom.trim() : f.category;
    if (!category || !(Number(f.amount) > 0)) return setError("Catégorie et montant (> 0) sont obligatoires.");
    setBusy(true);
    try {
      await api.post("/expenses", { category, supplier: f.supplier, amount: Number(f.amount), payment_method: f.method, expense_date: f.date, observation: f.note });
      notify("Dépense enregistrée (sortie de caisse ajoutée)."); notifyChange(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); setBusy(false); }
  };
  return <Modal title="Enregistrer une dépense" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button disabled={busy} onClick={save}>Enregistrer</Button></>}>
    <Field label="Catégorie"><SelectField value={f.category} onChange={v => setF({ ...f, category: v })} className={`${inputCls} !h-11 w-full`}>{options.map(c => <option key={c}>{c}</option>)}<option value="__other">Autre…</option></SelectField></Field>
    {f.category === "__other" && <Field label="Nom de la catégorie"><input autoFocus value={f.custom} onChange={e => setF({ ...f, custom: e.target.value })} className={inputCls}/></Field>}
    <Field label="Fournisseur"><input value={f.supplier} onChange={e => setF({ ...f, supplier: e.target.value })} className={inputCls} placeholder="Optionnel"/></Field>
    <div className="grid grid-cols-2 gap-3">
      <Field label={`Montant (${cur()})`}><input autoFocus={f.category !== "__other"} type="number" min="0" step="any" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} className={`${inputCls} font-mono`} placeholder="0,00"/></Field>
      <Field label="Date"><input type="date" max={todayStr()} value={f.date} onChange={e => setF({ ...f, date: e.target.value })} className={inputCls}/></Field>
    </div>
    <Field label="Mode de règlement"><SelectField value={f.method} onChange={v => setF({ ...f, method: v })} className={`${inputCls} !h-11 w-full`}>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</SelectField></Field>
    <Field label="Note / observation"><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} className={inputCls} placeholder="Optionnel"/></Field>
    <ErrorNote message={error}/>
  </Modal>;
}

export default function ExpensesPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [adding, setAdding] = useState(false);
  const q = useDebounced(query.trim());
  const { data, error, loading } = useApi(() => api.get<{ expenses: Expense[]; categories: string[]; stats: { month_total: number; prev_month_total: number; month_count: number; top_category: { category: string; amount: number } | null } }>(`/expenses${qs({ q, category })}`), [q, category]);
  const s = data?.stats;
  const trend = s && s.prev_month_total > 0 ? Math.round(((s.month_total - s.prev_month_total) / s.prev_month_total) * 1000) / 10 : null;

  return <>
    <PageTitle title="Dépenses" subtitle="Enregistrez et analysez toutes les charges de l'imprimerie." action={<div className="flex gap-2"><ExportButton kind="expenses" params={{ q, category }}/><Button icon="plus" onClick={() => setAdding(true)}>Enregistrer une dépense</Button></div>}/>
    <div className="mb-6 grid gap-4 sm:grid-cols-3">
      <KpiCard title="Dépenses ce mois" value={dh(s?.month_total)} detail="vs mois dernier" trendValue={trend} goodWhen="down" icon="expenses" tone="orange"/>
      <KpiCard title="Première catégorie" value={s?.top_category ? dh(s.top_category.amount) : "—"} detail={s?.top_category?.category ?? "Aucune dépense ce mois"} icon="box" tone="blue"/>
      <KpiCard title="Nombre de dépenses" value={String(s?.month_count ?? 0)} detail="ce mois" icon="receipt" tone="red"/>
    </div>
    <div className="mb-4 flex flex-col gap-3 sm:flex-row"><div className="flex-1"><SearchField value={query} onChange={setQuery} placeholder="Fournisseur ou observation"/></div>
      <SelectField value={category} onChange={setCategory}><option value="">Toutes les catégories</option>{data?.categories.map(c => <option key={c}>{c}</option>)}</SelectField></div>
    {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm">
      <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400"><th className="px-5 py-3">Date</th><th className="px-4 py-3">Fournisseur</th><th className="px-4 py-3">Catégorie</th><th className="px-4 py-3 text-right">Montant</th><th className="px-4 py-3">Règlement</th><th className="px-5 py-3">Note</th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {loading && !data && <EmptyRow colSpan={6}>Chargement…</EmptyRow>}
        {data && data.expenses.length === 0 && <EmptyRow colSpan={6}>Aucune dépense enregistrée.</EmptyRow>}
        {data?.expenses.map(r => <tr key={r.id} className="hover:bg-slate-50">
          <td className="px-5 py-4 text-slate-500">{fmtShortDay(r.expense_date)}</td><td className="px-4 py-4 font-semibold">{r.supplier ?? "—"}</td>
          <td className="px-4 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{r.category}</span></td>
          <td className="px-4 py-4 text-right font-mono text-xs font-bold text-red-600">− {money(r.amount)} {cur()}</td><td className="px-4 py-4 text-slate-500">{r.payment_method}</td>
          <td className="max-w-[220px] truncate px-5 py-4 text-xs text-slate-400" title={r.observation ?? ""}>{r.observation ?? ""}</td>
        </tr>)}
      </tbody></table></div></section>
    {adding && <ExpenseModal categories={data?.categories ?? []} onClose={() => setAdding(false)}/>}
  </>;
}
