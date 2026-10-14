import { useEffect, useState, type ReactNode, type SVGProps } from "react";

export type IconName =
  | "dashboard" | "orders" | "clients" | "stock" | "expenses" | "cash"
  | "search" | "calendar" | "plus" | "bell" | "chevron" | "arrowUp"
  | "arrowDown" | "wallet" | "box" | "receipt" | "more" | "printer"
  | "edit" | "trash" | "menu" | "close" | "filter" | "download" | "banner" | "settings";

const iconPaths: Record<IconName, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  orders: <><path d="M3 4h2l2.2 10.1a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L20 8H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></>,
  clients: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></>,
  stock: <><path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="m3 8 9 5v9l9-5V8"/><path d="m3 13 9 5 9-5"/></>,
  expenses: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/></>,
  cash: <><path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v10a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6"/><path d="M16 14h.01"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  arrowUp: <><path d="m18 15-6-6-6 6"/><path d="M12 9v12"/></>,
  arrowDown: <><path d="m6 9 6 6 6-6"/><path d="M12 3v12"/></>,
  wallet: <><path d="M20 7V5H5a3 3 0 0 0 0 6h15v8H5a3 3 0 0 1-3-3V6"/><path d="M16 15h.01"/></>,
  box: <><path d="m21 8-9-5-9 5 9 5 9-5Z"/><path d="m3 8 9 5v9l9-5V8"/></>,
  receipt: <><path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z"/><path d="M9 8h6M9 12h6M9 16h3"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  printer: <><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></>,
  edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></>,
  trash: <><path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/></>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  filter: <path d="M4 5h16l-6 7v6l-4 2v-8Z"/>,
  download: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/></>,
  banner: <><rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M7 7v3M11 7v2M15 7v3M19 7v2"/></>,
  settings: <><path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h12M20 18h0"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></>,
};

export function Icon({ name, className = "h-5 w-5", ...props }: { name: IconName; className?: string } & SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>{iconPaths[name]}</svg>;
}


export function Button({ children, variant = "primary", icon, onClick, className = "", type = "button", disabled = false, title }: { children?: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger"; icon?: IconName; onClick?: () => void; className?: string; type?: "button" | "submit"; disabled?: boolean; title?: string }) {
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-600/20",
    secondary: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    ghost: "text-slate-500 hover:bg-slate-100 hover:text-slate-900",
    danger: "bg-red-50 text-red-600 hover:bg-red-100",
  };
  return <button type={type} title={title} disabled={disabled} onClick={onClick} className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl ${/\bp-0\b/.test(className) ? "" : "px-4"} text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}>{icon && <Icon name={icon} className="h-4 w-4"/>}{children}</button>;
}

const STATUS_LABEL: Record<string, string> = { Paid: "Payé", Partial: "Partiel", Unpaid: "Impayé", ok: "À jour", debt: "Dette en cours", overdue: "En retard" };
export function Badge({ status }: { status: string }) {
  const tone = status === "Paid" || status === "ok" ? "bg-emerald-50 text-emerald-700 ring-emerald-600/10"
    : status === "Partial" || status === "debt" ? "bg-amber-50 text-amber-700 ring-amber-600/10"
    : "bg-red-50 text-red-700 ring-red-600/10";
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tone}`}><span className="h-1.5 w-1.5 rounded-full bg-current"/>{STATUS_LABEL[status] ?? status}</span>;
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-2xl font-bold tracking-tight text-slate-950">{title}</p><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>{action}</div>;
}

export function SearchField({ placeholder = "Rechercher...", value, onChange }: { placeholder?: string; value?: string; onChange?: (value: string) => void }) {
  return <label className="relative block"><Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"/><input value={value} onChange={e => onChange?.(e.target.value)} className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100" placeholder={placeholder}/></label>;
}

export function SelectField({ children, value, onChange, className = "" }: { children: ReactNode; value?: string; onChange?: (value: string) => void; className?: string }) {
  return <select value={value} onChange={(e) => onChange?.(e.target.value)} className={`h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100 ${className}`}>{children}</select>;
}

export function KpiCard({ title, value, detail, trendValue, goodWhen = "up", icon, tone = "blue" }: { title: string; value: string; detail?: string; trendValue?: number | null; goodWhen?: "up" | "down"; icon: IconName; tone?: "blue" | "green" | "orange" | "red" }) {
  const tones = { blue: "bg-blue-50 text-blue-600", green: "bg-emerald-50 text-emerald-600", orange: "bg-amber-50 text-amber-600", red: "bg-red-50 text-red-600" };
  const hasTrend = trendValue !== null && trendValue !== undefined;
  const up = (trendValue ?? 0) >= 0;
  const good = up === (goodWhen === "up");
  return <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/40 transition hover:-translate-y-0.5 hover:shadow-md">
    <div className="flex items-start justify-between"><div className={`rounded-xl p-2.5 ${tones[tone]}`}><Icon name={icon} className="h-5 w-5"/></div></div>
    <p className="mt-5 text-sm font-medium text-slate-500">{title}</p><p className="mt-1 font-mono text-2xl font-bold tracking-tight text-slate-950">{value}</p>
    <div className="mt-3 flex items-center gap-2 text-xs">{hasTrend && <span className={`inline-flex items-center gap-1 font-bold ${good ? "text-emerald-600" : "text-red-600"}`}><Icon name={up ? "arrowUp" : "arrowDown"} className="h-3 w-3"/>{Math.abs(trendValue!).toLocaleString("fr-FR")}%</span>}{detail && <span className="text-slate-400">{detail}</span>}</div>
  </div>;
}


export function Drawer({ title, eyebrow = "Fiche client", onClose, children }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30 backdrop-blur-sm" onClick={onClose}><aside className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl" onClick={e=>e.stopPropagation()}><div className="mb-8 flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-wider text-blue-600">{eyebrow}</p><p className="mt-1 text-xl font-bold text-slate-950">{title}</p></div><Button variant="ghost" icon="close" className="h-9 w-9 p-0" onClick={onClose}/></div>{children}</aside></div>;
}


// ---- app-wide events: toast + "data changed" (pages refetch) ----
export function notify(message: string) {
  window.dispatchEvent(new CustomEvent("ims-notify", { detail: message }));
}
export function notifyChange() {
  window.dispatchEvent(new CustomEvent("ims-data-changed"));
}

export function Toaster() {
  const [toast, setToast] = useState("");
  useEffect(() => {
    let timer: number | undefined;
    const handle = (e: Event) => {
      setToast((e as CustomEvent<string>).detail);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setToast(""), 3500);
    };
    window.addEventListener("ims-notify", handle);
    return () => { window.removeEventListener("ims-notify", handle); window.clearTimeout(timer); };
  }, []);
  if (!toast) return null;
  return <div role="status" className="fixed bottom-5 right-5 z-[80] flex max-w-sm items-center gap-3 rounded-2xl bg-slate-950 px-5 py-4 text-sm font-semibold text-white shadow-2xl"><span className="grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-xs">✓</span>{toast}</div>;
}

// ---- shared form bits ----
export const inputCls = "mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-100";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block text-xs font-semibold text-slate-500">{label}{children}{hint && <span className="mt-1 block text-[11px] font-normal text-slate-400">{hint}</span>}</label>;
}

export function ErrorNote({ message }: { message: string }) {
  return message ? <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{message}</p> : null;
}

export function Modal({ title, eyebrow = "Saisie rapide", onClose, children, footer, wide = false }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onClick={onClose}>
    <div role="dialog" aria-modal="true" className={`max-h-[92vh] w-full ${wide ? "max-w-2xl" : "max-w-md"} overflow-y-auto rounded-3xl bg-white shadow-2xl`} onClick={e => e.stopPropagation()}>
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-6 py-5 backdrop-blur"><div><p className="text-xs font-bold uppercase tracking-wider text-blue-600">{eyebrow}</p><p className="mt-1 text-xl font-bold text-slate-950">{title}</p></div><Button variant="ghost" icon="close" className="h-9 w-9 p-0" onClick={onClose}/></div>
      <div className="space-y-4 p-6">{children}</div>
      {footer && <div className="flex justify-end gap-3 border-t border-slate-100 px-6 py-4">{footer}</div>}
    </div>
  </div>;
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return <tr><td colSpan={colSpan} className="px-5 py-10 text-center text-sm text-slate-400">{children}</td></tr>;
}
