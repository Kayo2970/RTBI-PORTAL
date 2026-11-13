'use client';

import React, { useEffect, useState, use } from 'react';
import { AlertTriangle } from 'lucide-react';
import { VisitingCardView, VisitingCardData } from '@/components/visiting-card-view';
import { CardQrModal } from '@/components/card-qr-modal';

interface PublicCardResponse extends VisitingCardData {
  slug: string;
  appleWalletAvailable: boolean;
  googleWalletAvailable: boolean;
}

export default function PublicVisitingCardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);

  const [card, setCard] = useState<PublicCardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isQrOpen, setIsQrOpen] = useState(false);

  // Same reasoning as /forms/[slug]: this page is opened standalone via a
  // scanned QR code or shared link, outside the dashboard's theme toggle, so
  // it must force the dark glassmorphic look rather than inherit whatever
  // (or no) theme the visitor's browser happens to be in.
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/card/${slug}`)
      .then((res) => {
        if (!res.ok) throw new Error('not found');
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setCard(data);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const fullUrl = typeof window !== 'undefined' ? `${window.location.origin}/card/${slug}` : `/card/${slug}`;

  if (loading) {
    return (
      <div className="min-h-screen bg-space-theme flex flex-col items-center justify-center p-4 relative z-0 overflow-hidden">
        <div className="glass-panel rounded-2xl px-6 py-4 flex items-center gap-3 border border-white/15 shadow-2xl backdrop-blur-xl">
          <div className="h-4 w-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
          <span className="text-sm text-theme-text-secondary">Loading card…</span>
        </div>
      </div>
    );
  }

  if (notFound || !card) {
    return (
      <div className="min-h-screen bg-space-theme text-theme-text-primary flex flex-col items-center justify-center p-4 relative z-0 overflow-hidden">
        <div className="glass-panel w-full max-w-md rounded-3xl p-8 flex flex-col items-center text-center space-y-4 border border-white/20 dark:border-white/15 shadow-2xl backdrop-blur-2xl bg-theme-card/90">
          <div className="h-12 w-12 rounded-2xl bg-danger/15 border border-danger/30 flex items-center justify-center text-danger">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-bold text-theme-text-primary">Card not available</h1>
          <p className="text-sm text-theme-text-secondary">
            This visiting card doesn&apos;t exist, or its owner hasn&apos;t published it yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-space-theme text-theme-text-primary flex flex-col items-center justify-center p-4 py-12 relative z-0 overflow-hidden">
      <VisitingCardView
        card={card}
        slug={card.slug}
        appleWalletAvailable={card.appleWalletAvailable}
        googleWalletAvailable={card.googleWalletAvailable}
        onShowQr={() => setIsQrOpen(true)}
      />

      <CardQrModal
        isOpen={isQrOpen}
        onClose={() => setIsQrOpen(false)}
        url={fullUrl}
        title="Visiting Card QR"
        subtitle={card.name}
      />
    </div>
  );
}
