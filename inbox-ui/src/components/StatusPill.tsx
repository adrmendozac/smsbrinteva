import type { ConversationStatus } from "../types";

const META: Record<ConversationStatus, { label: string; var: string }> = {
  ai_handling: { label: "IA activa", var: "--status-ai" },
  needs_human: { label: "Necesita agente", var: "--status-needs-human" },
  open: { label: "Abierto", var: "--status-open" },
  resolved: { label: "Resuelto", var: "--status-resolved" },
};

export function StatusPill({ status }: { status: ConversationStatus }) {
  const { label, var: colorVar } = META[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none"
      style={{
        color: `var(${colorVar})`,
        background: `color-mix(in srgb, var(${colorVar}) 14%, transparent)`,
      }}
    >
      <span
        className="size-1.5 rounded-full"
        style={{ background: `var(${colorVar})` }}
        aria-hidden
      />
      {label}
    </span>
  );
}
