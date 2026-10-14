import { useState } from "react";
import ExportButton from "../components/ExportButton";
import { Button, EmptyRow, ErrorNote, Field, Icon, Modal, PageTitle, SearchField, SelectField, inputCls, notify, notifyChange } from "../components/ui";
import { api, qs } from "../lib/api";
import { cur, money, num } from "../lib/format";
import type { StockItem } from "../lib/types";
import { useApi, useDebounced } from "../lib/useApi";

const UNITS = ["pcs", "m²", "m", "u.", "kg", "L", "feuilles"];

function ItemModal({ item, onClose }: { item?: StockItem; onClose: () => void }) {
  const [f, setF] = useState({
    ref: item?.ref ?? "", item: item?.item ?? "", unit: item?.unit ?? "pcs",
    stock: item ? "" : "0", price: String(item?.purchase_price ?? ""), threshold: String(item?.alert_threshold ?? 5),
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    if (!f.item.trim() || (!item && !f.ref.trim())) return setError("Référence et désignation sont obligatoires.");
    if (f.price === "" || Number(f.price) < 0) return setError("Indiquez un prix d'achat valide.");
    setBusy(true);
    try {
      if (item) await api.patch(`/stock/${item.id}`, { item: f.item, unit: f.unit, purchase_price: Number(f.price), alert_threshold: Number(f.threshold), ...(f.stock !== "" ? { current_stock: Number(f.stock) } : {}) });
      else await api.post("/stock", { ref: f.ref, item: f.item, unit: f.unit, initial_stock: Number(f.stock || 0), purchase_price: Number(f.price), alert_threshold: Number(f.threshold) });
      notify(item ? "Article mis à jour." : `Article « ${f.item} » créé.`); notifyChange(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); setBusy(false); }
  };
  return <Modal title={item ? `Modifier ${item.ref}` : "Nouvel article"} eyebrow="Stock" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button disabled={busy} onClick={save}>Enregistrer</Button></>}>
    {!item && <Field label="Référence"><input autoFocus value={f.ref} onChange={set("ref")} className={`${inputCls} font-mono`} placeholder="MAT-030"/></Field>}
    <Field label="Désignation"><input value={f.item} onChange={set("item")} className={inputCls} placeholder="Bâche 510g"/></Field>
    <div className="grid grid-cols-2 gap-3">
      <Field label="Unité"><SelectField value={f.unit} onChange={v => setF({ ...f, unit: v })} className={`${inputCls} !h-11 w-full`}>{[...new Set([f.unit, ...UNITS])].map(u => <option key={u}>{u}</option>)}</SelectField></Field>
      <Field label={`Prix d'achat (${cur()})`}><input type="number" min="0" step="any" value={f.price} onChange={set("price")} className={`${inputCls} font-mono`}/></Field>
      <Field label={item ? "Stock actuel (recomptage)" : "Stock initial"} hint={item ? "Laisser vide pour ne pas modifier" : undefined}><input type="number" min="0" step="any" value={f.stock} onChange={set("stock")} className={`${inputCls} font-mono`}/></Field>
      <Field label="Seuil d'alerte"><input type="number" min="0" step="any" value={f.threshold} onChange={set("threshold")} className={`${inputCls} font-mono`}/></Field>
    </div>
    <ErrorNote message={error}/>
  </Modal>;
}

function AdjustModal({ items, onClose }: { items: StockItem[]; onClose: () => void }) {
  const [id, setId] = useState<number | "">(items[0]?.id ?? "");
  const [kind, setKind] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const item = items.find(i => i.id === id);
  const save = async () => {
    const n = Number(amount);
    if (!item || !(n > 0)) return setError("Choisissez un article et une quantité > 0.");
    setBusy(true);
    try {
      await api.patch(`/stock/${item.id}`, { delta: kind === "in" ? n : -n });
      notify(`${item.item} : ${kind === "in" ? "+" : "−"}${num(n)} ${item.unit}.`); notifyChange(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); setBusy(false); }
  };
  return <Modal title="Ajustement de stock" eyebrow="Stock" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button disabled={busy || !item} onClick={save}>Enregistrer</Button></>}>
    <Field label="Article"><SelectField value={String(id)} onChange={v => setId(Number(v))} className={`${inputCls} !h-11 w-full`}>{items.map(i => <option key={i.id} value={i.id}>{i.ref} — {i.item} ({num(i.current_stock)} {i.unit})</option>)}</SelectField></Field>
    <div className="grid grid-cols-2 gap-2">{([["in", "Entrée (réappro.)"], ["out", "Sortie / perte"]] as const).map(([k, label]) => <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-xl border px-3 py-3 text-sm font-semibold ${kind === k ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{label}</button>)}</div>
    <Field label={`Quantité${item ? ` (${item.unit})` : ""}`}><input autoFocus type="number" min="0" step="any" value={amount} onChange={e => setAmount(e.target.value)} className={`${inputCls} font-mono`} placeholder="0"/></Field>
    <ErrorNote message={error}/>
  </Modal>;
}

export default function StockPage() {
  const [query, setQuery] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [modal, setModal] = useState<"adjust" | "new" | StockItem | null>(null);
  const q = useDebounced(query.trim());
  const { data, error, loading } = useApi(() => api.get<{ items: StockItem[]; stats: { low_count: number; total_value: number; items: number } }>(`/stock${qs({ q, low: onlyLow })}`), [q, onlyLow]);
  const { data: all } = useApi(() => api.get<{ items: StockItem[] }>("/stock"));
  const lowCount = data?.stats.low_count ?? 0;

  return <>
    <PageTitle title="Inventaire & stock" subtitle="Surveillez les matières premières et anticipez les ruptures." action={<div className="flex gap-2"><ExportButton kind="stock" params={{ q, low: onlyLow }}/><Button variant="secondary" icon="plus" onClick={() => setModal("new")}>Nouvel article</Button><Button icon="plus" disabled={!all?.items.length} onClick={() => setModal("adjust")}>Ajustement de stock</Button></div>}/>
    {lowCount > 0 && <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><span className="rounded-xl bg-red-100 p-2 text-red-600"><Icon name="bell"/></span><div><p className="text-sm font-bold text-red-800">{lowCount} article{lowCount > 1 ? "s nécessitent" : " nécessite"} votre attention</p><p className="mt-0.5 text-xs text-red-600">Le niveau de stock est inférieur ou égal au seuil d'alerte.</p></div></div><Button variant="secondary" className="border-red-200 text-red-700" onClick={() => setOnlyLow(true)}>Voir les articles</Button></div>}
    <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto]"><SearchField value={query} onChange={setQuery} placeholder="Référence ou désignation"/><SelectField value={onlyLow ? "low" : "all"} onChange={v => setOnlyLow(v === "low")}><option value="all">Tous les articles</option><option value="low">Stock faible</option></SelectField></div>
    {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm">
      <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400"><th className="px-5 py-3">Réf.</th><th className="px-4 py-3">Désignation</th><th className="px-4 py-3">Stock initial</th><th className="px-4 py-3">Mouvements</th><th className="px-4 py-3">Stock actuel</th><th className="px-4 py-3 text-right">Prix achat</th><th className="px-4 py-3 text-right">Valeur</th><th className="px-4 py-3">Seuil</th><th className="px-5 py-3"/></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {loading && !data && <EmptyRow colSpan={9}>Chargement…</EmptyRow>}
        {data && data.items.length === 0 && <EmptyRow colSpan={9}>Aucun article. Créez votre premier article de stock.</EmptyRow>}
        {data?.items.map(s => <tr key={s.id} className="hover:bg-slate-50">
          <td className="px-5 py-4 font-mono text-xs text-blue-600">{s.ref}</td><td className="px-4 py-4 font-semibold text-slate-800">{s.item}</td>
          <td className="px-4 py-4 font-mono text-xs">{num(s.initial_stock)} {s.unit}</td>
          <td className={`px-4 py-4 font-mono text-xs ${s.movement < 0 ? "text-red-500" : s.movement > 0 ? "text-emerald-600" : "text-slate-400"}`}>{s.movement > 0 ? "+" : s.movement < 0 ? "−" : ""}{num(Math.abs(s.movement))} {s.unit}</td>
          <td className="px-4 py-4">{s.low ? <span className="rounded-lg bg-red-50 px-2 py-1 font-mono text-xs font-bold text-red-700">{num(s.current_stock)} {s.unit}</span> : <span className="font-mono text-xs font-bold">{num(s.current_stock)} {s.unit}</span>}</td>
          <td className="px-4 py-4 text-right font-mono text-xs">{money(s.purchase_price)} {cur()}</td><td className="px-4 py-4 text-right font-mono text-xs font-bold">{money(s.value)} {cur()}</td>
          <td className="px-4 py-4 font-mono text-xs text-slate-500">{num(s.alert_threshold)} {s.unit}</td>
          <td className="px-5 py-4"><Button variant="ghost" icon="edit" title="Modifier" className="h-8 w-8 p-0" onClick={() => setModal(s)}/></td>
        </tr>)}
      </tbody></table></div></section>
    {modal === "new" && <ItemModal onClose={() => setModal(null)}/>}
    {modal === "adjust" && all && <AdjustModal items={all.items} onClose={() => setModal(null)}/>}
    {modal && typeof modal === "object" && <ItemModal item={modal} onClose={() => setModal(null)}/>}
  </>;
}
