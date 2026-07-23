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
import { Contacts } from "./components/Contacts";
import { Footer } from "./components/Footer";
import { Eyebrow, Spinner } from "./components/ui";

export default function App() {
  const [authed, setAuthed] = useState(isAuthenticated());
  const [tab, setTab] = useState<Tab>("compose");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contactTotal, setContactTotal] = useState<number | null>(null);

  // Load the audience on login, then refresh it silently each time the compose
  // tab is shown — so a contact archived over in Contactos drops out of
  // Mensajes masivos without a full reload.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (!authed) return;
    if (!firstLoad.current && tab !== "compose") return;
    const spin = firstLoad.current;
    if (spin) setLoadingContacts(true);
    api
      .getContacts()
      .then(setContacts)
      .catch(() => setContacts([]))
      .finally(() => {
        if (spin) setLoadingContacts(false);
        firstLoad.current = false;
      });
  }, [authed, tab]);

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
    // overflow-x-clip is a page-level guard against any child forcing the
    // viewport wider (which shows up as a must-zoom-out horizontal scroll). clip
    // — unlike hidden — does not create a scroll container, so the sticky header
    // and sticky rail keep working.
    <div className="min-h-full overflow-x-clip">
      <Header tab={tab} onTab={setTab} onLogout={logout} />

      <main className="mx-auto max-w-6xl px-4 pt-12 pb-24 sm:pt-16">
        <div className="grid gap-10 md:grid-cols-12 md:gap-12">
          <Rail
            tab={tab}
            contacts={contacts}
            campaigns={campaigns}
            contactTotal={contactTotal}
          />

          {/* min-w-0: grid items default to min-width:auto and refuse to shrink
              below their content's intrinsic width, which is what let the
              Contactos card push the page wider. */}
          <div className="min-w-0 md:col-span-7 lg:col-span-8">
            {tab === "compose" ? (
              loadingContacts ? (
                <div className="flex justify-center py-16 text-[var(--text-muted)]">
                  <Spinner />
                </div>
              ) : (
                <Composer contacts={contacts} onCreated={onCreated} />
              )
            ) : tab === "contacts" ? (
              <Contacts onCount={setContactTotal} />
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
  contactTotal,
}: {
  tab: Tab;
  contacts: Contact[];
  campaigns: Campaign[];
  contactTotal: number | null;
}) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
        const kids = root.current!.children;
        gsap.from(kids, {
          y: 24,
          autoAlpha: 0,
          duration: 1,
          ease: "mass",
          stagger: 0.1,
          // Promote to a compositor layer for the tween only, then release it —
          // a permanent will-change would keep every heading on its own layer.
          onStart: () => gsap.set(kids, { willChange: "transform, opacity" }),
          onComplete: () => gsap.set(kids, { clearProps: "willChange" }),
        });
      });
    },
    { dependencies: [tab], scope: root }
  );

  const sent = campaigns.reduce((n, c) => n + (c.sent_count ?? 0), 0);

  const copy = {
    compose: { eyebrow: "Envío", title: ["Escribe", "una campaña"] },
    contacts: { eyebrow: "Directorio", title: ["Tus", "contactos"] },
    history: { eyebrow: "Registro", title: ["Todo lo", "que enviaste"] },
  }[tab];

  return (
    // Centred on mobile where the rail sits above the work surface as a header;
    // left-aligned from md: up, where it becomes a true editorial column.
    <div
      ref={root}
      className="min-w-0 text-center md:col-span-5 md:sticky md:top-28 md:self-start md:text-left lg:col-span-4"
    >
      <Eyebrow>{copy.eyebrow}</Eyebrow>

      <h1 className="mt-5 text-pretty text-4xl font-semibold leading-[0.95] tracking-[-0.03em] sm:text-5xl lg:text-6xl">
        {copy.title[0]}
        <br />
        {copy.title[1]}
      </h1>

      <dl className="mt-8 flex justify-center gap-8 md:justify-start">
        <div>
          <dt className="text-xs text-[var(--text-muted)]">
            {tab === "history" ? "Campañas" : "Contactos"}
          </dt>
          <dd className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
            {tab === "history"
              ? campaigns.length
              : tab === "contacts"
                ? (contactTotal ?? contacts.length)
                : contacts.length}
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
