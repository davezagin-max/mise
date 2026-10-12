"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that keeps the app shell available offline.
 * Production only: in development a caching worker gets in the way of reloads.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is an extra. The app works without it.
    });
  }, []);
  return null;
}
