'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Save, Share2, CheckCircle2 } from 'lucide-react';
import { authHeaders } from '@/lib/local-data';

const SOCIAL_FIELDS: Array<[string, string, string]> = [
  ['instagram', 'Instagram', 'https://instagram.com/…'],
  ['linkedin', 'LinkedIn', 'https://linkedin.com/company/…'],
  ['x', 'X (Twitter)', 'https://x.com/…'],
  ['youtube', 'YouTube', 'https://youtube.com/@…'],
  ['facebook', 'Facebook', 'https://facebook.com/…'],
  ['website', 'Website', 'https://…'],
];

/** Super User only: WalletWallet API key (moved here from Visiting Card) + the centre's social accounts. */
export function IntegrationsPanel() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyMsg, setKeyMsg] = useState('');
  const [socials, setSocials] = useState<Record<string, string>>({});
  const [savingSocials, setSavingSocials] = useState(false);
  const [socialMsg, setSocialMsg] = useState('');

  const load = useCallback(async () => {
    const [w, s] = await Promise.all([
      fetch('/api/admin/wallet-settings', { headers: authHeaders() }),
      fetch('/api/centre-socials'),
    ]);
    if (w.ok) setConfigured(Boolean((await w.json()).walletWalletConfigured));
    if (s.ok) setSocials(await s.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveKey = async () => {
    if (!apiKey.trim()) return setKeyMsg('Enter a WalletWallet API key first.');
    setSavingKey(true);
    setKeyMsg('');
    try {
      const res = await fetch('/api/admin/wallet-settings', {
        method: 'PATCH',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ walletwallet: { apiKey: apiKey.trim() } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save the key.');
      setApiKey('');
      setKeyMsg('Key saved. Use "Check key" to verify it.');
      await load();
    } catch (e: any) {
      setKeyMsg(e.message);
    } finally {
      setSavingKey(false);
    }
  };

  const testKey = async () => {
    setTesting(true);
    setKeyMsg('');
    try {
      const res = await fetch('/api/admin/wallet-settings/test', { method: 'POST', headers: authHeaders() });
      const data = await res.json();
      setKeyMsg(data.message || data.error || 'No response.');
    } catch {
      setKeyMsg('Could not reach the server.');
    } finally {
      setTesting(false);
    }
  };

  const saveSocials = async () => {
    setSavingSocials(true);
    setSocialMsg('');
    try {
      const res = await fetch('/api/centre-socials', {
        method: 'PUT',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(socials),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save.');
      setSocials(data);
      setSocialMsg('Saved. These links appear on expired-pass thank-you pages.');
    } catch (e: any) {
      setSocialMsg(e.message);
    } finally {
      setSavingSocials(false);
    }
  };

  const input = 'flex-1 px-4 py-2.5 bg-theme-background/30 border border-theme-card-border rounded-xl text-theme-text-primary focus:outline-none focus:border-accent text-xs';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <div className="glass-panel rounded-2xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-accent" /> WalletWallet API key
            </h3>
            <p className="text-xs text-theme-text-secondary">
              Apple &amp; Google Wallet passes (visiting cards and event passes) are issued through{' '}
              <a href="https://walletwallet.dev" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">WalletWallet</a>. Event-pass backgrounds, logos and footer fields need a Pro key. The key is encrypted at rest and never shown again.
            </p>
          </div>
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${configured ? 'bg-success/15 text-success' : 'bg-theme-border/30 text-theme-text-secondary'}`}>
            {configured === null ? '…' : configured ? 'Configured' : 'Not configured'}
          </span>
        </div>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="ww_live_..." className={input} autoComplete="off" />
          <button type="button" onClick={saveKey} disabled={savingKey} className="flex items-center justify-center gap-2 px-5 py-2.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-50 shrink-0">
            <Save className="h-4 w-4" /> {savingKey ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={testKey} disabled={testing || !configured} className="flex items-center justify-center gap-2 px-4 py-2.5 border border-theme-card-border text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-50 shrink-0">
            <CheckCircle2 className="h-4 w-4" /> {testing ? 'Checking…' : 'Check key'}
          </button>
        </div>
        {keyMsg && <p className="text-xs font-semibold text-accent">{keyMsg}</p>}
      </div>

      <div className="glass-panel rounded-2xl p-6 space-y-4">
        <div>
          <h3 className="text-base font-bold text-theme-text-primary flex items-center gap-2">
            <Share2 className="h-4 w-4 text-accent" /> Centre social accounts
          </h3>
          <p className="text-xs text-theme-text-secondary">
            Shown on the &ldquo;Thank you for being part of our event&rdquo; page that event-pass links switch to 30 days after an event ends.
          </p>
        </div>
        <div className="space-y-2">
          {SOCIAL_FIELDS.map(([key, label, placeholder]) => (
            <label key={key} className="flex items-center gap-3 text-xs font-semibold text-theme-text-secondary">
              <span className="w-24 shrink-0">{label}</span>
              <input type="url" value={socials[key] || ''} onChange={(e) => setSocials((s) => ({ ...s, [key]: e.target.value }))} placeholder={placeholder} className={input} />
            </label>
          ))}
        </div>
        <button type="button" onClick={saveSocials} disabled={savingSocials} className="flex items-center justify-center gap-2 px-5 py-2.5 bg-accent hover:bg-primary-light text-white text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-50">
          <Save className="h-4 w-4" /> {savingSocials ? 'Saving…' : 'Save social links'}
        </button>
        {socialMsg && <p className="text-xs font-semibold text-accent">{socialMsg}</p>}
      </div>
    </div>
  );
}
