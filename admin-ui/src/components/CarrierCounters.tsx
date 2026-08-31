import attLogo from "../assets/carriers/att.svg";
import tMobileLogo from "../assets/carriers/t-mobile.svg";
import verizonLogo from "../assets/carriers/verizon.svg";
import type { CarrierTally } from "../lib/carriers";

const carriers = [
  { key: "att", name: "AT&T", logo: attLogo, logoClass: "h-7 w-7" },
  { key: "tmobile", name: "T-Mobile", logo: tMobileLogo, logoClass: "h-7 w-7 rounded-md" },
  { key: "verizon", name: "Verizon", logo: verizonLogo, logoClass: "h-5 w-[5.5rem]" },
] as const;

/**
 * Carrier split of the selected audience.
 *
 * T-Mobile is called out because it is the binding constraint: 2.000 SMS/día
 * for the whole brand, against AT&T's 75/min and no published daily figure for
 * anyone else. A campaign's T-Mobile share is what decides whether it finishes
 * today or spills across several days.
 *
 * Contacts without a fresh, usable lookup are shown separately rather than
 * folded into a carrier. The send engine budgets them as T-Mobile, and the UI
 * uses the same conservative rule.
 */
export function CarrierCounters({
  tally,
  whole = false,
}: {
  tally: CarrierTally;
  // True when nothing is picked yet and the tally covers the whole opted-in
  // book rather than a chosen audience — the caption has to say which.
  whole?: boolean;
}) {
  const resolved = tally.tmobile + tally.att + tally.verizon + tally.other;
  const total = resolved + tally.unknown;
  // Nothing resolved at all means the backfill has not run yet, which is a
  // different situation from a partly-resolved book and needs saying plainly.
  const noneResolved = total > 0 && resolved === 0;

  return (
    <section aria-labelledby="carrier-counters-title" className="pt-2">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 id="carrier-counters-title" className="pt-5 font-satoshi text-base font-semibold">
            Distribución por operador
          </h3>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            {total === 0
              ? "Selecciona destinatarios para ver su operador."
              : noneResolved
              ? "Aún sin datos válidos de operador — todos se cuentan como T-Mobile."
              : tally.unknown > 0
              ? `${tally.unknown.toLocaleString("es-MX")} sin datos válidos de operador — se cuentan como T-Mobile.`
              : whole
              ? "Toda la lista. T-Mobile marca el límite diario de la campaña."
              : "T-Mobile marca el límite diario de la campaña."}
          </p>
        </div>
        {/* Carriers outside the big three are a rounding error in this book (two
            Dish numbers out of 1,126) and are not what the panel is for: the
            question it answers is how much of the audience sits behind
            T-Mobile's daily cap. They still send normally and still draw from
            the 'other' throughput bucket — they are simply not shown. */}
      </div>

      <dl className="mt-3 grid overflow-hidden rounded-xl bg-[var(--surface-sunken)] sm:grid-cols-3">
        {carriers.map((carrier, index) => {
          const n = tally[carrier.key];
          return (
            <div
              key={carrier.name}
              className={`flex min-w-0 items-center gap-3 px-4 py-3.5 ${
                index > 0
                  ? "border-t border-[var(--hairline)] sm:border-t-0 sm:border-l"
                  : ""
              }`}
            >
              <div className="flex h-9 w-24 shrink-0 items-center justify-start">
                <img
                  src={carrier.logo}
                  alt={`${carrier.name}`}
                  className={`${carrier.logoClass} object-contain object-left`}
                />
              </div>
              <div className="ml-auto text-right">
                <dt className="sr-only">Destinatarios de {carrier.name}</dt>
                <dd
                  className={`font-satoshi text-2xl font-semibold tabular-nums tracking-tight ${
                    total === 0
                      ? "text-[var(--text-muted)]"
                      : carrier.key === "tmobile" && n > 0
                      ? "text-[var(--status-paused)]"
                      : ""
                  }`}
                >
                  {total === 0 ? "—" : n.toLocaleString("es-MX")}
                </dd>
              </div>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
