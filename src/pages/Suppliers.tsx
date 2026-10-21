import { useState } from "react";
import ExportButton from "../components/ExportButton";
import { Badge, Button, Drawer, EmptyRow, ErrorNote, Field, KpiCard, Modal, PageTitle, SearchField, SelectField, inputCls, notify, notifyChange } from "../components/ui";
import { api, qs } from "../lib/api";
import { cur, dh, fmtDay, fmtShortDay, money, num, todayStr } from "../lib/format";
import { PAYMENT_METHODS, SUPPLIER_KINDS, type Supplier } from "../lib/types";
import { useApi, useDebounced } from "../lib/useApi";

type Bill = { id: number; description: string; reference: string | null; amount: number; amount_paid: number; amount_due: number; bill_date: string; due_date: string | null; is_opening: boolean; overdue: boolean; status: string };
type Detail = {
  supplier: Supplier; bills: Bill[];
  payments: { id: number; amount: number; payment_method: string; paid_at: string; description: string }[];
  opening: { total: number; paid: number; due: number; date: string } | null;
};

const DEBT_HINT = "Ce que vous deviez déjà avant d'utiliser l'application. C'est une dette : elle n'est pas comptée comme une dépense de ce mois et ne touche pas la caisse. Quand vous la payez, l'argent sort de la caisse.";
const kindLabel = (k: string) => SUPPLIER_KINDS.find(x => x.value === k)?.label.split(" (")[0] ?? k;

function SupplierModal({ supplier, opening, onClose }: { supplier?: Supplier; opening?: Detail["opening"]; onClose: () => void }) {
  const editing = !!supplier;
  const [f, setF] = useState({ name: supplier?.name ?? "", kind: supplier?.kind ?? "Fournisseur", phone: supplier?.phone ?? "", notes: supplier?.notes ?? "", debt: opening ? String(opening.total) : "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim()) return setError("Le nom est obligatoire.");
    const debt = Number(f.debt) || 0;
    if (debt < 0) return setError("La dette ne peut pas être négative.");
    if (opening && debt < opening.paid) return setError(`La dette ne peut pas être inférieure à ce qui a déjà été payé dessus (${money(opening.paid)} ${cur()}).`);
    setBusy(true);
    try {
      const body = { name: f.name, kind: f.kind, phone: f.phone, notes: f.notes, opening_debt: debt };
      if (editing) await api.patch(`/suppliers/${supplier!.id}`, body); else await api.post("/suppliers", body);
      notify(editing ? `« ${f.name} » modifié.` : `« ${f.name} » ajouté.`); notifyChange(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); setBusy(false); }
  };
  return <Modal title={editing ? "Modifier le fournisseur" : "Ajouter un fournisseur"} eyebrow={editing ? supplier!.name : "Qui vous devez payer"} onClose={onClose}
    footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button disabled={busy} onClick={save}>Enregistrer</Button></>}>
    <Field label="Nom"><input autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className={inputCls} placeholder="Boutique, atelier, personne…"/></Field>
    <Field label="Type"><SelectField value={f.kind} onChange={v => setF({ ...f, kind: v as Supplier["kind"] })} className={`${inputCls} !h-11 w-full`}>{SUPPLIER_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</SelectField></Field>
    <Field label="Téléphone (optionnel)"><input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} className={inputCls} placeholder="+223 …"/></Field>
    <Field label="Notes (optionnel)"><input value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} className={inputCls} placeholder="ex. livre le jeudi"/></Field>
    <Field label={`${editing ? "Dette antérieure" : "Dette actuelle (optionnel)"} (${cur()})`} hint={opening && opening.paid > 0 ? `Déjà payé dessus : ${money(opening.paid)} ${cur()}. ${DEBT_HINT}` : DEBT_HINT}>
      <input type="number" min="0" step="any" value={f.debt} onChange={e => setF({ ...f, debt: e.target.value })} className={`${inputCls} font-mono`} placeholder="0"/>
    </Field>
    <ErrorNote message={error}/>
  </Modal>;
}

function BillModal({ supplier, bill, onClose }: { supplier: Supplier; bill?: Bill; onClose: () => void }) {
  const editing = !!bill;
  const [f, setF] = useState({ description: bill?.description ?? "", reference: bill?.reference ?? "", amount: bill ? String(bill.amount) : "", paid: "", method: "Espèces", date: bill?.bill_date?.slice(0, 10) ?? todayStr(), due: bill?.due_date?.slice(0, 10) ?? "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const amount = Number(f.amount) || 0, paid = Number(f.paid) || 0;
  const save = async () => {
    if (!f.description.trim()) return setError("Décrivez l'achat ou le travail.");
    if (!(amount > 0)) return setError("Entrez un montant supérieur à 0.");
    if (!editing && (paid < 0 || paid > amount)) return setError("Le montant déjà payé doit être entre 0 et le montant.");
    setBusy(true);
    try {
      const common = { description: f.description, reference: f.reference, amount, bill_date: f.date, due_date: f.due || null };
      if (editing) await api.patch(`/suppliers/${supplier.id}/bills/${bill!.id}`, common);
      else await api.post(`/suppliers/${supplier.id}/bills`, { ...common, amount_paid: paid, payment_method: f.method });
      notify(editing ? "Ligne modifiée." : `${dh(amount)} à payer à ${supplier.name}.`); notifyChange(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); setBusy(false); }
  };
  return <Modal title={editing ? "Modifier la ligne" : "Achat ou travail à payer"} eyebrow={supplier.name} onClose={onClose}
    footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button disabled={busy} onClick={save}>Enregistrer</Button></>}>
    <Field label="Qu'est-ce que c'est ?" hint="Produits pris dans la boutique, partie d'un travail confiée à un autre atelier…"><input autoFocus value={f.description} onChange={e => setF({ ...f, description: e.target.value })} className={inputCls} placeholder="ex. Impression bâche 3 m"/></Field>
    <Field label="Commande ou référence (optionnel)"><input value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} className={inputCls} placeholder="ex. CMD-1048 ou bon n° 12"/></Field>
    <div className="grid grid-cols-2 gap-3">
      <Field label={`Montant à payer (${cur()})`}><input type="number" min="0" step="any" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} className={`${inputCls} font-mono`}/></Field>
      {!editing && <Field label={`Déjà payé (${cur()})`}><input type="number" min="0" step="any" value={f.paid} onChange={e => setF({ ...f, paid: e.target.value })} className={`${inputCls} font-mono`} placeholder="0"/></Field>}
    </div>
    {!editing && paid > 0 && <Field label="Mode de paiement"><SelectField value={f.method} onChange={v => setF({ ...f, method: v })} className={`${inputCls} !h-11 w-full`}>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</SelectField></Field>}
    <div className="grid grid-cols-2 gap-3">
      <Field label="Date"><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} className={inputCls}/></Field>
      <Field label="À payer avant (optionnel)"><input type="date" value={f.due} onChange={e => setF({ ...f, due: e.target.value })} className={inputCls}/></Field>
    </div>
    {amount > 0 && <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">Il restera <b className="font-mono text-slate-900">{dh(Math.max(0, amount - (editing ? bill!.amount_paid : paid)))}</b> à payer.{!editing && paid > 0 ? " L'argent déjà payé sort de la caisse." : ""} Cette ligne compte dans vos dépenses du mois.</p>}
    <ErrorNote message={error}/>
  </Modal>;
}

function PayModal({ supplier, debt, onClose }: { supplier: Supplier; debt: number; onClose: () => void }) {
  const [amount, setAmount] = useState(debt);
  const [method, setMethod] = useState("Espèces");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ left: number } | null>(null);
  const save = async () => {
    if (!(amount > 0) || amount > debt) return setError(`Entrez un montant entre 0,01 et ${debt}.`);
    setBusy(true);
    try {
      const res = await api.post<{ supplier: Supplier }>(`/suppliers/${supplier.id}/payments`, { amount, payment_method: method });
      notify(`Paiement de ${dh(amount)} à ${supplier.name} enregistré.`); notifyChange(); setDone({ left: res.supplier.debt });
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); setBusy(false); }
  };
  if (done) return <Modal title="Paiement enregistré" eyebrow={supplier.name} onClose={onClose} footer={<Button onClick={onClose}>Fermer</Button>}>
    <div className="rounded-xl bg-emerald-50 p-4"><p className="text-xs font-semibold uppercase text-emerald-700">Payé</p><p className="mt-2 font-mono text-2xl font-bold text-emerald-700">{dh(amount)}</p></div>
    <p className="text-sm text-slate-600">L'argent est sorti de la caisse. Il vous reste à payer à {supplier.name} : <b className="font-mono">{dh(done.left)}</b></p>
  </Modal>;
  return <Modal title="Payer ce fournisseur" eyebrow={supplier.name} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button disabled={busy} onClick={save}>Enregistrer</Button></>}>
    <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase text-slate-400">Vous devez</p><p className="mt-2 font-mono text-2xl font-bold text-red-600">{dh(debt)}</p></div>
    <Field label={`Montant payé (${cur()})`} hint="Appliqué aux dettes les plus anciennes d'abord. L'argent sort de la caisse."><input autoFocus type="number" min="0" step="any" value={amount} onChange={e => setAmount(Number(e.target.value))} className={`${inputCls} font-mono`}/></Field>
    <Field label="Mode de paiement"><SelectField value={method} onChange={setMethod} className={`${inputCls} !h-11 w-full`}>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</SelectField></Field>
    <ErrorNote message={error}/>
  </Modal>;
}

function SupplierDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, loading } = useApi(() => api.get<Detail>(`/suppliers/${id}`), [id]);
  const [modal, setModal] = useState<null | "edit" | "bill" | "pay">(null);
  const [editBill, setEditBill] = useState<Bill | null>(null);
  const s = data?.supplier;
  const remove = async (b: Bill) => {
    if (!window.confirm(`Supprimer « ${b.description} » (${dh(b.amount)}) ?\n\nÀ faire seulement si cette ligne a été saisie par erreur.`)) return;
    try { await api.delete(`/suppliers/${id}/bills/${b.id}`); notify("Ligne supprimée."); notifyChange(); }
    catch (e) { notify(e instanceof Error ? e.message : "Erreur"); }
  };
  return <Drawer title={s?.name ?? "…"} onClose={onClose}>
    {loading && !data && <p className="text-sm text-slate-400">Chargement…</p>}
    {data && s && <>
      <div className="-mt-4 mb-4 flex items-start justify-between gap-3">
        <p className="text-sm text-slate-500">{[kindLabel(s.kind), s.phone, s.notes].filter(Boolean).join(" · ")}</p>
        <Button variant="secondary" icon="edit" className="shrink-0" onClick={() => setModal("edit")}>Modifier</Button>
      </div>
      <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase text-slate-400">Vous devez</p>
        <p className={`mt-2 font-mono text-2xl font-bold ${s.debt > 0 ? "text-red-600" : "text-emerald-600"}`} data-testid="supplier-debt">{dh(s.debt)}</p>
        {data.opening && <p className="mt-2 text-xs text-slate-500">dont dette antérieure : <b className="font-mono">{dh(data.opening.due)}</b>{data.opening.paid > 0 && <> (déjà payé {dh(data.opening.paid)} sur {dh(data.opening.total)})</>}</p>}
      </div>
      <div className="mt-6"><p className="font-bold text-slate-900">Achats et travaux</p>
        {data.bills.length === 0 && <p className="mt-3 text-sm text-slate-400">Aucune ligne pour le moment.</p>}
        {data.bills.map(b => <div key={b.id} className="mt-3 border-b border-slate-100 pb-3">
          <div className="flex items-start justify-between gap-3"><div>
            <p className="text-sm font-semibold">{b.is_opening ? "Dette antérieure" : b.description}{b.reference && <span className="font-normal text-slate-400"> · {b.reference}</span>}</p>
            <p className={`text-xs ${b.overdue ? "font-semibold text-red-600" : "text-slate-400"}`}>{fmtShortDay(b.bill_date)}{b.due_date ? ` · à payer avant le ${fmtDay(b.due_date)}${b.overdue ? " · en retard" : ""}` : ""}</p>
          </div><div className="text-right"><p className="font-mono text-xs font-bold">{dh(b.amount)}</p>{b.amount_due > 0 && <p className="font-mono text-xs font-bold text-red-600">reste {dh(b.amount_due)}</p>}</div></div>
          <div className="mt-2 flex items-center justify-between"><Badge status={b.status}/>
            {!b.is_opening && <div className="flex gap-1">
              <Button variant="ghost" icon="edit" title="Modifier la ligne" className="h-8 w-8 p-0 text-slate-400" onClick={() => setEditBill(b)}/>
              {b.amount_paid === 0 && <Button variant="ghost" icon="trash" title="Supprimer la ligne" className="h-8 w-8 p-0 text-slate-400" onClick={() => remove(b)}/>}
            </div>}</div>
        </div>)}
      </div>
      {data.payments.length > 0 && <div className="mt-6"><p className="font-bold text-slate-900">Paiements récents</p>
        {data.payments.slice(0, 8).map(p => <div key={p.id} className="mt-3 flex items-center justify-between border-b border-slate-100 pb-3"><div><p className="text-sm font-semibold">{p.description}</p><p className="text-xs text-slate-400">{p.paid_at} · {p.payment_method}</p></div><span className="font-mono text-xs font-bold text-emerald-700">{dh(p.amount)}</span></div>)}
      </div>}
      <div className="mt-6 grid gap-2">
        <Button variant="secondary" icon="plus" onClick={() => setModal("bill")}>Ajouter un achat ou travail à payer</Button>
        <Button disabled={s.debt <= 0} onClick={() => setModal("pay")}>Enregistrer un paiement</Button>
      </div>
      {modal === "edit" && <SupplierModal supplier={s} opening={data.opening} onClose={() => setModal(null)}/>}
      {modal === "bill" && <BillModal supplier={s} onClose={() => setModal(null)}/>}
      {modal === "pay" && <PayModal supplier={s} debt={s.debt} onClose={() => setModal(null)}/>}
      {editBill && <BillModal supplier={s} bill={editBill} onClose={() => setEditBill(null)}/>}
    </>}
  </Drawer>;
}

export default function SuppliersPage() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const q = useDebounced(query.trim());
  const { data, error, loading } = useApi(() => api.get<{ suppliers: Supplier[]; stats: { count: number; total_debt: number; unpaid_bills: number; paid_month: number } }>(`/suppliers${qs({ q })}`), [q]);
  const s = data?.stats;
  return <>
    <PageTitle title="Fournisseurs & dettes" subtitle="Ce que l'imprimerie doit aux boutiques, aux autres ateliers (travail confié) et à toute personne ou société."
      action={<div className="flex gap-2"><ExportButton kind="suppliers" params={{ q }}/><Button icon="plus" onClick={() => setAdding(true)}>Ajouter un fournisseur</Button></div>}/>
    <div className="mb-6 grid gap-4 sm:grid-cols-3">
      <KpiCard title="Fournisseurs" value={String(s?.count ?? 0)} detail="boutiques, ateliers, autres" icon="store"/>
      <KpiCard title="Vous devez" value={dh(s?.total_debt)} detail={`${s?.unpaid_bills ?? 0} ligne${(s?.unpaid_bills ?? 0) > 1 ? "s" : ""} à payer`} icon="receipt" tone="red"/>
      <KpiCard title="Payé ce mois" value={dh(s?.paid_month)} detail="sorti de la caisse" icon="wallet" tone="green"/>
    </div>
    <div className="mb-4 max-w-md"><SearchField value={query} onChange={setQuery} placeholder="Rechercher un fournisseur ou téléphone"/></div>
    {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm" data-testid="suppliers-table">
      <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400"><th className="px-5 py-3">Fournisseur</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Téléphone</th><th className="px-4 py-3 text-right">Total facturé</th><th className="px-4 py-3 text-right">Déjà payé</th><th className="px-4 py-3 text-right">Reste à payer</th><th className="px-4 py-3">Échéance</th><th className="px-5 py-3">Statut</th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {loading && !data && <EmptyRow colSpan={8}>Chargement…</EmptyRow>}
        {data && data.suppliers.length === 0 && <EmptyRow colSpan={8}>Aucun fournisseur. Ajoutez une boutique, un atelier ou une personne à qui vous devez de l'argent.</EmptyRow>}
        {data?.suppliers.map(x => <tr key={x.id} onClick={() => setSelected(x.id)} className="cursor-pointer hover:bg-slate-50">
          <td className="px-5 py-4 font-semibold text-slate-800">{x.name}</td><td className="px-4 py-4 text-slate-500">{kindLabel(x.kind)}</td><td className="px-4 py-4 text-slate-500">{x.phone ?? "—"}</td>
          <td className="px-4 py-4 text-right font-mono text-xs">{dh(x.total_billed)}</td><td className="px-4 py-4 text-right font-mono text-xs">{dh(x.total_paid)}</td>
          <td className={`px-4 py-4 text-right font-mono text-xs font-bold ${x.debt > 0 ? "text-red-600" : "text-slate-400"}`}>{dh(x.debt)}</td>
          <td className="px-4 py-4 text-xs text-slate-500">{x.debt > 0 ? fmtDay(x.next_due) : "—"}</td><td className="px-5 py-4"><Badge status={x.status}/></td>
        </tr>)}
      </tbody></table></div></section>
    {selected !== null && <SupplierDrawer id={selected} onClose={() => setSelected(null)}/>}
    {adding && <SupplierModal onClose={() => setAdding(false)}/>}
  </>;
}
