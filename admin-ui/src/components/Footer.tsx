import { ChatCircleDots } from "@phosphor-icons/react";
import logo from "../assets/brinteva-logo.png";
import { ButtonLink } from "./ui";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-10 border-t border-[var(--border)] pt-6 pb-10">
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
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

        <ButtonLink href="https://nicollbrintevaworlds.kommo.com/chats/">
          <ChatCircleDots size={16} weight="light" aria-hidden="true" />
          Abrir Kommo
        </ButtonLink>
      </div>
    </footer>
  );
}
