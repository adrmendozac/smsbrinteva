import { ChatCircleDots } from "@phosphor-icons/react";

export function EmptyThread() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <ChatCircleDots size={40} weight="duotone" className="text-[var(--text-muted)]" />
      <div>
        <p className="text-sm font-medium text-[var(--text-primary)]">
          Ninguna conversación seleccionada
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Selecciona una conversación de la lista para ver el hilo.
        </p>
      </div>
    </div>
  );
}
