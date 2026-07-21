import { StrictMode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { CustomEase } from "gsap/CustomEase";

// Register before any GSAP code runs so useGSAP cleanup is wired up.
gsap.registerPlugin(useGSAP, CustomEase);

// GSAP only accepts named eases -- passing a raw "cubic-bezier(...)" string (or
// a CSS var) resolves to undefined and silently falls back to the default ease.
// Register the curve by name so JS motion matches the CSS --ease-mass exactly.
CustomEase.create("mass", "0.32, 0.72, 0, 1");

import { createRoot } from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
