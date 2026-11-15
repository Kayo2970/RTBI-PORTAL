'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MailComposerBroadcaster } from '@/components/mail-composer-broadcaster';
import { isSuperUser } from '@/lib/permissions';
import { Banner } from '@/components/billing-ui';
import { authHeaders } from '@/lib/local-data';

export default function MailBroadcasterPage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [senderName, setSenderName] = useState('RTBI Portal');
  const [senderEmail, setSenderEmail] = useState('portal@ruas-incubator.com');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('user');
      if (saved) setUser(JSON.parse(saved));
    } catch {
      // ignore
    }
    setReady(true);

    fetch('/api/email/settings', { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          if (data.fromName) setSenderName(data.fromName);
          if (data.fromEmail) setSenderEmail(data.fromEmail);
        }
      })
      .catch(() => {});
  }, []);

  const allowed = isSuperUser(user);

  if (ready && !allowed) {
    return (
      <div className="p-8">
        <Banner kind="error">Mail Broadcaster is restricted to Super User administrators.</Banner>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6">
      <MailComposerBroadcaster
        senderName={senderName}
        senderEmail={senderEmail}
        onNavigateToSettings={() => router.push('/dashboard/email')}
        onSent={() => router.push('/dashboard/email')}
      />
    </div>
  );
}

