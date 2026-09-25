"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const serviceWorkerUrl = `${basePath}/sw.js`;
    const scope = `${basePath}/`;

    const register = () => {
      navigator.serviceWorker.register(serviceWorkerUrl, { scope }).catch((error) => {
        console.error("Service worker registration failed", error);
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
