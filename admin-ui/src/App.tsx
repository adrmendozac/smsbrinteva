import { useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { isAuthenticated, clearToken } from "./lib/auth";
import { api } from "./lib/api";
import { countContacts, type Campaign, type Contact, type ContactCounts } from "./types";
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
  const [directory, setDirectory] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contactCounts, setContactCounts] = useState<ContactCounts | null>(null);

  // Load the audience on login, then refresh it silently each time the compose
  // tab is shown — so a contact archived over in Contactos drops out of
  // Mensajes masivos without a full reload.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (!authed) return;
    if (!firstLoad.current && tab !== "compose") return;
    const spin = firstLoad.current;
    if (spin) setLoadingContacts(true);
    // The whole directory rather than GET /api/contacts: the rail shows the
    // opted-out count on every tab, and the sendable audience is a filter over
    // this, so one request serves both.
    api
      .getAllContacts()
      .then((all) => {
        setDirectory(all);
        setContactCounts(countContacts(all));
      })
      .catch(() => setDirectory([]))
      .finally(() => {
        if (spin) setLoadingContacts(false);
        firstLoad.current = false;
      });
  }, [authed, tab]);

  // The same rule the backend applies at send time: opted in and not archived.
  const audience = useMemo(
    () => directory.filter((c) => !c.archived_at && c.opted_in !== false),
    [directory]
  );

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
            contacts={audience}
            campaigns={campaigns}
            contactCounts={contactCounts}
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
                <Composer contacts={audience} onCreated={onCreated} />
              )
            ) : tab === "contacts" ? (
              <Contacts onCounts={setContactCounts} />
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
  contactCounts,
}: {
  tab: Tab;
  contacts: Contact[];
  campaigns: Campaign[];
  contactCounts: ContactCounts | null;
}) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      // A plain query, not gsap.matchMedia(): this effect re-runs on every tab
      // change, and each matchMedia() context was left unreverted.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const kids = root.current!.children;
      // fromTo, not from: from() animates towards whatever value the element
      // currently holds, so switching tabs inside this ~1.3s tween made the new
      // tween's destination the partial opacity it interrupted. Three quick
      // switches and the heading ratcheted down to nearly invisible.
      gsap.fromTo(
        kids,
        { y: 24, autoAlpha: 0 },
        {
          y: 0,
          autoAlpha: 1,
          duration: 1,
          ease: "mass",
          stagger: 0.1,
          overwrite: "auto",
          // Promote to a compositor layer for the tween only, then release it —
          // a permanent will-change would keep every heading on its own layer.
          // Cleared on interrupt too, since overwrite means onComplete may never
          // fire and the hint would be left on for good.
          onStart: () => gsap.set(kids, { willChange: "transform, opacity" }),
          onComplete: () => gsap.set(kids, { clearProps: "willChange" }),
          onInterrupt: () => gsap.set(kids, { clearProps: "willChange" }),
        }
      );
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

      <dl className="mt-8 flex flex-wrap justify-center gap-6 sm:gap-8 md:justify-start">
        <div>
          <dt className="text-xs text-[var(--text-muted)]">
            {tab === "history" ? "Campañas" : "Reciben mensajes"}
          </dt>
          <dd className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
            {tab === "history"
              ? campaigns.length
              : (contactCounts?.reachable ?? contacts.length)}
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
        {/* The other half of the partition: these two sum to the active total and
            mean the same thing on Envío and on Contactos, so neither number
            depends on which tab you are looking at. */}
        {tab !== "history" && contactCounts && (
          <div>
            <dt className="text-xs text-[var(--text-muted)]">No reciben mensajes</dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-[var(--brand)]">
              {contactCounts.optedOut}
            </dd>
          </div>
        )}
        {/* Archived only on Contactos, the one screen where they can be acted
            on. With this the three numbers account for every contact. */}
        {tab === "contacts" && contactCounts && (
          <div>
            <dt className="text-xs text-[var(--text-muted)]">Archivados</dt>
            <dd className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-[var(--text-muted)]">
              {contactCounts.archived}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
