import { useState } from "react";
import { Button, notify } from "./ui";

/** Shows a recovery code ONCE and makes the owner confirm they wrote it down before continuing. */
export default function RecoveryCodePanel({ code, onDone, doneLabel = "Continuer" }: { code: string; onDone: () => void; doneLabel?: string }) {
  const [saved, setSaved] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); notify("Code copié."); }
    catch { notify("Copie impossible : notez le code à la main."); }
  };
  return <div className="space-y-4">
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-bold">Notez ce code maintenant, il ne sera plus jamais affiché.</p>
      <p className="mt-1 text-amber-800">Il permet de récupérer le compte propriétaire si le mot de passe est oublié. Écrivez-le sur papier et gardez-le en lieu sûr, loin de l'ordinateur de l'imprimerie.</p>
    </div>
    <p className="select-all rounded-2xl bg-slate-900 px-4 py-5 text-center font-mono text-xl font-bold tracking-widest text-white sm:text-2xl" aria-label="Code de récupération">{code}</p>
    <div className="flex justify-center"><Button variant="secondary" onClick={copy}>Copier le code</Button></div>
    <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
      <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} className="mt-0.5 h-4 w-4"/>
      <span>J'ai noté ce code en lieu sûr.</span>
    </label>
    <Button disabled={!saved} onClick={onDone} className="h-11 w-full">{doneLabel}</Button>
  </div>;
}
