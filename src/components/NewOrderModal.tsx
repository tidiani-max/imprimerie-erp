import { useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { ApiError, api, qs } from "../lib/api";
import { cur, dh, money, num, todayStr } from "../lib/format";
import { openReceipt } from "../lib/receipt";
import { SUPPORT_TYPES, type Client, type Order, type StockItem } from "../lib/types";
import { useApi } from "../lib/useApi";
import { Button, ErrorNote, Field, Icon, Modal, SelectField, inputCls, notify, notifyChange } from "./ui";

const METHODS = ["Espèces", "Carte", "Virement"];

export default function NewOrderModal({ onClose, onCreated }: { onClose: () => void; onCreated?: (o: Order) => void }) {
  const { settings } = useAuth();
  const { data: clients, reload: reloadClients } = useApi(() => api.get<{ clients: Client[] }>("/clients"));
  const { data: stock } = useApi(() => api.get<{ items: StockItem[] }>("/stock"));
  const { data: past } = useApi(() => api.get<{ services: string[] }>(`/orders${qs({ limit: 1 })}`));

  const [clientId, setClientId] = useState<number | "">("");
  const [service, setService] = useState("");
  const [supportType, setSupportType] = useState(""); // "" = free item; otherwise priced by surface
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [extra, setExtra] = useState("");
  const [inventoryId, setInventoryId] = useState<number | "">("");
  const [materialUsed, setMaterialUsed] = useState<string>("");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  const [paid, setPaid] = useState(0);
  const [method, setMethod] = useState("Espèces");
  const [dueDate, setDueDate] = useState("");
  const [quickName, setQuickName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Support orders: unit price = width × height (cm) × rate per cm² (+ extra fees per piece). The server recalculates the same way.
  const rate = supportType ? settings.print_rates?.[supportType] ?? 0 : 0;
  const area = (Number(width) || 0) * (Number(height) || 0);
  const unit = supportType ? Math.round((area * rate + (Number(extra) || 0)) * 100) / 100 : price;
  const total = Math.round(qty * unit * 100) / 100;
  const due = Math.max(0, Math.round((total - paid) * 100) / 100);
  const material = stock?.items.find(i => i.id === inventoryId);

  const addClient = async () => {
    if (!quickName?.trim()) return;
    try {
      const { client } = await api.post<{ client: Client }>("/clients", { name: quickName.trim() });
      await reloadClients(); setClientId(client.id); setQuickName(null); notifyChange();
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
  };

  const submit = async (print: boolean) => {
    setError("");
    if (!clientId) return setError("Choisissez un client.");
    if (supportType) {
      if (!(Number(width) > 0) || !(Number(height) > 0)) return setError("Indiquez la largeur et la hauteur en cm.");
      if (qty <= 0) return setError("La quantité doit être valide.");
    } else {
      if (!service.trim()) return setError("Indiquez le produit ou service.");
      if (qty <= 0 || price < 0) return setError("Quantité et prix doivent être valides.");
    }
    if (paid > total) return setError("Le montant payé dépasse le total.");
    setBusy(true);
    const body = {
      client_id: clientId, quantity: qty, amount_paid: paid,
      ...(supportType
        ? { support_type: supportType, width_cm: Number(width), height_cm: Number(height), extra_fees: Number(extra) || 0 }
        : { product_service: service.trim(), unit_price: price }),
      payment_method: method, due_date: dueDate || null,
      inventory_id: inventoryId || null, material_used: inventoryId && materialUsed !== "" ? Number(materialUsed) : null,
    };
    try {
      let res: { order: Order };
      try { res = await api.post("/orders", body); }
      catch (e) {
        if (e instanceof ApiError && e.code === "INSUFFICIENT_STOCK" && window.confirm(`${e.message}\n\nCréer la commande quand même (le stock deviendra négatif) ?`)) {
          res = await api.post("/orders", { ...body, allow_negative_stock: true });
        } else throw e;
      }
      notify(`${res.order.order_number} créée.`);
      notifyChange();
      onCreated?.(res.order);
      if (print) openReceipt({ kind: "order", id: res.order.id });
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); }
    finally { setBusy(false); }
  };

  return <Modal wide title="Nouvelle commande" eyebrow="Vente" onClose={onClose}
    footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button variant="secondary" disabled={busy} onClick={() => submit(false)}>Créer</Button><Button icon="printer" disabled={busy} onClick={() => submit(true)}>Créer & reçu</Button></>}>
    <div>
      <label className="block text-xs font-bold uppercase tracking-wider text-slate-500">Client</label>
      {quickName === null
        ? <div className="mt-2 flex gap-2"><SelectField value={String(clientId)} onChange={v => setClientId(v ? Number(v) : "")} className="flex-1"><option value="">— Choisir un client —</option>{clients?.clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField><Button variant="secondary" icon="plus" onClick={() => setQuickName("")}>Ajout rapide</Button></div>
        : <div className="mt-2 flex gap-2"><input autoFocus value={quickName} onChange={e => setQuickName(e.target.value)} onKeyDown={e => e.key === "Enter" && addClient()} className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-blue-400" placeholder="Nom du nouveau client"/><Button onClick={addClient}>Ajouter</Button><Button variant="ghost" onClick={() => setQuickName(null)}>Annuler</Button></div>}
    </div>

    <p className="pt-2 font-bold text-slate-900">Article de la commande</p>
    <div className="rounded-2xl border border-slate-200 p-4">
      <Field label="Type de support" hint="Bâche, autocollant… : le prix se calcule tout seul à partir de la taille.">
        <SelectField value={supportType} onChange={setSupportType} className="mt-2 w-full"><option value="">Autre produit ou service (saisie libre)</option>{SUPPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</SelectField>
      </Field>
      {supportType && <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Largeur (cm)"><input min="0" step="any" type="number" value={width} onChange={e => setWidth(e.target.value)} className={`${inputCls.replace("h-11", "h-10")} font-mono`} placeholder="ex. 200"/></Field>
        <Field label="Hauteur (cm)"><input min="0" step="any" type="number" value={height} onChange={e => setHeight(e.target.value)} className={`${inputCls.replace("h-11", "h-10")} font-mono`} placeholder="ex. 100"/></Field>
        <Field label={`Frais suppl. par pièce (${cur()})`} hint="Optionnel : œillets, finition…"><input min="0" step="any" type="number" value={extra} onChange={e => setExtra(e.target.value)} className={`${inputCls.replace("h-11", "h-10")} font-mono`} placeholder="0"/></Field>
      </div>}
      {supportType && <p data-testid="support-calc" className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
        Surface : <b className="font-mono text-slate-900">{num(area)} cm²</b> ({num(area / 10000)} m²) × tarif <b className="font-mono text-slate-900">{money(rate)} {cur()}/cm²</b> = <b className="font-mono text-slate-900">{dh(area * rate)}</b> par pièce
        {(Number(extra) || 0) > 0 && <> + frais <b className="font-mono text-slate-900">{dh(Number(extra))}</b></>}
        {" "}→ prix unitaire <b className="font-mono text-slate-900">{dh(unit)}</b>
      </p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {!supportType && <Field label="Produit / Service"><input list="services" value={service} onChange={e => setService(e.target.value)} className={inputCls.replace("h-11", "h-10")} placeholder="Bâche 510g, Cartes de visite…"/><datalist id="services">{past?.services.map(s => <option key={s} value={s}/>)}</datalist></Field>}
        <Field label="Matière consommée (optionnel)"><SelectField value={String(inventoryId)} onChange={v => { setInventoryId(v ? Number(v) : ""); setMaterialUsed(""); }} className="mt-2 w-full"><option value="">Aucune</option>{stock?.items.map(i => <option key={i.id} value={i.id}>{i.item} — {i.current_stock} {i.unit}</option>)}</SelectField></Field>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Quantité"><input min="0.01" step="any" type="number" value={qty} onChange={e => setQty(Number(e.target.value))} className={`${inputCls.replace("h-11", "h-10")} font-mono`}/></Field>
        {!supportType && <Field label={`Prix unitaire (${cur()})`}><input min="0" step="any" type="number" value={price} onChange={e => setPrice(Number(e.target.value))} className={`${inputCls.replace("h-11", "h-10")} font-mono`}/></Field>}
        {material && <Field label={`Matière utilisée (${material.unit})`} hint={supportType ? `Surface totale commandée : ${num(area * qty / 10000)} m². Par défaut : ${qty}` : "Par défaut : la quantité"}><input min="0" step="any" type="number" value={materialUsed} placeholder={String(qty)} onChange={e => setMaterialUsed(e.target.value)} className={`${inputCls.replace("h-11", "h-10")} font-mono`}/></Field>}
      </div>
    </div>

    <div className="rounded-2xl bg-slate-950 p-5 text-white">
      <div className="flex justify-between text-sm text-slate-400"><span>Total</span><span className="font-mono text-white">{dh(total)}</span></div>
      <label className="mt-4 flex items-center justify-between gap-4 border-t border-white/10 pt-4 text-sm text-slate-400"><span>Montant payé</span><input type="number" min="0" step="any" value={paid} onChange={e => setPaid(Number(e.target.value))} className="h-9 w-36 rounded-lg border border-white/10 bg-white/10 px-3 text-right font-mono text-white outline-none focus:border-blue-400"/></label>
      <div className="mt-4 flex justify-between border-t border-white/10 pt-4"><span className="font-semibold">Reste à payer</span><span className="font-mono text-xl font-bold text-amber-400">{money(due)} {cur()}</span></div>
    </div>
    {due > 0 && <Field label="Échéance de paiement" hint="Par défaut : 30 jours"><input type="date" min={todayStr()} value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls}/></Field>}
    <div><p className="text-xs font-bold uppercase tracking-wider text-slate-500">Mode de paiement</p><div className="mt-2 grid grid-cols-3 gap-2">{METHODS.map(x => <button type="button" onClick={() => setMethod(x)} key={x} className={`rounded-xl border px-3 py-3 text-sm font-semibold ${method === x ? "border-blue-600 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>{x}</button>)}</div></div>
    <ErrorNote message={error}/>
    <p className="flex items-start gap-2 text-xs text-slate-400"><Icon name="receipt" className="mt-0.5 h-3.5 w-3.5 shrink-0"/>La création met à jour automatiquement la dette du client, la caisse (si un montant est payé) et le stock de la matière choisie.</p>
  </Modal>;
}
