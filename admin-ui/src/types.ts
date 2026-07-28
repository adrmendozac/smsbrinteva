export interface Contact {
  id: number;
  phone: string;
  name: string | null;
  // Present on the contact manager's list (GET /api/contacts/all). The audience
  // picker's GET /api/contacts returns only active opted-in contacts and omits
  // these.
  opted_in?: boolean;
  archived_at?: string | null;
}

export type CampaignStatus =
  | "draft"
  | "scheduled"
  | "sending"
  | "completed"
  | "failed";

export interface Campaign {
  id: number;
  name: string;
  body: string;
  // Set means the campaign went out as an MMS with body as the image caption.
  media_url: string | null;
  status: CampaignStatus;
  scheduled_at: string | null;
  sent_count: number;
  failed_count: number;
  total_count: number;
  created_by: string | null;
  created_at: string;
  // NULL while active; a timestamp once archived. Archiving never deletes the
  // campaign or its recipient rows.
  archived_at: string | null;
}

export interface RecipientCount {
  status: string;
  n: number;
}

export type RecipientStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "failed"
  | "opted_out";

export interface Recipient {
  id: number;
  phone: string;
  name: string | null;
  status: RecipientStatus;
  vonage_message_id: string | null;
  error: string | null;
  sent_at: string | null;
}

export interface CampaignDetail extends Campaign {
  recipientCounts: RecipientCount[];
  recipients: Recipient[];
}

export interface CreateCampaignPayload {
  name: string;
  body: string;
  contactIds: number[];
  phones: string[];
  scheduledAt: string | null;
  mediaUrl: string | null;
}

export interface UploadedMedia {
  url: string;
  filename: string;
  bytes: number;
  originalBytes: number;
  format: string;
}

// 409 from /api/media: this name was used before. The user picks copy or replace.
export interface MediaConflict {
  error: string;
  conflict: true;
  filename: string;
  existingUrl: string;
}

// The buckets the rail shows. Every contact falls in exactly one, so the three
// sum to the absolute total. reachable + optedOut is the active population;
// archived contacts are out of play and only surface on the Contactos tab.
export interface ContactCounts {
  reachable: number;
  optedOut: number;
  archived: number;
}

// Derived in two places — App, for the rail on every tab, and Contacts as its
// own list changes under edits — so the rule lives next to the type.
export function countContacts(list: Contact[]): ContactCounts {
  const live = list.filter((c) => !c.archived_at);
  return {
    // The same test App applies to build the send audience, so the number on the
    // rail cannot disagree with the number of people a campaign reaches.
    reachable: live.filter((c) => c.opted_in !== false).length,
    // All opted-out contacts, including archived — the user wants to see opted-out
    // count regardless of archive status in both Activos and Archivados.
    optedOut: list.filter((c) => c.opted_in === false).length,
    // Only archived contacts that are NOT also opted-out (otherwise they'd be
    // double-counted). The three counters still partition the full list.
    archived: list.filter((c) => c.archived_at && c.opted_in !== false).length,
  };
}
