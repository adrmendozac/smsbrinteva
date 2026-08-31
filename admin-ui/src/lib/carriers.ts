// Groups a contact using the same decision order as bucketFor() in
// lib/throughput.js. The UI keeps AT&T and Verizon as distinct display brands,
// but every uncertain row stays "unknown" so it remains part of the strict
// T-Mobile-plus-unknown estimate in Composer.

export type CarrierBrand = "tmobile" | "att" | "verizon" | "other" | "unknown";

// Kept in sync with TMOBILE_NAME in lib/throughput.js — these share one
// throughput allowance, so they are one bar in the UI.
const TMOBILE = /t-?mobile|sprint|metro ?pcs|mint mobile|ultra mobile|google fi/i;
const ATT = /at&t|cingular/i;
const VERIZON = /verizon/i;
const NON_MOBILE = "NON_MOBILE";
const INVALID = "INVALID";
const CARRIER_TTL_MS = 90 * 86_400_000;

// The same production-observed legacy codes as KNOWN_CODES in
// lib/throughput.js. Without a stored name the backend only trusts these three;
// the two loose-bucket codes stay "other" because the fallback promises a
// bucket, not a display brand.
const LEGACY_BUCKETS: Record<string, "tmobile" | "other"> = {
  "310260": "tmobile",
  "310090": "other",
  "310004": "other",
};

export interface CarrierFields {
  carrier_network_code?: string | null;
  carrier_name?: string | null;
  carrier_checked_at?: string | null;
}

export function carrierBrand(
  contact: CarrierFields | null | undefined,
  now = new Date(),
): CarrierBrand {
  if (!contact) return "unknown";

  const code = contact.carrier_network_code;
  if (!code || code === NON_MOBILE || code === INVALID) return "unknown";

  const checkedAt = contact.carrier_checked_at
    ? new Date(contact.carrier_checked_at)
    : null;
  if (!checkedAt || Number.isNaN(checkedAt.getTime())) return "unknown";
  if (now.getTime() - checkedAt.getTime() > CARRIER_TTL_MS) return "unknown";

  const name = contact.carrier_name;
  if (!name) return LEGACY_BUCKETS[code] ?? "unknown";
  if (TMOBILE.test(name)) return "tmobile";
  if (ATT.test(name)) return "att";
  if (VERIZON.test(name)) return "verizon";
  return "other";
}

export type CarrierTally = Record<CarrierBrand, number>;

export function tallyCarriers(
  contacts: Array<CarrierFields | null | undefined>,
): CarrierTally {
  const tally: CarrierTally = { tmobile: 0, att: 0, verizon: 0, other: 0, unknown: 0 };
  for (const contact of contacts) tally[carrierBrand(contact)]++;
  return tally;
}
