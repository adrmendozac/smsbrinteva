import { getToken, clearToken } from "./auth";
import type {
  Contact,
  Campaign,
  CampaignDetail,
  CreateCampaignPayload,
  UploadedMedia,
  MediaConflict,
} from "../types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Thrown on 409 so the caller can offer "guardar como copia" or "reemplazar".
export class MediaConflictError extends ApiError {
  detail: MediaConflict;
  constructor(detail: MediaConflict) {
    super(409, detail.error);
    this.detail = detail;
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

// Multipart, so no Content-Type header — the browser sets its own boundary.
async function uploadMedia(
  file: File,
  onConflict?: "copy" | "replace"
): Promise<UploadedMedia> {
  const token = getToken();
  const form = new FormData();
  form.append("image", file);

  const qs = onConflict ? `?onConflict=${onConflict}` : "";
  const res = await fetch(`/api/media${qs}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });

  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new ApiError(401, "Sesión expirada");
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 409 && data?.conflict) throw new MediaConflictError(data);
  if (!res.ok) throw new ApiError(res.status, data?.error || `Error ${res.status}`);
  return data as UploadedMedia;
}

export const api = {
  uploadMedia,
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
  // Soft archive / restore. Archived contacts drop out of the manager's Activos
  // tab and the campaign audience picker, but the row and its send history stay.
  archiveContact: (id: number, archived: boolean) =>
    request<Contact>(`/api/contacts/${id}/archive`, {
      method: "PATCH",
      body: JSON.stringify({ archived }),
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
  getBalance: () =>
    request<{
      balance: string;
      autoReload: boolean;
      pricePerSegment: string;
      currency: string;
    }>("/api/account/balance"),
};
