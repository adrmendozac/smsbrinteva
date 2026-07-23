import { getToken, clearToken } from "./auth";
import type {
  Contact,
  Campaign,
  CampaignDetail,
  CreateCampaignPayload,
} from "../types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });

  // Token expired / invalid -> drop it and bounce to the login gate.
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new ApiError(401, "Sesión expirada");
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || `Error ${res.status}`);
  }
  return data as T;
}

export const api = {
  getContacts: () => request<Contact[]>("/api/contacts"),
  // Every contact, opted-in or not, for the contact manager.
  getAllContacts: () => request<Contact[]>("/api/contacts/all"),
  createContact: (payload: { name: string; phone: string }) =>
    request<Contact>("/api/contacts", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateContact: (id: number, payload: { name?: string; phone?: string }) =>
    request<Contact>(`/api/contacts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteContact: (id: number) =>
    request<{ ok: boolean; id: number }>(`/api/contacts/${id}`, {
      method: "DELETE",
    }),
  suggest: (prompt: string) =>
    request<{ text: string }>("/api/suggest", {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  createCampaign: (payload: CreateCampaignPayload) =>
    request<{ id: number; total: number }>("/api/campaigns", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listCampaigns: () => request<Campaign[]>("/api/campaigns"),
  getCampaign: (id: number) => request<CampaignDetail>(`/api/campaigns/${id}`),
  sendCampaign: (id: number) =>
    request<{ ok: boolean }>(`/api/campaigns/${id}/send`, { method: "POST" }),
  archiveCampaign: (id: number, archived: boolean) =>
    request<{ ok: boolean; id: number; archived_at: string | null }>(
      `/api/campaigns/${id}/archive`,
      { method: "PATCH", body: JSON.stringify({ archived }) }
    ),
};
