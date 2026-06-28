import { Phone, Translate, BellSlash, BellRinging } from "@phosphor-icons/react";
import { useInboxStore } from "../store/useInboxStore";
import { StatusPill } from "./StatusPill";

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <span className="mt-0.5 text-[var(--text-muted)]">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
          {label}
        </p>
        <div className="mt-0.5 text-sm text-[var(--text-primary)]">{children}</div>
      </div>
    </div>
  );
}

export function ContactPanel() {
  const { selectedId, conversations, contacts, messages } = useInboxStore();
  const conversation = conversations.find((c) => c.id === selectedId);
  const contact = contacts.find((c) => c.id === conversation?.contactId);

  if (!conversation || !contact) {
    return (
      <aside className="hidden h-full border-l border-[var(--border)] bg-[var(--surface-elevated)] lg:block">
        <p className="px-4 py-6 text-center text-xs text-[var(--text-muted)]">
          Los detalles del contacto aparecen aquí.
        </p>
      </aside>
    );
  }

  const count = messages.filter((m) => m.conversationId === conversation.id).length;

  return (
    <aside className="hidden h-full flex-col border-l border-[var(--border)] bg-[var(--surface-elevated)] lg:flex">
      <div className="border-b border-[var(--border)] px-4 py-4">
        <p className="text-sm font-semibold text-[var(--text-primary)]">{contact.name}</p>
        <div className="mt-1">
          <StatusPill status={conversation.status} />
        </div>
      </div>

      <div className="divide-y divide-[var(--border)]">
        <Field icon={<Phone size={16} />} label="Número">
          <span className="font-mono">{contact.phone}</span>
        </Field>
        <Field icon={<Translate size={16} />} label="Idioma">
          {contact.language === "es" ? "Español" : "Inglés"}
        </Field>
        <Field
          icon={contact.optedIn ? <BellRinging size={16} /> : <BellSlash size={16} />}
          label="Suscripción"
        >
          <span style={{ color: contact.optedIn ? "var(--status-resolved)" : "var(--error)" }}>
            {contact.optedIn ? "Suscrito" : "Dado de baja"}
          </span>
        </Field>
        <Field icon={<span className="font-mono text-xs">#</span>} label="Mensajes">
          {count}
        </Field>
      </div>
    </aside>
  );
}
