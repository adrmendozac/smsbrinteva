import {
  contracts,
  schema,
  validate,
  type AccountBalanceResponse,
  type Campaign,
  type Contact,
  type CreateCampaignRequest,
  type Infer,
  type LogPage,
} from "../../../shared/api-contract.js";

const login = validate(contracts.loginRequest, { pin: "1234" });
if (login.ok) {
  const pin: string = login.value.pin;
  void pin;
}

const contact: Contact = {
  id: 1,
  phone: "19256658003",
  name: "Nicoll",
  opted_in: true,
  archived_at: null,
};

const campaignRequest: CreateCampaignRequest = {
  name: "Promo Italia",
  body: "Brinteva Worlds: Viaja con nosotros",
  contactIds: [contact.id],
  phones: [],
  scheduledAt: null,
  mediaUrl: null,
};

const campaign: Campaign = {
  id: 7,
  name: campaignRequest.name,
  body: campaignRequest.body,
  media_url: null,
  status: "draft",
  scheduled_at: null,
  sent_count: 0,
  failed_count: 0,
  total_count: 1,
  created_by: "admin",
  created_at: "2026-08-03T12:00:00.000Z",
  archived_at: null,
};

const balance: AccountBalanceResponse = {
  balance: "25.50",
  autoReload: false,
  pricePerSegment: null,
  currency: null,
};

const logs: LogPage = { logs: [], nextBefore: null };
const inferred: Infer<typeof contracts.createCampaignRequest> = campaignRequest;

const customSchema = schema.object({
  required: schema.string(),
  optional: schema.optional(schema.number()),
  nullable: schema.nullable(schema.boolean()),
  choice: schema.union([schema.literal("now"), schema.integer()]),
});
const customValue: Infer<typeof customSchema> = {
  required: "value",
  nullable: null,
  choice: "now",
};
const customWithOptional: Infer<typeof customSchema> = {
  required: "value",
  optional: 2,
  nullable: false,
  choice: 3,
};

// @ts-expect-error contactIds is an array on the wire; validation never coerces it.
const invalidRequest: CreateCampaignRequest = { ...campaignRequest, contactIds: 7 };

// @ts-expect-error paused is not a campaign status.
const invalidCampaign: Campaign = { ...campaign, status: "paused" };

// @ts-expect-error required is not optional in an inferred object schema.
const invalidCustom: Infer<typeof customSchema> = { nullable: null, choice: "now" };

void [
  balance,
  logs,
  inferred,
  customValue,
  customWithOptional,
  invalidRequest,
  invalidCampaign,
  invalidCustom,
];
