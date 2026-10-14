import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import ReceiptHost from "../components/ReceiptModal";
import { Button, Icon, SearchField, Toaster, type IconName } from "../components/ui";
import { api, qs } from "../lib/api";
import { dh, initials, roleLabel } from "../lib/format";
import type { Alerts, Order } from "../lib/types";
import { useApi, useDebounced } from "../lib/useApi";

const navItems: { to: string; label: string; icon: IconName; end?: boolean; ownerOnly?: boolean }[] = [
  { to: "/", label: "Tableau de bord", icon: "dashboard", end: true },
  { to: "/orders", label: "Ventes / Commandes", icon: "orders" },
  { to: "/supports", label: "Bâches & autocollants", icon: "banner" },
  { to: "/clients", label: "Clients / Dettes", icon: "clients" },
  { to: "/stock", label: "Stock", icon: "stock" },
  { to: "/expenses", label: "Dépenses", icon: "expenses" },
  { to: "/cash", label: "Caisse", icon: "cash" },
  { to: "/settings", label: "Paramètres & logo", icon: "settings", ownerOnly: true },
];

function useClickAway(onAway: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onAway(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onAway]);
  return ref;
}

export default function AppShell() {
  const { user, shopName, logout, settings } = useAuth();
  const items = navItems.filter(n => !n.ownerOnly || user?.role === "owner");
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search.trim());
  const { data: alerts } = useApi(() => api.get<Alerts>("/alerts"), []);
  const { data: found } = useApi(
    () => (debounced ? api.get<{ orders: Order[] }>(`/orders${qs({ q: debounced, limit: 4 })}`) : Promise.resolve({ orders: [] as Order[] })),
    [debounced],
  );
  const bellRef = useClickAway(() => setBellOpen(false));
  const userRef = useClickAway(() => setUserOpen(false));
  const searchRef = useClickAway(() => setSearch(""));

  useEffect(() => { setMobileNav(false); setBellOpen(false); setUserOpen(false); }, [location.pathname]);

  const lowCount = alerts?.low_stock.length ?? 0;
  const overdueCount = alerts?.overdue_clients.length ?? 0;
  const title = items.find(n => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))?.label;
  const matchingNav = items.filter(n => n.label.toLowerCase().includes(search.toLowerCase()));

  return <div className="min-h-screen bg-slate-50 text-slate-900">
    {mobileNav && <div className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" onClick={() => setMobileNav(false)}/>}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-950 text-white transition-transform duration-300 lg:translate-x-0 ${mobileNav ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex h-20 items-center gap-3 border-b border-white/10 px-5">
        {settings.logo ? <img src={settings.logo} alt="" className="h-10 w-10 shrink-0 rounded-xl bg-white object-contain p-1"/> : <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/30"><Icon name="printer" className="h-5 w-5"/></div>}
        <div className="min-w-0"><p className="font-bold tracking-tight">Imprimerie<span className="text-blue-400">.</span></p><p className="truncate text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">{shopName}</p></div>
        <Button variant="ghost" icon="close" className="ml-auto h-8 w-8 p-0 text-slate-400 lg:hidden" onClick={() => setMobileNav(false)}/>
      </div>
      <nav className="flex-1 space-y-1.5 p-3"><p className="px-3 pb-2 pt-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">Navigation</p>
        {items.map(item => <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition ${isActive ? "bg-blue-600 text-white shadow-lg shadow-blue-950/30" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}>
          {({ isActive }) => <><Icon name={item.icon} className="h-5 w-5"/><span>{item.label}</span>{isActive && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-white"/>}</>}
        </NavLink>)}
      </nav>
      {lowCount > 0 && <div className="m-3 rounded-2xl border border-white/10 bg-white/5 p-4"><div className="flex items-center gap-2 text-amber-400"><Icon name="bell" className="h-4 w-4"/><span className="text-xs font-bold">Stock faible</span></div>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">{lowCount} article{lowCount > 1 ? "s sont sous leur seuil" : " est sous son seuil"} d'alerte.</p>
        <Link to="/stock" className="mt-3 inline-block text-xs font-bold text-blue-400 hover:text-blue-300">Consulter le stock →</Link></div>}
      <div className="border-t border-white/10 p-4"><div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 text-xs font-bold">{initials(user?.name ?? "")}</div>
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{user?.name}</p><p className="text-[11px] text-slate-500">{roleLabel(user?.role ?? "")}</p></div>
      </div></div>
    </aside>

    <div className="lg:pl-64">
      <header className="sticky top-0 z-20 flex h-20 items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
        <Button variant="ghost" icon="menu" className="h-10 w-10 p-0 lg:hidden" onClick={() => setMobileNav(true)}/>
        <div ref={searchRef} className="relative hidden w-full max-w-sm md:block">
          <SearchField value={search} onChange={setSearch} placeholder="Rechercher partout..."/>
          {search && <div className="absolute left-0 right-0 top-12 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
            <p className="px-3 py-2 text-xs font-semibold text-slate-400">Résultats rapides</p>
            {matchingNav.map(n => <button key={n.to} onClick={() => { navigate(n.to); setSearch(""); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold hover:bg-slate-50"><Icon name={n.icon} className="h-4 w-4 text-blue-600"/>{n.label}</button>)}
            {found?.orders.map(o => <button key={o.id} onClick={() => { navigate(`/orders?q=${encodeURIComponent(o.order_number)}`); setSearch(""); }} className="flex w-full justify-between rounded-xl px-3 py-2.5 text-sm hover:bg-slate-50"><span>{o.client_name}</span><b className="font-mono text-xs text-blue-600">{o.order_number}</b></button>)}
            {!matchingNav.length && !found?.orders.length && <p className="px-3 py-3 text-sm text-slate-400">Aucun résultat</p>}
          </div>}
        </div>
        <span className="text-sm font-bold lg:hidden">{title}</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-sm font-medium capitalize text-slate-500 sm:inline">{new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</span>
          <div ref={bellRef} className="relative">
            <Button variant="ghost" icon="bell" className="relative h-10 w-10 p-0" onClick={() => setBellOpen(o => !o)}>
              {(lowCount + overdueCount) > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full border-2 border-white bg-red-500"/>}
            </Button>
            {bellOpen && <div className="absolute right-0 top-12 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
              <p className="px-2 py-2 text-sm font-bold">Notifications</p>
              {lowCount === 0 && overdueCount === 0 && <p className="px-2 py-3 text-sm text-slate-400">Rien à signaler.</p>}
              {lowCount > 0 && <button onClick={() => navigate("/stock")} className="w-full rounded-xl bg-red-50 p-3 text-left"><p className="text-sm font-semibold text-red-800">Stock faible</p><p className="mt-1 text-xs text-red-600">{alerts!.low_stock.map(i => i.item).slice(0, 3).join(", ")}{lowCount > 3 ? "…" : ""}</p></button>}
              {alerts?.overdue_clients.slice(0, 4).map(c => <button key={c.id} onClick={() => navigate("/clients")} className="mt-2 w-full rounded-xl bg-amber-50 p-3 text-left"><p className="text-sm font-semibold text-amber-800">Paiement en retard</p><p className="mt-1 text-xs text-amber-600">{c.name} doit {dh(c.debt)}</p></button>)}
            </div>}
          </div>
          <div className="hidden h-6 w-px bg-slate-200 sm:block"/>
          <div ref={userRef} className="relative">
            <button onClick={() => setUserOpen(o => !o)} className="flex items-center gap-2 rounded-xl p-1 hover:bg-slate-100">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-900 text-xs font-bold text-white">{initials(user?.name ?? "")}</div><Icon name="chevron" className="hidden h-4 w-4 rotate-90 text-slate-400 sm:block"/>
            </button>
            {userOpen && <div className="absolute right-0 top-12 w-60 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
              <div className="px-3 py-2"><p className="truncate text-sm font-bold">{user?.name}</p><p className="truncate text-xs text-slate-400">{user?.email}</p></div>
              <Link to="/account" onClick={() => setUserOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-semibold hover:bg-slate-50">Mon compte</Link>
              {user?.role === "owner" && <Link to="/settings" onClick={() => setUserOpen(false)} className="block rounded-xl px-3 py-2.5 text-sm font-semibold hover:bg-slate-50">Paramètres</Link>}
              {user?.role === "owner" && <Link to="/signup" className="block rounded-xl px-3 py-2.5 text-sm font-semibold hover:bg-slate-50">Ajouter un utilisateur</Link>}
              <button onClick={async () => { await logout(); navigate("/login", { replace: true }); }} className="w-full rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-red-600 hover:bg-red-50">Se déconnecter</button>
            </div>}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] p-4 sm:p-6 lg:p-8"><Outlet/></main>
      <ReceiptHost/>
    </div>
    <Toaster/>
  </div>;
}
