// Strip emojis, accents, and markdown so SMS sends as clean GSM-7 ASCII.
function sanitizeForSMS(text) {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // remove accent marks
    .replace(/[^\x00-\x7F]/g, '')                       // remove emojis / non-ASCII
    .replace(/\*\*/g, '').replace(/__/g, '')            // remove markdown bold
    .replace(/[ \t]+$/gm, '')                           // trailing spaces per line
    .replace(/\n{3,}/g, '\n\n')                         // collapse blank lines
    .trim();
}

module.exports = { sanitizeForSMS };
