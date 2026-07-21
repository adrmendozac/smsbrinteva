import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { isAuthenticated, clearToken } from "./lib/auth";
import { api } from "./lib/api";
import type { Campaign, Contact } from "./types";
import { Login } from "./components/Login";
import { Header, type Tab } from "./components/Header";
import { Composer } from "./components/Composer";
import { History } from "./components/History";
import { Footer } from "./components/Footer";
import { Eyebrow, Spinner } from "./components/ui";

export default function App() {
  const [authed, setAuthed] = useState(isAuthenticated());
  const [tab, setTab] = useState<Tab>("compose");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    if (!authed) return;
    setLoadingContacts(true);
    api
      .getContacts()
      .then(setContacts)
      .catch(() => setContacts([]))
      .finally(() => setLoadingContacts(false));
  }, [authed]);

  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;

  function logout() {
    clearToken();
    setAuthed(false);
  }

  function onCreated() {
    setRefreshSignal((s) => s + 1);
    setTab("history");
  }

  return (
    <div className="min-h-full">
      <Header tab={tab} onTab={setTab} onLogout={logout} />

      <main className="mx-auto max-w-6xl px-4 pt-12 pb-24 sm:pt-16">
        <div className="grid gap-10 md:grid-cols-12 md:gap-12">
          <Rail tab={tab} contacts={contacts} campaigns={campaigns} />

          <div className="md:col-span-7 lg:col-span-8">
            {tab === "compose" ? (
              loadingContacts ? (
                <div className="flex justify-center py-16 text-[var(--text-muted)]">
                  <Spinner />
                </div>
              ) : (
                <Composer contacts={contacts} onCreated={onCreated} />
              )
            ) : (
              <History refreshSignal={refreshSignal} onLoaded={setCampaigns} />
            )}
          </div>
        </div>

        <Footer />
      </main>
    </div>
  );
}

/**
 * Editorial-split left rail: the section's identity in large type, plus the one
 * number that matters for the current view. Sticky on desktop so context stays
 * put while the work surface scrolls; collapses above the content on mobile.
 */
function Rail({
  tab,
  contacts,
  campaigns,
}: {
  tab: Tab;
  contacts: Contact[];
  campaigns: Campaign[];
}) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(root.current!.children, {
          y: 24,
          opacity: 0,
          duration: 0.8,
          ease: "mass",
          stagger: 0.08,
        });
      });
    },
    { dependencies: [tab], scope: root }
  );

  const sent = campaigns.reduce((n, c) => n + (c.sent_count ?? 0), 0);

  return (
    // Centred on mobile where the rail sits above the work surface as a header;
    // left-aligned from md: up, where it becomes a true editorial column.
    <div
      ref={root}
      className="text-center md:col-span-5 md:sticky md:top-28 md:self-start md:text-left lg:col-span-4"
    >
      <Eyebrow>{tab === "compose" ? "Envío" : "Registro"}</Eyebrow>

      <h1 className="mt-5 text-pretty text-4xl font-semibold leading-[0.95] tracking-[-0.03em] sm:text-5xl lg:text-6xl">
        {tab === "compose" ? (
          <>
            Escribe
            <br />
            una campaña
          </>
        ) : (
          <>
            Todo lo
            <br />
            que enviaste
          </>
        )}
      </h1>

      <dl className="mt-8 flex justify-center gap-8 md:justify-start">
        <div>
          <dt className="text-xs text-[var(--text-muted)]">
            {tab === "compose" ? "Contactos" : "Campañas"}
          </dt>
          <dd className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
            {tab === "compose" ? contacts.length : campaigns.length}
          </dd>
        </div>
        {tab === "history" && (
          <div>
            <dt className="text-xs text-[var(--text-muted)]">Mensajes enviados</dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-[var(--brand)]">
              {sent}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
