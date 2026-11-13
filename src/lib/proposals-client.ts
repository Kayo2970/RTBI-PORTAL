import { authHeaders } from './local-data';
import type { ProposalItem, ProposalResponseStatus } from './proposals';

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', ...init, headers: authHeaders({ 'Content-Type': 'application/json' }) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data as T;
}

export const fetchProposals = () => call<ProposalItem[]>('/api/proposals');

export const createProposal = (payload: {
  title: string;
  body: string;
  recipients: { groups: string[]; memberIds: string[] };
  attachments: { name: string; type: string; dataUrl: string }[];
}) => call<ProposalItem>('/api/proposals', { method: 'POST', body: JSON.stringify(payload) });

export const decideProposal = (id: string, decision: 'Approved' | 'Rejected', note?: string) =>
  call<ProposalItem>(`/api/proposals/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'decide', decision, note }) });

export const respondToProposal = (id: string, status: ProposalResponseStatus, comment?: string) =>
  call<ProposalItem>(`/api/proposals/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'respond', status, comment }) });

export const deleteProposal = (id: string) =>
  call<{ success: boolean }>(`/api/proposals/${id}`, { method: 'DELETE' });
