'use client';

import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { PassBarcodeFormat, PassQrOptions, PassTheme, authHeaders } from '@/lib/local-data';
import { POSTER_ZONES, posterFields } from '@/lib/wallet-poster-spec';
import { FALLBACK_ORIGIN } from '@/lib/app-origin';

export interface ApplePosterPreviewProps {
  attendeeName: string;
  guestCategory?: string;
  passType: string;
  roomOrVenue?: string;
  eventName: string;
  validity: string;
  serialNumber: string;
  validDaysCount?: number;
  validDays?: string[];
  logoUrl?: string;
  /** Event pass look (draft or saved) — artwork, overlay and text colours feed the artwork renderer. */
  theme?: PassTheme;
  passColor?: string;
  passGradient?: string;
  textColor?: string;
  labelColor?: string;
  fontScale?: number;
  showEventTitle?: boolean;
  barcodeFormat?: PassBarcodeFormat;
  altText?: 'serial' | 'name' | 'none';
  /** Full QR styling; with `inWallet` the QR is part of the artwork and Apple's barcode panel is not drawn. */
  qr?: PassQrOptions;
  /** Absolute pass URL encoded in the barcode. */
  passUrl?: string;
}

/**
 * The wallet pass exactly as it is issued. The artwork is rendered by the SAME server renderer that WalletWallet
 * fetches for the real pass (/api/pass-poster/preview ≡ /api/pass/<serial>/wallet-poster); on top of it we draw only
 * what Apple draws itself — logo + text, one header field, the barcode panel, one row of short primary fields and
 * the footer — at the positions measured from a real iPhone pass.
 */
export function AppleWalletPosterPreview(props: ApplePosterPreviewProps) {
  const {
    attendeeName, guestCategory, passType, roomOrVenue = 'Main Auditorium', eventName, validity, serialNumber, validDaysCount = 0, validDays,
    logoUrl = '/card/rtbi-logo.png', theme, passColor, passGradient, textColor, labelColor, fontScale, showEventTitle,
    barcodeFormat = 'QR', altText = 'serial', passUrl, qr: qrOpts,
  } = props;
  const inWallet = Boolean(qrOpts?.inWallet);
  // A pass-level choice wins; otherwise the event's default; otherwise auto (server decides)
  const effectiveShowTitle = showEventTitle ?? theme?.showEventTitle;

  const [art, setArt] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [qr, setQr] = useState('');
  const lastUrl = useRef('');

  // Re-render the artwork (debounced) whenever the design changes
  const draftKey = JSON.stringify([inWallet ? qrOpts : null, serialNumber, eventName, passColor, passGradient, textColor, labelColor, fontScale, effectiveShowTitle, theme?.walletBackgroundUrl, theme?.backgroundUrl, theme?.overlay, theme?.foregroundColor, theme?.labelColor, theme?.backgroundColor]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/pass-poster/preview', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            eventName, passColor, passGradient, textColor, labelColor, fontScale, showEventTitle: effectiveShowTitle,
            qr: inWallet && qrOpts ? { url: passUrl || `${FALLBACK_ORIGIN}/pass/${serialNumber}`, options: qrOpts, caption: qrOpts.altText === 'none' ? undefined : qrOpts.altText === 'name' ? attendeeName : serialNumber } : undefined,
            theme: theme ? { walletBackgroundUrl: theme.walletBackgroundUrl, backgroundUrl: theme.backgroundUrl, overlay: theme.overlay, foregroundColor: theme.foregroundColor, labelColor: theme.labelColor, backgroundColor: theme.backgroundColor } : {},
          }),
        });
        if (!res.ok || cancelled) return;
        const url = URL.createObjectURL(await res.blob());
        if (cancelled) return URL.revokeObjectURL(url);
        if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
        lastUrl.current = url;
        setArt(url);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);
  useEffect(() => () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current); }, []);

  useEffect(() => {
    QRCode.toDataURL(passUrl || `${FALLBACK_ORIGIN}/pass/${serialNumber}`, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(''));
  }, [passUrl, serialNumber]);

  const f = posterFields({
    attendeeName: attendeeName.trim() || 'Attendee Name',
    guestCategory,
    passType,
    eventName,
    venue: roomOrVenue,
    validity,
    validDays,
    serial: serialNumber,
    validDaysCount,
    barcodeFormat,
    altText,
  });

  const W = 300;
  const label: React.CSSProperties = { fontSize: 7, letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)', fontWeight: 600 };
  const value: React.CSSProperties = { color: '#fff', fontWeight: 700, lineHeight: 1.15, fontSize: 10.5 };
  const wide = barcodeFormat === 'PDF417' || barcodeFormat === 'Code128';

  return (
    <div
      style={{
        width: W,
        aspectRatio: '690 / 1010',
        borderRadius: 20,
        overflow: 'hidden',
        position: 'relative',
        background: passColor || '#0b1526',
        boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif',
      }}
    >
      {art && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={art} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: loading ? 0.75 : 1, transition: 'opacity .2s' }} />
      )}

      {/* Apple: logo + logo text (top-left), ONE header field (top-right) */}
      <div style={{ position: 'absolute', top: '3.2%', left: '5%', right: '5%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl} alt="" style={{ height: 20, width: 'auto', objectFit: 'contain' }} />
          <span style={{ color: '#fff', fontSize: 10.5, fontWeight: 700, opacity: 0.9 }}>{f.logoText}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={label}>{f.header.label}</div>
          <div style={value}>{f.header.value}</div>
        </div>
      </div>

      {/* Apple: barcode panel (not drawn when the styled QR is part of the artwork) */}
      {!inWallet && <div
        style={{
          position: 'absolute',
          left: wide ? '14%' : '25%',
          width: wide ? '72%' : '50%',
          top: `${POSTER_ZONES.barcodeTop * 100}%`,
          background: '#fff',
          borderRadius: 8,
          padding: wide ? '8px 10px 5px' : '10px 24px 6px',
          textAlign: 'center',
        }}
      >
        {wide ? (
          <div
            style={{
              height: barcodeFormat === 'PDF417' ? 56 : 44,
              background: barcodeFormat === 'PDF417'
                ? 'repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 4px,#000 4px 5px,#fff 5px 8px)'
                : 'repeating-linear-gradient(90deg,#000 0 1px,#fff 1px 3px,#000 3px 5px,#fff 5px 6px)',
            }}
            title={`${barcodeFormat} barcode (preview shape)`}
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          qr && <img src={qr} alt="QR" style={{ width: '100%', display: 'block' }} />
        )}
        {f.barcodeAltText && <div style={{ color: '#000', fontSize: 7.5, fontWeight: 600, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.barcodeAltText}</div>}
      </div>}

      {/* Apple: one row of primary fields, then the footer */}
      <div style={{ position: 'absolute', left: '5%', right: '5%', top: `${POSTER_ZONES.fieldsTop * 100}%`, display: 'flex', gap: 8 }}>
        {f.primary.map((x, i) => (
          <div key={i} style={{ flex: 1, minWidth: 0 }}>
            <div style={label}>{x.label}</div>
            <div style={{ ...value, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.value}</div>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: '5%', right: '5%', bottom: '2.6%', ...value, fontSize: 9.5, fontFamily: 'ui-monospace, monospace' }}>
        {f.footer[0].value}
      </div>
    </div>
  );
}

export default AppleWalletPosterPreview;
