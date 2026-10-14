import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import RecoveryCodePanel from "../components/RecoveryCode";
import { Button, ErrorNote, Field, Modal, PageTitle, inputCls, notify, notifyChange } from "../components/ui";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import type { Role } from "../lib/types";

type ManagedUser = { id: number; name: string; email: string; role: Role; active: boolean; created_at: string };
const card = "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm";

export default function AccountPage() {
  const { user } = useAuth();
  const isOwner = user?.role === "owner";
  return <div className="space-y-6">
    <PageTitle title="Mon compte" subtitle={isOwner ? "Mot de passe, code de récupération et utilisateurs." : "Changez votre mot de passe."}/>
    <ChangePassword/>
    {isOwner && <RecoveryCodeSection/>}
    {isOwner && <UsersSection selfId={user!.id}/>}
  </div>;
}

function ChangePassword() {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setError("Les deux mots de passe ne sont pas identiques.");
    setError(""); setBusy(true);
    try {
      await api.post("/auth/change-password", { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      notify("Mot de passe modifié. Vos autres appareils ont été déconnectés.");
    } catch (err) { setError(err instanceof Error ? err.message : "Modification impossible"); }
    finally { setBusy(false); }
  };
  return <section className={card}>
    <p className="text-lg font-bold text-slate-950">Changer mon mot de passe</p>
    <form onSubmit={submit} className="mt-4 grid max-w-xl gap-4">
      <Field label="Mot de passe actuel"><input type="password" required autoComplete="current-password" value={form.currentPassword} onChange={e => set("currentPassword")(e.target.value)} className={inputCls}/></Field>
      <Field label="Nouveau mot de passe" hint="8 caractères minimum"><input type="password" required minLength={8} autoComplete="new-password" value={form.newPassword} onChange={e => set("newPassword")(e.target.value)} className={inputCls}/></Field>
      <Field label="Confirmer le nouveau mot de passe"><input type="password" required minLength={8} autoComplete="new-password" value={form.confirm} onChange={e => set("confirm")(e.target.value)} className={inputCls}/></Field>
      <ErrorNote message={error}/>
      <div><Button type="submit" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer le nouveau mot de passe"}</Button></div>
    </form>
  </section>;
}

function RecoveryCodeSection() {
  const { data, reload } = useApi(() => api.get<{ recoveryCodeSet?: boolean }>("/auth/me"));
  const [open, setOpen] = useState(false);
  return <section className={card}>
    <p className="text-lg font-bold text-slate-950">Code de récupération</p>
    <p className="mt-1 max-w-2xl text-sm text-slate-500">Si le propriétaire oublie son mot de passe, ce code permet de le changer depuis l'écran de connexion (« Mot de passe oublié »). Il est affiché une seule fois.</p>
    {data && <p className={`mt-3 inline-block rounded-lg px-3 py-1.5 text-sm font-semibold ${data.recoveryCodeSet ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{data.recoveryCodeSet ? "Un code de récupération est actif." : "Aucun code de récupération : générez-en un maintenant."}</p>}
    <div className="mt-4"><Button variant="secondary" onClick={() => setOpen(true)}>{data?.recoveryCodeSet ? "Générer un nouveau code" : "Générer un code"}</Button></div>
    {open && <NewCodeModal onClose={() => { setOpen(false); reload(); }}/>}
  </section>;
}

function NewCodeModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const generate = async () => {
    setError(""); setBusy(true);
    try { setCode((await api.post<{ recoveryCode: string }>("/auth/recovery-code", { password })).recoveryCode); }
    catch (err) { setError(err instanceof Error ? err.message : "Erreur"); }
    finally { setBusy(false); }
  };
  if (code) return <Modal title="Nouveau code de récupération" eyebrow="Compte propriétaire" onClose={() => { /* must confirm via the button */ }}>
    <RecoveryCodePanel code={code} onDone={onClose} doneLabel="Terminer"/>
  </Modal>;
  return <Modal title="Générer un code" eyebrow="Compte propriétaire" onClose={onClose}
    footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button disabled={busy || !password} onClick={generate}>Générer</Button></>}>
    <p className="text-sm text-slate-600">L'ancien code (s'il existe) cessera de fonctionner. Confirmez avec votre mot de passe.</p>
    <Field label="Votre mot de passe"><input autoFocus type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && password && generate()} className={inputCls}/></Field>
    <ErrorNote message={error}/>
  </Modal>;
}

function UsersSection({ selfId }: { selfId: number }) {
  const { data, error, reload } = useApi(() => api.get<{ users: ManagedUser[] }>("/users"));
  const [resetting, setResetting] = useState<ManagedUser | null>(null);
  const toggle = async (u: ManagedUser) => {
    const verb = u.active ? "désactiver" : "réactiver";
    if (!window.confirm(`Voulez-vous ${verb} le compte de ${u.name} ?${u.active ? "\n\nIl sera déconnecté immédiatement. Son historique est conservé." : ""}`)) return;
    try { await api.patch(`/users/${u.id}`, { active: !u.active }); notify(`Compte de ${u.name} ${u.active ? "désactivé" : "réactivé"}.`); reload(); }
    catch (err) { notify(err instanceof Error ? err.message : "Erreur"); }
  };
  return <section className={card}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-lg font-bold text-slate-950">Utilisateurs</p>
      <Link to="/signup" className="inline-flex h-10 items-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">Ajouter un utilisateur</Link>
    </div>
    <ErrorNote message={error}/>
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead><tr className="border-b border-slate-100 text-xs font-semibold uppercase text-slate-400"><th className="py-2 pr-4">Nom</th><th className="py-2 pr-4">E-mail</th><th className="py-2 pr-4">Rôle</th><th className="py-2 pr-4">État</th><th className="py-2 text-right">Actions</th></tr></thead>
        <tbody>
          {data?.users.map(u => <tr key={u.id} className="border-b border-slate-50 last:border-0">
            <td className="py-3 pr-4 font-semibold text-slate-900">{u.name}{u.id === selfId && <span className="ml-2 text-xs font-normal text-slate-400">(vous)</span>}</td>
            <td className="py-3 pr-4 text-slate-600">{u.email}</td>
            <td className="py-3 pr-4">{u.role === "owner" ? "Propriétaire" : "Employé"}</td>
            <td className="py-3 pr-4"><span className={`rounded-lg px-2 py-1 text-xs font-semibold ${u.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{u.active ? "Actif" : "Désactivé"}</span></td>
            <td className="py-3 text-right">{u.id !== selfId && <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setResetting(u)}>Réinitialiser le mot de passe</Button>
              <Button variant={u.active ? "danger" : "secondary"} onClick={() => toggle(u)}>{u.active ? "Désactiver" : "Réactiver"}</Button>
            </div>}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)}/>}
  </section>;
}

function ResetPasswordModal({ user, onClose }: { user: ManagedUser; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (password.length < 8) return setError("8 caractères minimum.");
    setError(""); setBusy(true);
    try {
      await api.post(`/users/${user.id}/reset-password`, { newPassword: password });
      notify(`Mot de passe de ${user.name} modifié. Communiquez-le lui, il sera déconnecté de ses appareils.`); notifyChange(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : "Erreur"); setBusy(false); }
  };
  return <Modal title={`Nouveau mot de passe pour ${user.name}`} eyebrow="Réinitialisation" onClose={onClose}
    footer={<><Button variant="secondary" onClick={onClose}>Annuler</Button><Button disabled={busy} onClick={save}>Enregistrer</Button></>}>
    <p className="text-sm text-slate-600">Choisissez un mot de passe temporaire et donnez-le à {user.name}. Elle ou il pourra ensuite le changer dans <i>Mon compte</i>.</p>
    <Field label="Nouveau mot de passe" hint="8 caractères minimum"><input autoFocus type="text" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && save()} className={inputCls}/></Field>
    <ErrorNote message={error}/>
  </Modal>;
}
