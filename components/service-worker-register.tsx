'use client';

import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Offline support is best-effort and must never block the application shell.
    });
  }, []);

  return null;
}
