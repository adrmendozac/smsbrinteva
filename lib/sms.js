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

module.exports = { sanitizeForSMS, SMS_TEXT_MAX, MMS_CAPTION_MAX };
