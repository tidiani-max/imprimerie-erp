import { useState } from "react";
import { api } from "../lib/api";
import { cur, dh } from "../lib/format";
import { PAYMENT_METHODS } from "../lib/types";
import type { OrderRow } from "./OrdersTable";
import { Button, ErrorNote, Field, Modal, SelectField, inputCls, notify, notifyChange } from "./ui";

/** Add a payment to one order (PUT /api/orders/:id) the server mirrors it in the cash register. */
export default function PayOrderModal({ order, onClose }: { order: OrderRow; onClose: () => void }) {
  const [amount, setAmount] = useState(order.amount_due);
  const [method, setMethod] = useState("Espèces");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!(amount > 0) || amount > order.amount_due) return setError(`Entrez un montant entre 0,01 et ${order.amount_due}.`);
    setBusy(true);
    try {
      await api.put(`/orders/${order.id}`, { amount_paid: Math.round((order.amount_paid + amount) * 100) / 100, payment_method: method });
      notify(`Paiement de ${dh(amount)} enregistré sur ${order.order_number}.`); notifyChange(); onClose();
    } catch (e) { setError(e instanceof Error ? e.message : "Erreur"); setBusy(false); }
  };
  return <Modal title={`Paiement ${order.order_number}`} eyebrow={order.client_name ?? "Commande"} onClose={onClose}
    footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button disabled={busy} onClick={save}>Enregistrer</Button></>}>
    <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-semibold uppercase text-slate-400">Reste à payer</p><p className="mt-2 font-mono text-2xl font-bold text-red-600">{dh(order.amount_due)}</p></div>
    <Field label={`Montant reçu (${cur()})`}><input autoFocus type="number" min="0" step="any" value={amount} onChange={e => setAmount(Number(e.target.value))} className={`${inputCls} font-mono`}/></Field>
    <Field label="Mode de paiement"><SelectField value={method} onChange={setMethod} className={`${inputCls} !h-11 w-full`}>{PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}</SelectField></Field>
    <ErrorNote message={error}/>
  </Modal>;
}
