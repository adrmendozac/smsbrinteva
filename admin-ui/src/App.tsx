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
import { cn } from "./lib/cn";
import { Eyebrow, Spinner } from "./components/ui";

export default function App() {
  const [authed, setAuthed] = useState(isAuthenticated());
  const [tab, setTab] = useState<Tab>("compose");
  const [directory, setDirectory] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [contactCounts, setContactCounts] = useState<ContactCounts | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [pricePerSegment, setPricePerSegment] = useState<string | null>(null);
  // Distinct from balance/pricePerSegment being null while still loading: this
  // flips true only once the request has actually failed, so the Rail and
  // Composer can say so explicitly instead of the widget just never appearing.
  const [balanceError, setBalanceError] = useState(false);
  const [preselectContactId, setPreselectContactId] = useState<number | null>(null);

  // Fetched once on login, not per-tab: this is Vonage's account balance and
  // per-segment SMS price, not something that changes from clicking around
  // the admin UI. Both feed the Rail's balance stat and the Composer's cost flair.
  useEffect(() => {
    if (!authed) return;
    api
      .getBalance()
      .then((b) => {
        setBalance(b.balance);
        setPricePerSegment(b.pricePerSegment);
        setBalanceError(false);
      })
      .catch(() => {
        setBalance(null);
        setPricePerSegment(null);
        setBalanceError(true);
      });
  }, [authed]);

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
    // flex-col + the footer as a flex-1 sibling of main (not a child) is what
    // lets it sit flush with the viewport bottom on short pages instead of
    // floating up under the content, while still scrolling away normally once
    // main's content outgrows the viewport.
    <div className="flex min-h-full flex-col overflow-x-clip">
      <Header tab={tab} onTab={setTab} onLogout={logout} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-12 pb-24 sm:pt-16">
        <div className="grid gap-10 md:grid-cols-12 md:gap-12">
          <Rail
            tab={tab}
            contacts={audience}
            campaigns={campaigns}
            contactCounts={contactCounts}
            balance={balance}
            balanceError={balanceError}
          />

          {/* min-w-0: grid items default to min-width:auto and refuse to shrink
              below their content's intrinsic width, which is what let the
              Contactos card push the page wider. */}
          <div className="min-w-0 md:col-span-7 lg:col-span-8">
            <div className={cn(tab !== "compose" && "hidden")}>
              {loadingContacts ? (
                <div className="flex justify-center py-16 text-[var(--text-muted)]">
                  <Spinner />
                </div>
              ) : (
                <Composer
                  contacts={audience}
                  onCreated={onCreated}
                  balance={balance}
                  pricePerSegment={pricePerSegment}
                  balanceError={balanceError}
                  preselectContactId={preselectContactId}
                  onConsumePreselect={() => setPreselectContactId(null)}
                />
              )}
            </div>
            <div className={cn(tab !== "contacts" && "hidden")}>
              <Contacts
                onCounts={setContactCounts}
                onSendSms={(id) => {
                  setPreselectContactId(id);
                  setTab("compose");
                }}
              />
            </div>
            <div className={cn(tab !== "history" && "hidden")}>
              <History
                refreshSignal={refreshSignal}
                onLoaded={setCampaigns}
                pricePerSegment={pricePerSegment}
              />
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

/**
 * Editorial-split left rail: the section's identity in large type, plus the one
 * number that matters for the current view. Sticky on desktop so context stays
 * put while the work surface scrolls; collapses above the content on mobile.
 */
// Below this, the balance reads as a warning rather than plain info — cheap
// enough to hit fast on a multi-hundred-recipient campaign like the one that
// prompted adding this in the first place.
const LOW_BALANCE_USD = 10;

function Rail({
  tab,
  contacts,
  campaigns,
  contactCounts,
  balance,
  balanceError,
}: {
  tab: Tab;
  contacts: Contact[];
  campaigns: Campaign[];
  contactCounts: ContactCounts | null;
  balance: string | null;
  balanceError: boolean;
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
        {tab === "compose" && balanceError && (
          <div>
            <dt className="text-xs text-[var(--text-muted)]">Saldo Vonage</dt>
            <dd className="mt-1 text-sm text-[var(--status-failed)]">
              No se pudo cargar el saldo
            </dd>
          </div>
        )}
        {tab === "compose" && balance !== null && (
          <div>
            <dt className="text-xs text-[var(--text-muted)]">Saldo Vonage</dt>
            <dd
              className="mt-1 text-3xl font-semibold tabular-nums tracking-tight"
              style={{
                color:
                  Number(balance) < LOW_BALANCE_USD
                    ? "var(--status-failed)"
                    : "var(--brand)",
              }}
            >
              ${Number(balance).toFixed(2)}
            </dd>
            {Number(balance) < LOW_BALANCE_USD && (
              <p className="mt-1 text-xs text-[var(--status-failed)]">
                recordar a adrian agregar mas saldo
              </p>
            )}
          </div>
        )}
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
