'use client';

import { useEffect, useState } from 'react';

function formatJakartaTime(date: Date) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'full',
    timeStyle: 'medium',
  }).format(date);
}

export function RealtimeClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <p aria-live="polite" className="muted">
      Waktu real-time (WIB)<br />
      <strong>{now ? formatJakartaTime(now) : 'Memuat waktu…'}</strong>
    </p>
  );
}
