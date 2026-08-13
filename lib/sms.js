// Strip emojis, accents, and markdown so SMS sends as clean GSM-7 ASCII.
function sanitizeForSMS(text) {
  return String(text)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // remove accent marks
    .replace(/[^\x00-\x7F]/g, '')                       // remove emojis / non-ASCII
    .replace(/\*\*/g, '').replace(/__/g, '')            // remove markdown bold
    .replace(/[ \t]+$/gm, '')                           // trailing spaces per line
    .replace(/\n{3,}/g, '\n\n')                         // collapse blank lines
    .trim();
}

// Vonage Messages API hard limits, verified against the live API on 2026-08-03
// (probe with an invalid `to`, so nothing sent and nothing billed):
//   3200 -> accepted
//   3201 -> 422 "text: cannot exceed 3200 characters for the given channel."
// Vonage's published docs still say 1000; they are stale — 2681-char messages
// deliver in production today. Treat 3200 as the ceiling and stay well under it.
const SMS_TEXT_MAX = 3200;

// An image's caption is capped far lower than a text-type message.
const MMS_CAPTION_MAX = 300;

// GSM-7 segmentation, mirroring admin-ui/src/lib/sms.ts so the seller's
// on-screen estimate and the throughput budget agree on what a message costs.
// 160 chars fit one standalone segment; concatenated parts spend 7 bits per
// part on the UDH header, leaving 153. Safe to assume GSM-7 here because
// sanitizeForSMS() has already stripped everything outside ASCII.
//
// Counted in SEGMENTS, not messages, because that is the unit carriers meter:
// the 2026-08-11/12 incident was 1,112 recipients but 5,530 segments.
function smsSegments(text) {
  const length = String(text ?? '').length;
  if (length === 0) return 0;
  if (length <= 160) return 1;
  return Math.ceil(length / 153);
}

module.exports = { sanitizeForSMS, smsSegments, SMS_TEXT_MAX, MMS_CAPTION_MAX };
