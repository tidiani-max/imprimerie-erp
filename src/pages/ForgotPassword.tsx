import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Splash } from "../auth/ProtectedRoute";
import RecoveryCodePanel from "../components/RecoveryCode";
import { Button, ErrorNote, Field, inputCls } from "../components/ui";
import { api } from "../lib/api";
import AuthLayout from "./AuthLayout";

/** "Mot de passe oublié" for the owner, using the recovery code given at setup (the app works offline: no e-mail link). */
export default function ForgotPassword() {
  const { user, loading, refreshSession } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", recoveryCode: "", newPassword: "", confirm: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  if (newCode) return <AuthLayout title="Mot de passe modifié" subtitle="Vous êtes connecté. Voici votre nouveau code de récupération.">
    <RecoveryCodePanel code={newCode} onDone={() => navigate("/", { replace: true })}/>
  </AuthLayout>;
  if (loading) return <Splash />;
  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setError("Les deux mots de passe ne sont pas identiques.");
    setError(""); setBusy(true);
    try {
      const res = await api.post<{ recoveryCode: string }>("/auth/reset-with-recovery", { email: form.email, recoveryCode: form.recoveryCode, newPassword: form.newPassword });
      setNewCode(res.recoveryCode);
      await refreshSession();
    } catch (err) { setError(err instanceof Error ? err.message : "Réinitialisation impossible"); }
    finally { setBusy(false); }
  };

  return <AuthLayout title="Mot de passe oublié" subtitle="Propriétaire : entrez le code de récupération noté à la création du compte."
    footer={<Link to="/login" className="font-semibold text-blue-600 hover:text-blue-700">← Retour à la connexion</Link>}>
    <form onSubmit={submit} className="space-y-4">
      <Field label="E-mail du propriétaire"><input type="email" required autoFocus autoComplete="username" value={form.email} onChange={e => set("email")(e.target.value)} className={inputCls}/></Field>
      <Field label="Code de récupération"><input required value={form.recoveryCode} onChange={e => set("recoveryCode")(e.target.value)} className={`${inputCls} font-mono uppercase tracking-wider`} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" autoComplete="off" spellCheck={false}/></Field>
      <Field label="Nouveau mot de passe" hint="8 caractères minimum"><input type="password" required minLength={8} autoComplete="new-password" value={form.newPassword} onChange={e => set("newPassword")(e.target.value)} className={inputCls}/></Field>
      <Field label="Confirmer le mot de passe"><input type="password" required minLength={8} autoComplete="new-password" value={form.confirm} onChange={e => set("confirm")(e.target.value)} className={inputCls}/></Field>
      <ErrorNote message={error}/>
      <Button type="submit" disabled={busy} className="h-11 w-full">{busy ? "Vérification…" : "Changer le mot de passe"}</Button>
      <p className="rounded-xl bg-slate-50 p-3 text-xs leading-relaxed text-slate-500"><b>Vous êtes employé ?</b> Demandez au propriétaire de réinitialiser votre mot de passe : menu en haut à droite, <i>Mon compte</i>, <i>Utilisateurs</i>.</p>
    </form>
  </AuthLayout>;
}
