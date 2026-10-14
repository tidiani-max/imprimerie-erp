import { useState } from "react";
import { api, qs } from "../lib/api";
import { Button, notify } from "./ui";

/** Downloads an Excel (.xlsx) file from /api/export/<kind>.xlsx with the same filters as the screen. */
export default function ExportButton({ kind, params, label = "Exporter Excel" }: { kind: string; params?: Record<string, string | number | boolean | null | undefined>; label?: string }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { notify(`Fichier Excel téléchargé : ${await api.download(`/export/${kind}.xlsx${qs(params ?? {})}`)}`); }
    catch (e) { notify(e instanceof Error ? e.message : "Export impossible"); }
    finally { setBusy(false); }
  };
  return <Button variant="secondary" icon="download" disabled={busy} onClick={run}>{busy ? "Export…" : label}</Button>;
}
