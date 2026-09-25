import React from "react";
import { createRoot } from "react-dom/client";
import SpendingWallet from "./SpendingWallet.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <SpendingWallet />
  </React.StrictMode>
);

/* The worker is what makes the app open without a connection. Registered after
   load so it never competes with the first paint. */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js")   // relative: works in a repo subfolder
      .then((reg) => {
        if (reg.waiting) {
          window.__updateWaiting = true;
          window.dispatchEvent(new Event("update-waiting"));
        }
        reg.addEventListener("updatefound", () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              window.__updateWaiting = true;
              window.dispatchEvent(new Event("update-waiting"));
            }
          });
        });
      })
      .catch(() => { /* offline support is a bonus, never a requirement */ });

    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  });
}
