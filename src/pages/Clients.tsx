import { useState } from "react";
import ExportButton from "../components/ExportButton";
import { Badge, Button, Drawer, EmptyRow, ErrorNote, Field, KpiCard, Modal, PageTitle, SearchField, SelectField, inputCls, notify, notifyChange } from "../components/ui";
import { api, qs } from "../lib/api";
import { cur, dh, fmtDay, fmtShortDay, money, num } from "../lib/format";
import { openReceipt, type PaymentReceipt } from "../lib/receipt";
import { PAYMENT_METHODS, type Client, type Order } from "../lib/types";
import { useApi, useDebounced } from "../lib/useApi";

type Debts = {
  client: Client; total_debt: number;
  unpaid_orders: (Pick<Order, "id" | "order_number" | "product_service" | "order_date" | "due_date" | "total_amount" | "amount_paid" | "amount_due" | "status"> & { overdue: boolean; is_opening?: boolean })[];
  recent_orders: Pick<Order, "id" | "order_number" | "order_date" | "total_amount" | "status">[];
  opening: { total: number; paid: number; due: number; date: string } | null;
};

const DEBT_HINT = "Ce que le client devait déjà avant d'utiliser l'application (ancien cahier de dettes). C'est une dette : elle n'est pas comptée comme une vente et ne touche pas la caisse. Quand le client la paie, l'argent entre en caisse.";

function AddClientModal({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: "", phone: "", email: "", debt: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim()) return setError("Le nom est obligatoire.");
    const debt = Number(f.debt) || 0;
    if (debt < 0) return setError("La dette ne peut pas être négative.");
    setBusy(true);
    try { await api.post("/clients", { name: f.name, phone: f.phone, email: f.email, opening_debt: debt }); notify(`Client « ${f.name} » ajouté.`); notifyChange(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Erreur"); setBusy(false); }
  };
  return <Modal title="Ajouter un client" eyebrow="Saisie rapide" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button disabled={busy} onClick={save}>Enregistrer</Button></>}>
    <Field label="Nom complet"><input autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className={inputCls} placeholder="Nom du client"/></Field>
    <Field label="Téléphone"><input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} className={inputCls} placeholder="+223 …"/></Field>
    <Field label="E-mail (optionnel)"><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} className={inputCls}/></Field>
    <Field label={`Dette actuelle (${cur()}, optionnel)`} hint={DEBT_HINT}><input type="number" min="0" step="any" value={f.debt} onChange={e => setF({ ...f, debt: e.target.value })} className={`${inputCls} font-mono`} placeholder="0"/></Field>
    <ErrorNote message={error}/>
  </Modal>;
}

function EditClientModal({ client, opening, onClose }: { client: Client; opening: Debts["opening"]; onClose: () => void }) {
  const [f, setF] = useState({ name: client.name, phone: client.phone ?? "", email: client.email ?? "", debt: opening ? String(opening.total) : "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.name.trim()) return setError("Le nom est obligatoire.");
    const debt = Number(f.debt) || 0;
    if (debt < 0) return setError("La dette ne peut pas être négative.");
    if (opening && debt < opening.paid) return setError(`La dette ne peut pas être inférieure à ce qui a déjà été payé dessus (${money(opening.paid)} ${cur()}).`);
    setBusy(true);
    try {
      await api.patch(`/clients/${client.id}`, { name: f.name, phone: f.phone, email: f.email, opening_debt: debt });
      notify(`Client « ${f.name} » modifié.`); notifyChange(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); setBusy(false); }
  };
  return <Modal title="Modifier le client" eyebrow={client.name} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button disabled={busy} onClick={save}>Enregistrer</Button></>}>
    <Field label="Nom complet"><input autoFocus value={f.name} onChange={e => setF({ ...f, name: e.target.value })} className={inputCls}/></Field>
    <Field label="Téléphone"><input value={f.phone} onChange={e => setF({ ...f, phone: e.target.value })} className={inputCls}/></Field>
    <Field label="E-mail (optionnel)"><input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} className={inputCls}/></Field>
    <Field label={`Dette antérieure (${cur()})`} hint={opening && opening.paid > 0 ? `Déjà payé dessus : ${money(opening.paid)} ${cur()}. Vous pouvez augmenter ou corriger le montant, sans descendre sous ce qui est déjà payé. ${DEBT_HINT}` : DEBT_HINT}>
      <input type="number" min="0" step="any" value={f.debt} onChange={e => setF({ ...f, debt: e.target.value })} className={`${inputCls} font-mono`} placeholder="0"/>
    </Field>
    <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">Les dettes des commandes passées se règlent depuis « Enregistrer un paiement ». Cette zone ne concerne que la dette d'avant l'application.</p>
    <ErrorNote message={error}/>
  </Modal>;
}

function ClientPaymentModal({ client, debt, onClose }: { client: Client; debt: number; onClose: () => void }) {
  const [amount, setAmount] = useState(debt);
  const [method, setMethod] = useState("Espèces");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<PaymentReceipt | null>(null);
  const save = async () => {
    if (!(amount > 0) || amount > debt) return setError(`Entrez un montant entre 0,01 et ${debt}.`);
    setBusy(true);
    try {
      const res = await api.post<{ applied: PaymentReceipt["applied"]; client: Client }>(`/clients/${client.id}/payments`, { amount, payment_method: method });
      notify(`Paiement de ${dh(amount)} enregistré pour ${client.name}.`); notifyChange();
      setReceipt({ client_name: client.name, amount, method, applied: res.applied, remaining: res.client.debt });
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); setBusy(false); }
  };
  if (receipt) return <Modal title="Paiement enregistré" eyebrow={client.name} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Fermer</Button><Button icon="printer" onClick={() => openReceipt({ kind: "payment", data: receipt })}>Voir / imprimer le reçu</Button></>}>
    <div className="rounded-xl bg-emerald-50 p-4"><p className="text-xs font-semibold uppercase text-emerald-700">Montant reçu</p><p className="mt-2 font-mono text-2xl font-bold text-emerald-700">{dh(receipt.amount)}</p></div>
    <p className="text-sm text-slate-600">Reste dû par {client.name} : <b className="font-mono">{dh(receipt.remaining)}</b></p>
  </Modal>;
  return <Modal title="Enregistrer un paiement" eyebrow={client.name} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button disabled={busy} onClick={save}>Enregistrer</Button></>}>
    <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase text-slate-400">Dette actuelle</p><p className="mt-2 font-mono text-2xl font-bold text-red-600">{dh(debt)}</p></div>
    <Field label={`Montant reçu (${cur()})`} hint="Appliqué aux dettes les plus anciennes d'abord (dette antérieure et commandes impayées)."><input autoFocus type="number" min="0" step="any" value={amount} onChange={e => setAmount(Number(e.target.value))} className={`${inputCls} font-mono`}/></Field>
    <Field label="Mode de paiement"><SelectField value={method} onChange={setMethod} className={`${inputCls} !h-11 w-full`}>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</SelectField></Field>
    <ErrorNote message={error}/>
  </Modal>;
}

function ClientDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, loading } = useApi(() => api.get<Debts>(`/clients/${id}/debts`), [id]);
  const [paying, setPaying] = useState(false);
  const [editing, setEditing] = useState(false);
  const c = data?.client;
  return <Drawer title={c?.name ?? "…"} onClose={onClose}>
    {loading && !data && <p className="text-sm text-slate-400">Chargement…</p>}
    {data && c && <>
      <div className="-mt-4 mb-4 flex items-start justify-between gap-3">
        <p className="text-sm text-slate-500">{[c.phone, c.email].filter(Boolean).join(" · ") || "Aucun contact"}</p>
        <Button variant="secondary" icon="edit" className="shrink-0" onClick={() => setEditing(true)}>Modifier</Button>
      </div>
      <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase text-slate-400">Dette actuelle</p><p className={`mt-2 font-mono text-2xl font-bold ${data.total_debt > 0 ? "text-red-600" : "text-emerald-600"}`}>{dh(data.total_debt)}</p>
        {data.opening && <p className="mt-2 text-xs text-slate-500">dont dette antérieure : <b className="font-mono">{dh(data.opening.due)}</b>{data.opening.paid > 0 && <> (déjà payé {dh(data.opening.paid)} sur {dh(data.opening.total)})</>}</p>}
      </div>
      {data.unpaid_orders.length > 0 && <div className="mt-6"><p className="font-bold text-slate-900">Dettes à régler</p>
        {data.unpaid_orders.map(o => <div key={o.id} className="mt-3 flex items-center justify-between border-b border-slate-100 pb-3"><div>
          {o.is_opening
            ? <><p className="text-sm font-semibold">Dette antérieure</p><p className="text-xs text-slate-400">Avant l'application · {fmtDay(o.order_date)}</p></>
            : <><p className="text-sm font-semibold">{o.order_number} <span className="font-normal text-slate-400">· {o.product_service}</span></p><p className={`text-xs ${o.overdue ? "font-semibold text-red-600" : "text-slate-400"}`}>Échéance {fmtDay(o.due_date)}{o.overdue ? " · en retard" : ""}</p></>}
        </div><span className="font-mono text-xs font-bold text-red-600">{dh(o.amount_due)}</span></div>)}</div>}
      <div className="mt-6"><p className="font-bold text-slate-900">Historique récent</p>
        {data.recent_orders.length === 0 && <p className="mt-3 text-sm text-slate-400">Aucune commande.</p>}
        {data.recent_orders.map(o => <div key={o.id} className="mt-3 flex items-center justify-between border-b border-slate-100 pb-3"><div><p className="text-sm font-semibold">{o.order_number}</p><p className="text-xs text-slate-400">{fmtShortDay(o.order_date)}</p></div><div className="flex items-center gap-3"><Badge status={o.status}/><span className="font-mono text-xs font-bold">{dh(o.total_amount)}</span></div></div>)}</div>
      <Button className="mt-6 w-full" disabled={data.total_debt <= 0} onClick={() => setPaying(true)}>Enregistrer un paiement</Button>
      {paying && <ClientPaymentModal client={c} debt={data.total_debt} onClose={() => setPaying(false)}/>}
      {editing && <EditClientModal client={c} opening={data.opening} onClose={() => setEditing(false)}/>}
    </>}
  </Drawer>;
}

export default function ClientsPage() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const q = useDebounced(query.trim());
  const { data, error, loading } = useApi(() => api.get<{ clients: Client[]; stats: { count: number; new_this_month: number; total_debt: number; unpaid_orders: number } }>(`/clients${qs({ q })}`), [q]);
  const s = data?.stats;

  return <>
    <PageTitle title="Clients & dettes" subtitle="Centralisez vos relations clients et suivez les encours." action={<div className="flex gap-2"><ExportButton kind="clients" params={{ q }}/><Button icon="plus" onClick={() => setAdding(true)}>Ajouter un client</Button></div>}/>
    <div className="mb-6 grid gap-4 sm:grid-cols-2">
      <KpiCard title="Clients" value={String(s?.count ?? 0)} detail={`${s?.new_this_month ?? 0} nouveau${(s?.new_this_month ?? 0) > 1 ? "x" : ""} ce mois`} icon="clients"/>
      <KpiCard title="Dette client totale" value={dh(s?.total_debt)} detail={`${s?.unpaid_orders ?? 0} dette${(s?.unpaid_orders ?? 0) > 1 ? "s" : ""} à régler`} icon="receipt" tone="red"/>
    </div>
    <div className="mb-4 max-w-md"><SearchField value={query} onChange={setQuery} placeholder="Rechercher un client ou téléphone"/></div>
    {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm">
      <thead><tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-400"><th className="px-5 py-3">Client</th><th className="px-4 py-3">Téléphone</th><th className="px-4 py-3">Commandes</th><th className="px-4 py-3 text-right">Total dépensé</th><th className="px-4 py-3 text-right">Dette actuelle</th><th className="px-4 py-3">Échéance</th><th className="px-5 py-3">Statut</th></tr></thead>
      <tbody className="divide-y divide-slate-100">
        {loading && !data && <EmptyRow colSpan={7}>Chargement…</EmptyRow>}
        {data && data.clients.length === 0 && <EmptyRow colSpan={7}>Aucun client. Ajoutez-en un pour commencer.</EmptyRow>}
        {data?.clients.map(c => <tr key={c.id} onClick={() => setSelected(c.id)} className="cursor-pointer hover:bg-slate-50">
          <td className="px-5 py-4 font-semibold text-slate-800">{c.name}</td><td className="px-4 py-4 text-slate-500">{c.phone ?? "—"}</td>
          <td className="px-4 py-4 font-mono text-xs">{num(c.orders_count)}</td><td className="px-4 py-4 text-right font-mono text-xs">{dh(c.total_spent)}</td>
          <td className={`px-4 py-4 text-right font-mono text-xs font-bold ${c.debt > 0 ? "text-red-600" : "text-slate-400"}`}>{dh(c.debt)}</td>
          <td className="px-4 py-4 text-xs text-slate-500">{c.debt > 0 ? fmtDay(c.next_due) : "—"}</td><td className="px-5 py-4"><Badge status={c.status}/></td>
        </tr>)}
      </tbody></table></div></section>
    {selected !== null && <ClientDrawer id={selected} onClose={() => setSelected(null)}/>}
    {adding && <AddClientModal onClose={() => setAdding(false)}/>}
  </>;
}
