import { useState } from "react";
import { login } from "../lib/auth";
import { Button, inputClass } from "./ui";

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const ok = await login(pin.trim());
      if (ok) {
        onSuccess();
      } else {
        setError("PIN incorrecto.");
        setPin("");
      }
    } catch {
      setError("No se pudo conectar. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-8"
      >
        <div className="mb-6 text-center">
          <div className="text-lg font-semibold tracking-tight">
            Brinteva <span className="text-[var(--brand)]">Worlds</span>
          </div>
          <div className="mt-1 text-sm text-[var(--text-muted)]">
            Campañas SMS · Acceso administradores
          </div>
        </div>

        <input
          type="password"
          inputMode="numeric"
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          className={`${inputClass} text-center tracking-[0.5em]`}
          aria-label="PIN"
        />

        {error && (
          <p className="mt-3 text-center text-sm text-[var(--status-failed)]">
            {error}
          </p>
        )}

        <Button
          type="submit"
          loading={loading}
          disabled={!pin.trim()}
          className="mt-5 w-full"
        >
          Entrar
        </Button>
      </form>
    </div>
  );
}
