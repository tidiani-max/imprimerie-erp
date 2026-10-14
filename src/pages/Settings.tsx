import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Button, ErrorNote, Field, PageTitle, SelectField, inputCls, notify, notifyChange } from "../components/ui";
import { api } from "../lib/api";
import { buildOrderReceiptHtml } from "../lib/receipt";
import { SUPPORT_TYPES, type Settings } from "../lib/types";

const card = "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm";
const CURRENCIES = ["FCFA", "FCFA", "€", "$"];
const SAMPLE = { order_number: "CMD-1048", client_name: "Client exemple", product_service: "Bâche", support_type: "Bâche", width_cm: 200, height_cm: 100, rate_cm2: 0.3, extra_fees: 0, quantity: 2, unit_price: 6000, total_amount: 12000, amount_paid: 5000, amount_due: 7000, order_date: new Date().toISOString().slice(0, 10), status: "Partial" as const, payment_method: "Espèces", client: { debt: 47000, opening_due: 40000 } };

/** Shrinks the picked image (max 400×200) so it stays light; PNG/WebP keep transparency, JPEG stays JPEG. */
async function logoFromFile(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Choisissez une image PNG, JPEG ou WebP.");
  // Read as a data: URL (the app's security policy allows data: images, not blob: ones).
  const src = await new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => ko(new Error("Fichier illisible.")); r.readAsDataURL(file); });
  const img = await new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error("Image illisible.")); i.src = src; });
  const k = Math.min(1, 400 / img.width, 200 / img.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * k)); canvas.height = Math.max(1, Math.round(img.height * k));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return file.type === "image/jpeg" ? canvas.toDataURL("image/jpeg", 0.88) : canvas.toDataURL("image/png");
}

export default function SettingsPage() {
  const { settings, refreshSettings, refreshSession } = useAuth();
  const [f, setF] = useState<Settings>(settings);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setF(settings); }, [settings]);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setF((x) => ({ ...x, [k]: v }));

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    setError("");
    try { set("logo", await logoFromFile(file)); } catch (e) { setError(e instanceof Error ? e.message : "Image refusée"); }
  };
  const save = async () => {
    if (!f.shop_name.trim()) return setError("Le nom de l'imprimerie est obligatoire.");
    setError(""); setBusy(true);
    try {
      await api.put("/settings", { shop_name: f.shop_name, shop_address: f.shop_address, shop_phone: f.shop_phone, shop_email: f.shop_email, receipt_footer: f.receipt_footer, currency: f.currency, receipt_format: f.receipt_format, logo: f.logo, print_rates: f.print_rates });
      await refreshSettings(); await refreshSession(); notifyChange();
      notify("Paramètres enregistrés.");
    } catch (e) { setError(e instanceof Error ? e.message : "Enregistrement impossible"); }
    finally { setBusy(false); }
  };

  return <div className="space-y-6">
    <PageTitle title="Paramètres" subtitle="Identité de l'imprimerie, logo et reçus." action={<Button disabled={busy} onClick={save}>{busy ? "Enregistrement…" : "Enregistrer"}</Button>}/>
    <ErrorNote message={error}/>
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <div className="space-y-6">
        <section className={card}>
          <p className="text-lg font-bold text-slate-950">Votre imprimerie</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Nom"><input value={f.shop_name} onChange={e => set("shop_name", e.target.value)} className={inputCls}/></Field>
            <Field label="Téléphone"><input value={f.shop_phone} onChange={e => set("shop_phone", e.target.value)} className={inputCls} placeholder="+223 …"/></Field>
            <Field label="Adresse"><input value={f.shop_address} onChange={e => set("shop_address", e.target.value)} className={inputCls} placeholder="Rue, quartier, ville"/></Field>
            <Field label="E-mail (optionnel)"><input value={f.shop_email} onChange={e => set("shop_email", e.target.value)} className={inputCls}/></Field>
          </div>
        </section>
        <section className={card}>
          <p className="text-lg font-bold text-slate-950">Logo</p>
          <p className="mt-1 text-sm text-slate-500">Il s'imprime en haut de chaque reçu. Idéal : PNG sur fond transparent, au moins 300 pixels de large.</p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <div className="grid h-24 w-48 place-items-center overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-slate-50">
              {f.logo ? <img src={f.logo} alt="Logo" className="max-h-full max-w-full object-contain p-2" data-testid="logo-preview"/> : <span className="text-xs text-slate-400">Aucun logo</span>}
            </div>
            <div className="flex flex-col gap-2">
              <label className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">
                {f.logo ? "Changer le logo" : "Choisir un logo"}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" data-testid="logo-input" onChange={e => { pickLogo(e.target.files?.[0]); e.target.value = ""; }}/>
              </label>
              {f.logo && <Button variant="secondary" onClick={() => set("logo", null)}>Supprimer le logo</Button>}
            </div>
          </div>
        </section>
        <section className={card}>
          <p className="text-lg font-bold text-slate-950">Tarifs des supports</p>
          <p className="mt-1 text-sm text-slate-500">Prix par cm² (largeur × hauteur × tarif). Un changement ne touche que les nouvelles commandes : les anciennes gardent leur prix.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {SUPPORT_TYPES.map(t => <Field key={t} label={`${t} (${f.currency || "…"}/cm²)`}>
              <input type="number" min="0" step="any" value={f.print_rates?.[t] ?? 0} onChange={e => set("print_rates", { ...f.print_rates, [t]: Number(e.target.value) })} className={`${inputCls} font-mono`} data-testid={`rate-${t}`}/>
            </Field>)}
          </div>
        </section>
        <section className={card}>
          <p className="text-lg font-bold text-slate-950">Reçus et devise</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Format du reçu" hint="Vous pouvez aussi enregistrer en PDF depuis la fenêtre d'impression.">
              <SelectField value={f.receipt_format} onChange={v => set("receipt_format", v as Settings["receipt_format"])} className={`${inputCls} !h-11 w-full`}>
                <option value="ticket">Ticket (imprimante 80 mm)</option><option value="a5">A5 (demi-page)</option><option value="a4">A4 (page entière)</option>
              </SelectField>
            </Field>
            <Field label="Devise" hint="Affichée partout : écrans, reçus et Excel.">
              <div className="flex gap-2">
                <SelectField value={CURRENCIES.includes(f.currency) ? f.currency : "__other"} onChange={v => set("currency", v === "__other" ? "" : v)} className={`${inputCls} !h-11 w-32`}>
                  {CURRENCIES.map(c => <option key={c}>{c}</option>)}<option value="__other">Autre…</option>
                </SelectField>
                {!CURRENCIES.includes(f.currency) && <input value={f.currency} maxLength={8} onChange={e => set("currency", e.target.value)} className={`${inputCls} w-28`} placeholder="ex. GNF"/>}
              </div>
            </Field>
          </div>
          <div className="mt-4"><Field label="Message en bas du reçu"><input value={f.receipt_footer} maxLength={300} onChange={e => set("receipt_footer", e.target.value)} className={inputCls} placeholder="Merci de votre confiance."/></Field></div>
        </section>
      </div>
      <section className={`${card} h-fit`}>
        <p className="text-lg font-bold text-slate-950">Aperçu du reçu</p>
        <p className="mt-1 text-xs text-slate-400">Exemple avec vos informations, avant enregistrement.</p>
        <iframe title="Aperçu du reçu" data-testid="receipt-preview" srcDoc={buildOrderReceiptHtml(SAMPLE, f)} className="mt-4 h-[520px] w-full rounded-xl border border-slate-200 bg-white"/>
      </section>
    </div>
  </div>;
}
