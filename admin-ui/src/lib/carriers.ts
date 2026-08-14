// Groups a contact by the carrier name Number Insight returned, which the
// backfill stores in contacts.carrier_name.
//
// Matching on the name rather than a table of MCC/MNC codes is deliberate: the
// name comes from Vonage, whereas a code table would come from us maintaining
// one correctly. lib/throughput.js classifies the same way, so the split shown
// here is the split the send engine will actually apply.

export type CarrierBrand = "tmobile" | "att" | "verizon" | "other" | "unknown";

// Kept in sync with TMOBILE_NAME in lib/throughput.js — these share one
// throughput allowance, so they are one bar in the UI.
const TMOBILE = /t-?mobile|sprint|metro ?pcs|mint mobile|ultra mobile|google fi/i;
const ATT = /at&t|cingular/i;
const VERIZON = /verizon/i;

export function carrierBrand(name: string | null | undefined): CarrierBrand {
  // No lookup yet, or one that resolved to a landline / unusable number. The
  // backend treats these as T-Mobile for budgeting; the UI shows them
  // separately so it is obvious the backfill still has work to do.
  if (!name) return "unknown";
  if (TMOBILE.test(name)) return "tmobile";
  if (ATT.test(name)) return "att";
  if (VERIZON.test(name)) return "verizon";
  return "other";
}

export type CarrierTally = Record<CarrierBrand, number>;

export function tallyCarriers(names: Array<string | null | undefined>): CarrierTally {
  const tally: CarrierTally = { tmobile: 0, att: 0, verizon: 0, other: 0, unknown: 0 };
  for (const name of names) tally[carrierBrand(name)]++;
  return tally;
}
