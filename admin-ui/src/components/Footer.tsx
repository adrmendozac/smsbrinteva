import { ChatCircleDots, ListMagnifyingGlass } from "@phosphor-icons/react";
import logo from "../assets/brinteva-logo.png";
import { Button, ButtonLink } from "./ui";

export function Footer({ onOpenLogs }: { onOpenLogs: () => void }) {
  const year = new Date().getFullYear();

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border)] bg-[var(--surface)] pt-6 pb-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-3">
          <img
            src={logo}
            alt=""
            width={40}
            height={40}
            loading="lazy"
            className="size-10 shrink-0"
          />
          <div className="text-xs text-[var(--text-muted)]">
            <p translate="no">Brinteva Worlds,&nbsp;Inc.</p>
            <p>
              © {year} Brinteva Worlds,&nbsp;Inc. Todos los derechos reservados.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button onClick={onOpenLogs}>
            <ListMagnifyingGlass size={16} weight="light" aria-hidden="true" />
            Ver registro
          </Button>

          <ButtonLink href="https://nicollbrintevaworlds.kommo.com/chats/">
            <ChatCircleDots size={16} weight="light" aria-hidden="true" />
            Abrir Kommo
          </ButtonLink>
        </div>
      </div>
    </footer>
  );
}
