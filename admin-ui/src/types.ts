export interface Contact {
  id: number;
  phone: string;
  name: string | null;
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
  status: CampaignStatus;
  scheduled_at: string | null;
  sent_count: number;
  failed_count: number;
  total_count: number;
  created_by: string | null;
  created_at: string;
}

export interface RecipientCount {
  status: string;
  n: number;
}

export interface CampaignDetail extends Campaign {
  recipientCounts: RecipientCount[];
}

export interface CreateCampaignPayload {
  name: string;
  body: string;
  contactIds: number[];
  phones: string[];
  scheduledAt: string | null;
}
