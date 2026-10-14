import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Loads data and refetches when `deps` change or when any mutation fires "ims-data-changed".
 * Keeps showing previous data while refetching (no flicker on every keystroke).
 */
export function useApi<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    try {
      const result = await loaderRef.current();
      if (id === seq.current) { setData(result); setError(""); }
    } catch (e) {
      if (id === seq.current) setError(e instanceof Error ? e.message : "Erreur de chargement");
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    window.addEventListener("ims-data-changed", reload);
    return () => window.removeEventListener("ims-data-changed", reload);
  }, [reload]);

  return { data, error, loading, reload };
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
