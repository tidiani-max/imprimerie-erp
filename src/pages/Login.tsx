import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Splash } from "../auth/ProtectedRoute";
import { Button, ErrorNote, Field, inputCls } from "../components/ui";
import AuthLayout from "./AuthLayout";

export default function Login() {
  const { user, loading, needsSetup, login } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (loading) return <Splash />;
  if (user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(""); setBusy(true);
    try { await login(email, password); navigate(from, { replace: true }); }
    catch (err) { setError(err instanceof Error ? err.message : "Connexion impossible"); }
    finally { setBusy(false); }
  };

  return <AuthLayout title="Connexion" subtitle="Accédez à votre espace de gestion."
    footer={needsSetup ? <>Première utilisation ? <Link to="/signup" className="font-semibold text-blue-600 hover:text-blue-700">Créer le compte propriétaire</Link></> : undefined}>
    <form onSubmit={submit} className="space-y-4">
      <Field label="E-mail"><input type="email" required autoFocus autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="vous@exemple.com"/></Field>
      <Field label="Mot de passe"><input type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className={inputCls} placeholder="••••••••"/></Field>
      
      <div className="flex items-center justify-between text-xs font-semibold">
        <Link to="/signup" className="text-blue-600 hover:text-blue-700">Créer un compte</Link>
        <Link to="/forgot-password" className="text-blue-600 hover:text-blue-700">Mot de passe oublié ?</Link>
      </div>

      <ErrorNote message={error}/>
      <Button type="submit" disabled={busy} className="h-11 w-full">{busy ? "Connexion…" : "Se connecter"}</Button>
    </form>
  </AuthLayout>;
}
