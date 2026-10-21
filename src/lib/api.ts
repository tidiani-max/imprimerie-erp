export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${url}`, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Serveur injoignable. Vérifiez que l'application est bien démarrée.", "NETWORK");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Expired / invalid session on a data route -> let the auth context send the user to /login.
    if (res.status === 401 && !url.startsWith("/auth/")) window.dispatchEvent(new CustomEvent("ims-auth-expired"));
    throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`, data.code);
  }
  return data as T;
}

export const api = {
  get: <T,>(url: string) => request<T>("GET", url),
  post: <T,>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T,>(url: string, body: unknown) => request<T>("PUT", url, body),
  patch: <T,>(url: string, body: unknown) => request<T>("PATCH", url, body),
  delete: <T,>(url: string) => request<T>("DELETE", url),
  /** Downloads a file (e.g. an Excel export) with the current session. Returns the file name. */
  async download(url: string): Promise<string> {
    let res: Response;
    try { res = await fetch(`/api${url}`, { credentials: "same-origin" }); }
    catch { throw new ApiError(0, "Serveur injoignable. Vérifiez que l'application est bien démarrée.", "NETWORK"); }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) window.dispatchEvent(new CustomEvent("ims-auth-expired"));
      throw new ApiError(res.status, data.error ?? `Erreur ${res.status}`, data.code);
    }
    const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "export.xlsx";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(await res.blob());
    link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    return name;
  },
};

export const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== false) s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
};
