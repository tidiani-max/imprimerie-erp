import type { ReactNode } from "react";
import { Icon } from "../components/ui";

export default function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return <div className="grid min-h-screen bg-slate-50 lg:grid-cols-[1.05fr_1fr]">
    <aside className="relative hidden flex-col justify-between overflow-hidden bg-slate-950 p-12 text-white lg:flex">
      <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-blue-600/20 blur-3xl"/>
      <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-violet-600/10 blur-3xl"/>
      <div className="relative flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-blue-600 shadow-lg shadow-blue-600/30"><Icon name="printer" className="h-5 w-5"/></div><div><p className="text-lg font-bold tracking-tight">Imprimerie<span className="text-blue-400">.</span></p><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">Management system</p></div></div>
      <div className="relative max-w-md"><p className="text-3xl font-bold leading-tight tracking-tight">Commandes, stock, dettes et caisse — au même endroit.</p><p className="mt-4 text-sm leading-relaxed text-slate-400">Chaque vente met à jour automatiquement le stock de matières, la dette du client et la caisse. Vos données restent sur votre ordinateur.</p></div>
      <p className="relative text-xs text-slate-600">© Imprimerie ERP</p>
    </aside>
    <main className="flex items-center justify-center p-6 sm:p-10">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3 lg:hidden"><div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white"><Icon name="printer" className="h-5 w-5"/></div><p className="font-bold text-slate-950">Imprimerie<span className="text-blue-600">.</span></p></div>
        <p className="text-2xl font-bold tracking-tight text-slate-950">{title}</p>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        <div className="mt-8">{children}</div>
        {footer && <div className="mt-6 text-center text-sm text-slate-500">{footer}</div>}
      </div>
    </main>
  </div>;
}
