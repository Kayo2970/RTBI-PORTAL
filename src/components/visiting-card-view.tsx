'use client';

import React, { useState } from 'react';
import { ProfileCard } from '@/components/profile-card';
import { authHeaders } from '@/lib/local-data';

export interface VisitingCardData {
  name: string;
  designation?: string;
  phone?: string;
  email?: string;
  photoUrl?: string;
  socials?: {
    linkedin?: string;
    customLinks?: {
      label: string;
      url: string;
      icon: string;
      customIconUrl?: string;
      customIconData?: string;
    }[];
  };
}

interface VisitingCardViewProps {
  card: VisitingCardData;
  slug: string;
  /** Set false in the Settings live-preview, where downloads/actions don't apply yet. */
  showActions?: boolean;
  appleWalletAvailable?: boolean;
  googleWalletAvailable?: boolean;
  /**
   * Set true only for the Visiting Card page's own Live Preview. In this
   * mode the wallet buttons read `?cacheOnly=1` — whatever pass is already
   * sitting cached on this VPS from the last Save/Publish — and never call
   * WalletWallet's live API themselves, so clicking around your own draft
   * can never burn an API call or eat into your rate limit. The real
   * published card (previewMode false/unset) can still generate on demand
   * as a fallback.
   */
  previewMode?: boolean;
  onShowQr?: () => void;
}

/**
 * 3D Interactive Gyroscope ProfileCard — used in the public
 * /card/[slug] page and settings live-preview.
 */
export function VisitingCardView({
  card,
  slug,
  showActions = true,
  appleWalletAvailable = false,
  googleWalletAvailable = false,
  previewMode = false,
  onShowQr,
}: VisitingCardViewProps) {
  const socials = card.socials || {};
  const [isOpeningGoogleWallet, setIsOpeningGoogleWallet] = useState(false);
  const [isOpeningAppleWallet, setIsOpeningAppleWallet] = useState(false);
  const [walletError, setWalletError] = useState('');

  const cacheOnlySuffix = previewMode ? '?cacheOnly=1' : '';

  const handleAddToAppleWallet = async () => {
    setWalletError('');
    setIsOpeningAppleWallet(true);
    try {
      const passUrl = `/api/card/${slug || 'preview'}/apple-pass${cacheOnlySuffix}`;
      const res = await fetch(passUrl, { headers: authHeaders() });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setWalletError(data.error || 'Could not fetch the Apple Wallet pass.');
        return;
      }
      // On iOS Safari, blob: URLs cannot be passed to Apple Wallet.
      // Direct HTTP navigation lets Safari process application/vnd.apple.pkpass natively.
      window.location.href = passUrl;
    } catch {
      setWalletError('Could not fetch the Apple Wallet pass.');
    } finally {
      setIsOpeningAppleWallet(false);
    }
  };

  const handleAddToGoogleWallet = async () => {
    setWalletError('');
    setIsOpeningGoogleWallet(true);
    try {
      const res = await fetch(`/api/card/${slug || 'preview'}/google-pass${cacheOnlySuffix}`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok && data.saveUrl) {
        window.location.href = data.saveUrl;
      } else if (!res.ok) {
        setWalletError(data.error || 'Could not fetch the Google Wallet pass.');
      }
    } catch {
      setWalletError('Could not fetch the Google Wallet pass.');
    } finally {
      setIsOpeningGoogleWallet(false);
    }
  };

  return (
    <ProfileCard
      name={card.name || 'LEADS Member'}
      title={card.designation || 'Executive Member'}
      handle={card.name ? card.name.toLowerCase().replace(/\s+/g, '.') : 'leads.msruas'}
      status="Verified Member"
      contactText="Save Contact (vCard)"
      avatarUrl={card.photoUrl}
      showUserInfo={true}
      showActions={showActions}
      enableTilt={true}
      enableMobileTilt={true}
      behindGlowEnabled={true}
      innerGradient="linear-gradient(145deg, #60496e8c 0%, #71C4FF44 100%)"
      phone={card.phone}
      email={card.email}
      linkedin={socials.linkedin}
      customLinks={socials.customLinks}
      slug={slug}
      appleWalletAvailable={appleWalletAvailable}
      googleWalletAvailable={googleWalletAvailable}
      isOpeningAppleWallet={isOpeningAppleWallet}
      isOpeningGoogleWallet={isOpeningGoogleWallet}
      walletError={walletError}
      onAppleWalletClick={handleAddToAppleWallet}
      onGoogleWalletClick={handleAddToGoogleWallet}
      onShowQr={onShowQr}
    />
  );
}

export default VisitingCardView;
