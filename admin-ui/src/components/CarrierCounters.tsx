import attLogo from "../assets/carriers/att.svg";
import tMobileLogo from "../assets/carriers/t-mobile.svg";
import verizonLogo from "../assets/carriers/verizon.svg";

const carriers = [
  { name: "AT&T", logo: attLogo, logoClass: "h-7 w-7" },
  { name: "T-Mobile", logo: tMobileLogo, logoClass: "h-7 w-7 rounded-md" },
  { name: "Verizon", logo: verizonLogo, logoClass: "h-5 w-[5.5rem]" },
] as const;

/**
 * Presentation-only carrier distribution. Counts intentionally remain blank
 * until the backend supplies verified Current Carrier results.
 */
export function CarrierCounters() {
  return (
    <section aria-labelledby="carrier-counters-title" className="pt-2">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 id="carrier-counters-title" className="pt-5 font-satoshi text-base font-semibold">
            Distribución por operador
          </h3>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Se mostrará al conectar los datos de operadores.
          </p>
        </div>
        <span className="shrink-0 text-[0.6875rem] font-medium tracking-wide text-[var(--text-muted)]">
          SIN CONECTAR
        </span>
      </div>

      <dl className="mt-3 grid overflow-hidden rounded-xl bg-[var(--surface-sunken)] sm:grid-cols-3">
        {carriers.map((carrier, index) => (
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
                aria-label="Dato pendiente"
                className="font-satoshi text-2xl font-semibold tabular-nums tracking-tight text-[var(--text-muted)]"
              >
                —
              </dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
