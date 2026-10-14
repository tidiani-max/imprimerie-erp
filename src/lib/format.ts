const nf = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfInt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

/** 3840 -> "3 840,00" */
export const money = (n: number | null | undefined) => nf.format(n ?? 0);
/** 24 -> "24", 1160 -> "1 160" (quantities, no forced decimals) */
export const num = (n: number | null | undefined) => nfInt.format(n ?? 0);
// The currency label comes from Paramètres (FCFA, DH, €…); set once the settings are loaded.
let currency = "DH";
export const setCurrency = (c: string | null | undefined) => { currency = (c ?? "").trim() || "DH"; };
export const cur = () => currency;
export const dh = (n: number | null | undefined) => `${money(n)} ${currency}`;

/** 'YYYY-MM-DD' (DATE columns) -> local Date without timezone shifting */
export const parseDay = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
};
export const fmtDay = (s: string | null | undefined) =>
  s ? parseDay(s).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "—";
export const fmtShortDay = (s: string) => parseDay(s).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
export const fmtDateTime = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}, ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
};
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("") || "?";
export const roleLabel = (r: string) => (r === "owner" ? "Propriétaire" : "Employé");
