import { authHeaders } from '../local-data';
import type { IncubationSettings, Startup } from './types';

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init, headers: authHeaders({ 'Content-Type': 'application/json' }) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data as T;
}

export const fetchIncubationSettings = () => call<IncubationSettings>('/api/incubation/settings');
export const saveIncubationSettings = (s: IncubationSettings) =>
  call<IncubationSettings>('/api/incubation/settings', { method: 'PUT', body: JSON.stringify(s) });

export const fetchStartups = () => call<Startup[]>('/api/incubation/startups');
export const createStartup = (payload: Partial<Startup>) =>
  call<Startup>('/api/incubation/startups', { method: 'POST', body: JSON.stringify(payload) });
export const updateStartup = (id: string, payload: Partial<Startup>) =>
  call<Startup>(`/api/incubation/startups/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) });

export interface FounderCandidate { id: string; name: string; email: string }
/** Active tier-4 (Startup) accounts that can be linked as founders. */
export async function fetchFounderCandidates(): Promise<FounderCandidate[]> {
  const all = await call<any[]>('/api/members');
  return all.filter(m => m.tier === 4 && m.status !== 'Terminated').map(m => ({ id: m.id, name: m.name, email: m.email }));
}
