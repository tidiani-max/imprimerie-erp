import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Splash } from "../auth/ProtectedRoute";
import RecoveryCodePanel from "../components/RecoveryCode";
import { Button, ErrorNote, Field, SelectField, inputCls, notify } from "../components/ui";
import type { Role } from "../lib/types";
import AuthLayout from "./AuthLayout";

/**
 * Two uses of the same screen:
 *  - first launch (no users yet): creates the shop + the owner account
 *  - later: only a logged-in owner can open it, to add staff / owner accounts
 */
export default function Signup() {
  const { user, loading, needsSetup, shopName, signup, refreshSession } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ shopName: "", name: "", email: "", password: "", role: "owner" as Role });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm(f => ({ ...f, [k]: v }));

  if (recoveryCode) return <AuthLayout title="Votre espace est créé" subtitle="Dernière étape : conservez votre code de récupération.">
    <RecoveryCodePanel code={recoveryCode} doneLabel="Entrer dans l'application" onDone={async () => { await refreshSession(); navigate("/", { replace: true }); }}/>
  </AuthLayout>;
  if (loading) return <Splash />;
  if (user && user.role !== "owner") return <Navigate to="/" replace />;
  if (!user && !needsSetup) return <AuthLayout title="Inscription fermée" subtitle="Les comptes sont créés par le propriétaire de l'imprimerie."
    footer={<Link to="/login" className="font-semibold text-blue-600 hover:text-blue-700">Retour à la connexion</Link>}><span/></AuthLayout>;

  const addingStaff = !!user; // logged-in owner creating another account
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const res = await signup({ ...form, shopName: addingStaff ? undefined : form.shopName, role: needsSetup ? "owner" : form.role });
      if (res.recoveryCode) setRecoveryCode(res.recoveryCode);
      else if (addingStaff) { notify(`Compte créé pour ${form.name}.`); setForm(f => ({ ...f, name: "", email: "", password: "" })); }
      else navigate("/", { replace: true });
    } catch (err) { setError(err instanceof Error ? err.message : "Inscription impossible"); }
    finally { setBusy(false); }
  };

  return <AuthLayout
    title={addingStaff ? "Ajouter un utilisateur" : "Créer votre espace"}
    subtitle={addingStaff ? `Nouveau compte pour ${shopName}.` : "Le premier compte devient automatiquement propriétaire."}
    footer={addingStaff ? <Link to="/" className="font-semibold text-blue-600 hover:text-blue-700">← Retour au tableau de bord</Link> : <>Déjà un compte ? <Link to="/login" className="font-semibold text-blue-600 hover:text-blue-700">Se connecter</Link></>}>
    <form onSubmit={submit} className="space-y-4">
      {!addingStaff && <Field label="Nom de l'imprimerie"><input required minLength={2} value={form.shopName} onChange={e => set("shopName")(e.target.value)} className={inputCls} placeholder="Imprimerie Atlas"/></Field>}
      <Field label="Nom complet"><input required minLength={2} autoComplete="name" value={form.name} onChange={e => set("name")(e.target.value)} className={inputCls} placeholder="Youssef Mansouri"/></Field>
      <Field label="E-mail"><input type="email" required autoComplete="username" value={form.email} onChange={e => set("email")(e.target.value)} className={inputCls}/></Field>
      <Field label="Mot de passe" hint="8 caractères minimum"><input type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={e => set("password")(e.target.value)} className={inputCls}/></Field>
      <Field label="Rôle">
        <SelectField value={needsSetup ? "owner" : form.role} onChange={set("role")} className={`${inputCls} !h-11 w-full`}>
          <option value="owner">Propriétaire</option>
          {!needsSetup && <option value="staff">Employé</option>}
        </SelectField>
      </Field>
      <ErrorNote message={error}/>
      <Button type="submit" disabled={busy} className="h-11 w-full">{busy ? "Création…" : addingStaff ? "Créer le compte" : "Créer mon espace"}</Button>
    </form>
  </AuthLayout>;
}
