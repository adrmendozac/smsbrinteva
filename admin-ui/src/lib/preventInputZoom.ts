
export function preventInputZoom() {
  const ua = navigator.userAgent;
  const isIOS = /iP(hone|ad|od)/.test(ua) && /WebKit/.test(ua);
  if (!isIOS) return;

  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!viewport) return;

  const relaxed = viewport.getAttribute("content") ?? "width=device-width, initial-scale=1.0";
  const locked = "width=device-width, initial-scale=1.0, maximum-scale=1.0";

  const isField = (t: EventTarget | null): t is HTMLElement =>
    t instanceof HTMLElement &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

  // focusin/out bubble, so a single listener pair covers inputs mounted later.
  document.addEventListener("focusin", (e) => {
    if (isField(e.target)) viewport.setAttribute("content", locked);
  });
  document.addEventListener("focusout", (e) => {
    if (isField(e.target)) viewport.setAttribute("content", relaxed);
  });
}
