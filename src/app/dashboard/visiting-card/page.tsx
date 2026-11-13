'use client';

import React, { useState, useEffect } from 'react';
import { Save, QrCode, Copy, ExternalLink, RotateCw, AlertCircle, Sparkles, Maximize2, X, ShieldCheck, Crop, Plus, Trash2, Upload } from 'lucide-react';
import { getMembers, saveMembers, updateMemberCard, updateMemberCardPhoto, authHeaders } from '@/lib/local-data';
import { isCentreHead, hasCapability } from '@/lib/permissions';
import { FileDropzone, useUploadTask } from '@/components/ui/file-dropzone';
import { VisitingCardView } from '@/components/visiting-card-view';
import { InteractiveKeycardHolder } from '@/components/interactive-keycard-holder';
import { CardQrModal } from '@/components/card-qr-modal';
import { ImageCropModal } from '@/components/image-crop-modal';
import { Linkedin } from '@/components/ui/linkedin-icon';
import { CUSTOM_LINK_ICONS, resolveCustomLinkIcon } from '@/lib/custom-link-icons';

const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_CUSTOM_LINKS = 5;
const MAX_CUSTOM_ICON_SIZE_BYTES = 1 * 1024 * 1024; // 1 MB

interface CardCustomLinkRow {
  label: string;
  url: string;
  icon: string;
  customIconUrl?: string;
  customIconStorageKey?: string;
  customIconData?: string;
  customIconFileName?: string;
}

export default function VisitingCardPage() {
  const [user, setUser] = useState<any>(null);

  const [isFullscreenLeatherOpen, setIsFullscreenLeatherOpen] = useState(false);
  const [cardEnabled, setCardEnabled] = useState(false);
  const [cardSlug, setCardSlug] = useState('');
  const [cardDesignationOverride, setCardDesignationOverride] = useState('');
  const [cardPhone, setCardPhone] = useState('');
  const [cardLinkedin, setCardLinkedin] = useState('');
  const [cardCustomLinks, setCardCustomLinks] = useState<CardCustomLinkRow[]>([]);
  const [customIconSizeError, setCustomIconSizeError] = useState('');
  const [cardPhotoUrl, setCardPhotoUrl] = useState('');
  const [cardPhotoFile, setCardPhotoFile] = useState<File | null>(null);
  const [cardPhotoPreviewUrl, setCardPhotoPreviewUrl] = useState<string | null>(null);
  const [cardPhotoSizeError, setCardPhotoSizeError] = useState('');
  const [isCardQrOpen, setIsCardQrOpen] = useState(false);

  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);
  const [cropFileName, setCropFileName] = useState('card-photo.jpg');

  const [isSavingCard, setIsSavingCard] = useState(false);

  // Wallet Setup (Super User only). Apple + Google passes are both issued
  // through a single WalletWallet API key (https://walletwallet.dev) —
  // see docs/wallet-setup.md.

  // Whether Apple/Google Wallet buttons are actually live right now — every
  // member can see this (unlike walletStatus above, which needs Super User),
  // so the Live Preview shows real buttons instead of always "coming soon".
  const [walletAvailability, setWalletAvailability] = useState({
    appleWalletAvailable: false,
    googleWalletAvailable: false,
  });

  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const isWalletAdmin = !!(user && (user.role === 'SUPER_USER' || isCentreHead(user) || hasCapability(user, 'VISITING_CARD_ACCESS')));

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setErrorMsg('');
    setTimeout(() => setSuccessMsg(''), 4000);
  };
  const triggerError = (msg: string) => {
    setErrorMsg(msg);
    setSuccessMsg('');
    setTimeout(() => setErrorMsg(''), 4000);
  };

  useEffect(() => {
    const raw = localStorage.getItem('user');
    if (!raw) return;
    try {
      const u = JSON.parse(raw);
      setUser(u);
      const members = getMembers();
      const me = members.find(m => m.id === u.id) || u;
      setCardEnabled(!!me?.cardEnabled);
      setCardSlug(me?.cardSlug || '');
      setCardDesignationOverride(me?.cardDesignationOverride || '');
      setCardPhone(me?.cardPhone || '');
      setCardLinkedin(me?.cardSocials?.linkedin || '');
      setCardCustomLinks(me?.cardSocials?.customLinks || []);
      setCardPhotoUrl(me?.cardPhotoUrl || '');
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchWalletAvailability();
  }, [user]);

  const fetchWalletAvailability = async () => {
    const res = await fetch('/api/wallet-availability', { headers: authHeaders() });
    if (res.ok) setWalletAvailability(await res.json());
  };

  const cardPhotoUpload = useUploadTask(async (file, onProgress) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Could not read that file.')));
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    });

    const result = await updateMemberCardPhoto(user.id, dataUrl, file.name, onProgress);
    const members = getMembers();
    const idx = members.findIndex(m => m.id === user.id);
    if (idx !== -1) {
      members[idx] = { ...members[idx], cardPhotoUrl: result.cardPhotoUrl, cardPhotoStorageKey: result.cardPhotoStorageKey };
      saveMembers(members);
    }
    setCardPhotoUrl(result.cardPhotoUrl);
    triggerSuccess('Visiting card photo updated successfully.');
  });

  const handleCardPhotoFilesSelected = (files: File[]) => {
    const file = files[0];
    if (!file || !user) return;

    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      setCardPhotoSizeError(`Image size (${(file.size / (1024 * 1024)).toFixed(2)} MB) exceeds the 2 MB maximum limit.`);
      return;
    }
    setCardPhotoSizeError('');
    setCropFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCropImageSrc(reader.result);
        setCropModalOpen(true);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCardCropComplete = (croppedFile: File, dataUrl: string) => {
    setCardPhotoFile(croppedFile);
    setCardPhotoPreviewUrl(dataUrl);
    cardPhotoUpload.start(croppedFile);
  };

  const handleOpenCurrentCardCrop = () => {
    const currentSrc = cardPhotoPreviewUrl || cardPhotoUrl || user?.avatarUrl;
    if (!currentSrc) return;
    setCropFileName('card-photo.jpg');
    setCropImageSrc(currentSrc);
    setCropModalOpen(true);
  };

  useEffect(() => {
    if (!cardPhotoFile) {
      setCardPhotoPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(cardPhotoFile);
    setCardPhotoPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [cardPhotoFile]);

  const handleAddCustomLink = () => {
    if (cardCustomLinks.length >= MAX_CUSTOM_LINKS) return;
    setCardCustomLinks(prev => [...prev, { label: '', url: '', icon: 'globe' }]);
  };

  const handleRemoveCustomLink = (idx: number) => {
    setCardCustomLinks(prev => prev.filter((_, i) => i !== idx));
  };

  const handleCustomLinkFieldChange = (idx: number, field: 'label' | 'url', value: string) => {
    setCardCustomLinks(prev => prev.map((link, i) => i === idx ? { ...link, [field]: value } : link));
  };

  // Picking a preset icon and uploading a custom one are mutually exclusive
  // per row — selecting a preset clears whatever was uploaded, since the
  // card renderer always prefers customIconUrl/customIconData over `icon`
  // when present.
  const handleCustomLinkIconSelect = (idx: number, iconKey: string) => {
    setCardCustomLinks(prev => prev.map((link, i) => i === idx
      ? { ...link, icon: iconKey, customIconUrl: undefined, customIconStorageKey: undefined, customIconData: undefined, customIconFileName: undefined }
      : link
    ));
  };

  const handleCustomLinkIconUpload = (idx: number, files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (file.size > MAX_CUSTOM_ICON_SIZE_BYTES) {
      setCustomIconSizeError(`Icon size (${(file.size / (1024 * 1024)).toFixed(2)} MB) exceeds the 1 MB maximum limit.`);
      return;
    }
    setCustomIconSizeError('');
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCardCustomLinks(prev => prev.map((link, i) => i === idx
          ? { ...link, customIconData: reader.result as string, customIconFileName: file.name, customIconUrl: undefined, customIconStorageKey: undefined }
          : link
        ));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUpdateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setIsSavingCard(true);
    try {
      const changes = {
        cardEnabled,
        cardPhone: cardPhone.trim(),
        cardSocials: {
          linkedin: cardLinkedin.trim(),
          customLinks: cardCustomLinks
            .filter(l => l.label.trim() && l.url.trim())
            .map(l => ({
              label: l.label.trim(),
              url: l.url.trim(),
              icon: l.icon,
              ...(l.customIconUrl ? { customIconUrl: l.customIconUrl, customIconStorageKey: l.customIconStorageKey } : {}),
              ...(l.customIconData ? { customIconData: l.customIconData, customIconFileName: l.customIconFileName } : {}),
            })),
        },
        // Only a Super User can set this — the server strips it from anyone
        // else's request anyway, but there's no reason to send it otherwise.
        ...(isWalletAdmin ? { cardDesignationOverride: cardDesignationOverride.trim() } : {}),
      };
      const updated = await updateMemberCard(user.id, changes, user.name);
      if (!updated) {
        triggerError('Could not find your member record to update.');
        return;
      }
      if (updated.cardSlug) setCardSlug(updated.cardSlug);
      // Pick up the real customIconUrl/customIconStorageKey the server just
      // assigned to any freshly-uploaded icon, and drop the now-redundant
      // transient customIconData so it isn't re-sent on the next save.
      if (updated.cardSocials?.customLinks) setCardCustomLinks(updated.cardSocials.customLinks);

      // Pre-generate the Apple/Google Wallet pass now, right after saving,
      // instead of waiting for the first "Add to Wallet" tap — by the time
      // anyone views the card, the pass is already cached on disk. A rate
      // limit or misconfigured wallet here is never a reason to treat the
      // card save itself as failed.
      let statusMsg = cardEnabled ? 'Digital visiting card published successfully.' : 'Digital visiting card settings saved.';
      if (updated.cardEnabled && updated.cardSlug) {
        try {
          const walletRes = await fetch(`/api/card/${updated.cardSlug}/wallet-pass`, {
            method: 'POST',
            headers: authHeaders(),
          });
          if (!walletRes.ok) {
            const data = await walletRes.json().catch(() => ({}));
            if (walletRes.status === 429) {
              statusMsg += ` Wallet pass update limit reached — ${data.error || 'try again later'}.`;
            } else if (walletRes.status !== 501) {
              console.warn('[visiting-card] wallet pass generation failed:', data.error);
              statusMsg += ` Wallet pass generation failed — ${data.error || `HTTP ${walletRes.status}`}.`;
            }
          }
        } catch (e: any) {
          console.warn('[visiting-card] wallet pass generation request failed:', e);
          statusMsg += ` Wallet pass generation failed — ${e?.message || 'network error'}.`;
        }
      }
      triggerSuccess(statusMsg);
    } catch (err: any) {
      triggerError(err?.message || 'Failed to save visiting card settings.');
    } finally {
      setIsSavingCard(false);
    }
  };

  // Dynamically generated the moment the card is first published — see the
  // slug-minting logic in src/app/api/members/[id]/route.ts's PATCH handler.
  const cardPublicUrl = cardSlug && typeof window !== 'undefined' ? `${window.location.origin}/card/${cardSlug}` : '';

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-8 min-w-0">
      {successMsg && (
        <div className="flex items-center gap-3 p-4 bg-success/15 border border-success/20 rounded-2xl text-theme-text-primary text-xs animate-in fade-in duration-300">
          <span>{successMsg}</span>
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-3 p-4 bg-danger/15 border border-danger/20 rounded-2xl text-theme-text-primary text-xs animate-in fade-in duration-300">
          <AlertCircle className="h-5 w-5 text-danger shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div>
        <h1 className="text-xl font-bold text-theme-text-primary">Digital Visiting Card</h1>
        <p className="text-xs text-theme-text-secondary">Share a public, QR-scannable business card — anyone can save your contact instantly, and add it to Apple or Google Wallet.</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
        <div className="glass-panel rounded-2xl p-6 xl:col-span-7 2xl:col-span-7 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-theme-text-primary">Card Details</h3>
            <label className="flex items-center gap-2 cursor-pointer shrink-0">
              <span className="text-[11px] font-semibold text-theme-text-secondary">{cardEnabled ? 'Published' : 'Unpublished'}</span>
              <button
                type="button"
                onClick={() => setCardEnabled(v => !v)}
                className={`relative w-10 h-6 rounded-full transition-colors cursor-pointer ${cardEnabled ? 'bg-accent' : 'bg-theme-border/40'}`}
              >
                <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${cardEnabled ? 'translate-x-4' : ''}`} />
              </button>
            </label>
          </div>

          <form onSubmit={handleUpdateCard} className="space-y-4 text-xs">
            <div className="flex items-center gap-4 pb-2">
              <div className="flex flex-col items-center">
                <div className="h-16 w-16 shrink-0 rounded-2xl bg-accent flex items-center justify-center shadow-md shadow-accent/20 overflow-hidden relative">
                  {cardPhotoPreviewUrl ? (
                    <img src={cardPhotoPreviewUrl} alt={user?.name} className="h-full w-full object-cover" />
                  ) : cardPhotoUrl ? (
                    <img src={cardPhotoUrl} alt={user?.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-white font-bold text-base">
                      {(user?.name || '').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  {cardPhotoUpload.status === 'uploading' && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-[10px] font-bold">
                      {cardPhotoUpload.progress}%
                    </div>
                  )}
                </div>
                {(cardPhotoPreviewUrl || cardPhotoUrl || user?.avatarUrl) && cardPhotoUpload.status !== 'uploading' && (
                  <button
                    type="button"
                    onClick={handleOpenCurrentCardCrop}
                    className="mt-1.5 text-[10px] font-medium text-accent hover:underline flex items-center gap-1 cursor-pointer transition-colors"
                    title="Re-frame and crop photo"
                  >
                    <Crop className="h-2.5 w-2.5" />
                    Adjust crop
                  </button>
                )}
              </div>
              <div className="space-y-1.5 flex-1 max-w-md">
                <FileDropzone
                  onFilesSelected={handleCardPhotoFilesSelected}
                  accept="image/*"
                  disabled={cardPhotoUpload.status === 'uploading'}
                  label="Upload Card Photo"
                  hint="JPG, PNG, or GIF. Max size 2 MB. Falls back to your profile photo if unset."
                  compact
                />
                {cardPhotoSizeError && <p className="text-[11px] text-danger">{cardPhotoSizeError}</p>}
                {cardPhotoUpload.status === 'error' && (
                  <div className="flex items-center justify-between gap-2 text-[11px] text-danger">
                    <span className="flex items-center gap-1"><AlertCircle className="h-3 w-3 shrink-0" />{cardPhotoUpload.error}</span>
                    <button
                      type="button"
                      onClick={cardPhotoUpload.retry}
                      className="flex items-center gap-1 font-semibold text-accent hover:underline cursor-pointer shrink-0"
                    >
                      <RotateCw className="h-3 w-3" />
                      Retry
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Designation</label>
                {isWalletAdmin ? (
                  <>
                    <input
                      type="text"
                      value={cardDesignationOverride}
                      onChange={(e) => setCardDesignationOverride(e.target.value)}
                      placeholder={user?.role || 'e.g. Head of Design'}
                      className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                    />
                    <p className="text-[10px] text-theme-text-secondary/70">Super User override — leave blank to fall back to your Directory role ({user?.role || '—'}).</p>
                  </>
                ) : (
                  <>
                    <input
                      type="text"
                      disabled
                      value={user?.role || ''}
                      className="w-full px-4 py-2.5 bg-theme-background/10 border border-theme-border/30 rounded-xl text-theme-text-secondary cursor-not-allowed opacity-70"
                    />
                    <p className="text-[10px] text-theme-text-secondary/70">Matches your role as set in the Members Directory — not editable here.</p>
                  </>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="block font-medium text-theme-text-secondary">Phone</label>
                <input
                  type="tel"
                  value={cardPhone}
                  onChange={(e) => setCardPhone(e.target.value)}
                  placeholder="+91 XXXXX XXXXX"
                  className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 font-medium text-theme-text-secondary">
                <Linkedin className="h-4 w-4 text-accent" />
                LinkedIn
              </label>
              <input type="url" value={cardLinkedin} onChange={(e) => setCardLinkedin(e.target.value)} placeholder="https://linkedin.com/in/..." className="w-full px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent" />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="font-medium text-theme-text-secondary">Custom Links</label>
                {cardCustomLinks.length < MAX_CUSTOM_LINKS && (
                  <button
                    type="button"
                    onClick={handleAddCustomLink}
                    className="flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline cursor-pointer"
                  >
                    <Plus className="h-3 w-3" /> Add Link
                  </button>
                )}
              </div>
              {customIconSizeError && <p className="text-[11px] text-danger">{customIconSizeError}</p>}
              {cardCustomLinks.length === 0 ? (
                <p className="text-[11px] text-theme-text-secondary/70">Add a portfolio, GitHub, personal site, or any other link — pick a preset icon or upload your own.</p>
              ) : (
                cardCustomLinks.map((link, idx) => {
                  const iconSrc = link.customIconData || link.customIconUrl;
                  const PresetIcon = resolveCustomLinkIcon(link.icon);
                  return (
                    <div key={idx} className="p-3 bg-theme-background/30 border border-theme-border/30 rounded-xl space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-theme-background/50 border border-theme-border/30 flex items-center justify-center overflow-hidden shrink-0">
                          {iconSrc ? <img src={iconSrc} alt="" className="h-full w-full object-cover" /> : <PresetIcon className="h-4 w-4 text-accent" />}
                        </div>
                        <input
                          type="text"
                          value={link.label}
                          onChange={(e) => handleCustomLinkFieldChange(idx, 'label', e.target.value)}
                          placeholder="Label (e.g. Portfolio)"
                          className="flex-1 px-3 py-2 bg-theme-background/30 border border-theme-card-border rounded-lg text-theme-text-primary focus:outline-none focus:border-accent text-[11px]"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveCustomLink(idx)}
                          className="p-1.5 rounded-lg hover:bg-danger/10 text-danger transition-all cursor-pointer shrink-0"
                          title="Remove link"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <input
                        type="url"
                        value={link.url}
                        onChange={(e) => handleCustomLinkFieldChange(idx, 'url', e.target.value)}
                        placeholder="https://..."
                        className="w-full px-3 py-2 bg-theme-background/30 border border-theme-card-border rounded-lg text-theme-text-primary focus:outline-none focus:border-accent text-[11px]"
                      />
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {CUSTOM_LINK_ICONS.map(({ key, label: iconLabel, Icon }) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => handleCustomLinkIconSelect(idx, key)}
                            title={iconLabel}
                            className={`h-7 w-7 rounded-lg flex items-center justify-center border transition-all cursor-pointer ${
                              !iconSrc && link.icon === key
                                ? 'bg-accent/20 border-accent text-accent'
                                : 'bg-theme-background/30 border-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary'
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                          </button>
                        ))}
                        <label className="h-7 px-2 rounded-lg flex items-center gap-1 border border-dashed border-theme-border/50 text-[10px] font-medium text-theme-text-secondary hover:text-accent hover:border-accent cursor-pointer transition-all">
                          <Upload className="h-3 w-3" />
                          {iconSrc ? 'Replace icon' : 'Upload icon'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              if (e.target.files) handleCustomLinkIconUpload(idx, Array.from(e.target.files));
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {cardPublicUrl && (
              <div className="flex items-center gap-2 p-3 bg-theme-background/30 border border-theme-border/30 rounded-xl">
                <span className="flex-1 text-[11px] font-mono text-accent truncate">{cardPublicUrl}</span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(cardPublicUrl)}
                  className="p-1.5 rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
                  title="Copy link"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsCardQrOpen(true)}
                  className="p-1.5 rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all cursor-pointer"
                  title="Show QR"
                >
                  <QrCode className="h-3.5 w-3.5" />
                </button>
                <a
                  href={cardPublicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg hover:bg-theme-border/30 text-theme-text-secondary hover:text-theme-text-primary transition-all"
                  title="Open card"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            )}

            <button
              type="submit"
              disabled={isSavingCard}
              className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-primary-light text-white font-semibold rounded-xl transition-all shadow-md shadow-accent/20 cursor-pointer disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isSavingCard ? 'Saving…' : cardEnabled ? 'Save & Publish' : 'Save'}
            </button>
          </form>
        </div>

        <div className="flex flex-col items-center xl:items-center w-full xl:col-span-5 2xl:col-span-5 gap-4 min-w-0 overflow-visible">
          <div className="flex items-center justify-between w-full max-w-sm px-1 flex-wrap gap-2">
            <p className="text-[11px] font-semibold text-theme-text-secondary uppercase tracking-wider">Visiting Card</p>

            <button
              type="button"
              onClick={() => setIsFullscreenLeatherOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-600 via-amber-700 to-amber-800 hover:from-amber-500 hover:to-amber-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-amber-950/40 border border-amber-400/40 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              title="Present Credentials with 3D Keycard"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span>Present Credentials</span>
            </button>
          </div>

          <div className="w-full flex justify-center py-2">
            <VisitingCardView
              card={{
                name: user?.name || '',
                designation: (isWalletAdmin && cardDesignationOverride.trim()) ? cardDesignationOverride.trim() : (user?.role || ''),
                phone: cardPhone,
                email: user?.email,
                photoUrl: cardPhotoPreviewUrl || cardPhotoUrl || user?.avatarUrl,
                socials: { linkedin: cardLinkedin, customLinks: cardCustomLinks },
              }}
              slug={cardSlug || 'preview'}
              showActions={Boolean(cardSlug)}
              previewMode
              appleWalletAvailable={walletAvailability.appleWalletAvailable}
              googleWalletAvailable={walletAvailability.googleWalletAvailable}
            />
          </div>
        </div>

        {/* Fullscreen Authenticated 3D Leather Card Holder Experience */}
        {isFullscreenLeatherOpen && (
          <div className="fixed inset-0 z-[100] bg-slate-950/95 backdrop-blur-2xl flex flex-col justify-between p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-300">
            {/* Top Bar */}
            <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4 shrink-0 max-w-5xl mx-auto w-full">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base font-black text-white flex items-center gap-2 flex-wrap">
                    LEADS Executive Keycard
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3" /> Authenticated Member View
                    </span>
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Physical 3D luxury leather bookfold with complete live member credentials.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsFullscreenLeatherOpen(false)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/20 flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
              >
                <X className="h-4 w-4" />
                <span>Exit Fullscreen</span>
                <span className="text-[10px] text-white/50 font-mono hidden sm:inline">(Esc)</span>
              </button>
            </div>

            {/* Central 3D Stage */}
            <div className="flex-1 flex flex-col items-center justify-center my-4 overflow-visible w-full max-w-4xl mx-auto">
              <InteractiveKeycardHolder
                memberName={user?.name || 'Executive Member'}
                memberRole={(isWalletAdmin && cardDesignationOverride.trim()) ? cardDesignationOverride.trim() : (user?.role || 'LEADS Member')}
                phone={cardPhone || user?.phone || '+91 9608768647'}
                email={user?.email || 'member@leads-centre.org'}
                photoUrl={cardPhotoPreviewUrl || cardPhotoUrl || user?.avatarUrl}
                serialNumber={cardSlug ? `LEADS-DIR-${cardSlug.toUpperCase()}` : 'LEADS-DIR-2026-99'}
                accessLevel={user?.division === 'Faculty' ? 'Faculty & Academic Leadership' : user?.tier === 1 ? 'Executive Super User (Tier 1)' : 'Core Committee & Executive Fellow'}
                issuingAuthority="RTBI Portal • RUAS"
                joinDate={user?.createdAt}
                tier={user?.tier}
                cardUrl={cardPublicUrl}
                qrUrl="/card/leads-qr-code.png"
                showActions={true}
                autoOpen={false}
              />
            </div>

            {/* Bottom HUD Hint */}
            <div className="border-t border-white/10 pt-3 text-center text-[11px] text-slate-400 shrink-0 max-w-2xl mx-auto w-full">
              <p className="flex items-center justify-center gap-2 flex-wrap">
                <span>💡 <strong>Interactivity:</strong> Tap leather flap to open/close</span>
                <span>•</span>
                <span>Tap card to pull out &amp; flip for 5-point verification details</span>
              </p>
            </div>
          </div>
        )}

        <CardQrModal
          isOpen={isCardQrOpen}
          onClose={() => setIsCardQrOpen(false)}
          url={cardPublicUrl}
          title="Your Visiting Card QR"
          subtitle={user?.name}
        />

        {user?.tier === 1 && (
          <p className="xl:col-span-12 text-[11px] text-theme-text-secondary">
            The WalletWallet API key now lives in <a href="/dashboard/settings" className="text-accent hover:underline">Settings → Integrations</a> (Super User).
          </p>
        )}
      </div>

      {/* Image Crop Modal for Visiting Card Photo */}
      <ImageCropModal
        isOpen={cropModalOpen}
        imageSrc={cropImageSrc}
        fileName={cropFileName}
        title="Frame Visiting Card Photo"
        description="Drag to reposition and zoom to frame your photo for 3D card display and wallet passes."
        onCropComplete={handleCardCropComplete}
        onClose={() => setCropModalOpen(false)}
      />
    </div>
  );
}
