import "@testing-library/jest-dom";

// jsdom does not implement matchMedia. Default to "no preference" so components
// using useReducedMotion render; individual tests can override window.matchMedia.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}
