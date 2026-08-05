export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

export interface Schema<T> {
  readonly kind: string;
  readonly __output?: T;
}

export type Infer<S extends Schema<unknown>> =
  S extends Schema<infer T> ? T : never;

export interface StringOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  format?: "http-url";
}

export interface NumberOptions {
  min?: number;
  max?: number;
}

export interface ArrayOptions {
  minItems?: number;
  maxItems?: number;
}

export interface ObjectOptions {
  allowUnknown?: boolean;
  minProperties?: number;
}

export interface StringSchema extends Schema<string>, StringOptions {
  readonly kind: "string";
}

export interface NumberSchema extends Schema<number>, NumberOptions {
  readonly kind: "number";
}

export interface IntegerSchema extends Schema<number>, NumberOptions {
  readonly kind: "integer";
}

export interface BooleanSchema extends Schema<boolean> {
  readonly kind: "boolean";
}

export interface UnknownSchema extends Schema<unknown> {
  readonly kind: "unknown";
}

export interface LiteralSchema<T> extends Schema<T> {
  readonly kind: "literal";
  readonly value: T;
}

export interface EnumSchema<T> extends Schema<T> {
  readonly kind: "enum";
  readonly values: readonly T[];
}

export interface UnionSchema<T> extends Schema<T> {
  readonly kind: "union";
  readonly variants: readonly Schema<unknown>[];
}

export interface IsoDateTimeSchema extends Schema<string> {
  readonly kind: "isoDateTime";
}

export interface ArraySchema<T> extends Schema<T[]>, ArrayOptions {
  readonly kind: "array";
  readonly item: Schema<T>;
}

export interface OptionalSchema<T> extends Schema<T> {
  readonly kind: "optional";
  readonly inner: Schema<T>;
}

export interface NullableSchema<T> extends Schema<T | null> {
  readonly kind: "nullable";
  readonly inner: Schema<T>;
}

type FieldMap = Record<string, Schema<unknown>>;
type OptionalKeys<F extends FieldMap> = {
  [K in keyof F]-?: F[K] extends OptionalSchema<unknown> ? K : never;
}[keyof F];
type RequiredKeys<F extends FieldMap> = Exclude<keyof F, OptionalKeys<F>>;
type InferField<S extends Schema<unknown>> =
  S extends OptionalSchema<infer T> ? T : Infer<S>;

export type InferObject<F extends FieldMap> = {
  [K in RequiredKeys<F>]: InferField<F[K]>;
} & {
  [K in OptionalKeys<F>]?: InferField<F[K]>;
};

export interface ObjectSchema<T> extends Schema<T>, ObjectOptions {
  readonly kind: "object";
  readonly fields: FieldMap;
}

export const schema: {
  string(options?: StringOptions): StringSchema;
  number(options?: NumberOptions): NumberSchema;
  integer(options?: NumberOptions): IntegerSchema;
  boolean(): BooleanSchema;
  unknown(): UnknownSchema;
  literal<const T>(value: T): LiteralSchema<T>;
  enum<const T extends readonly unknown[]>(values: T): EnumSchema<T[number]>;
  union<const V extends readonly Schema<unknown>[]>(variants: V): UnionSchema<Infer<V[number]>>;
  isoDateTime(): IsoDateTimeSchema;
  array<S extends Schema<unknown>>(item: S, options?: ArrayOptions): ArraySchema<Infer<S>>;
  object<const F extends FieldMap>(fields: F, options?: ObjectOptions): ObjectSchema<InferObject<F>>;
  optional<S extends Schema<unknown>>(inner: S): OptionalSchema<Infer<S>>;
  nullable<S extends Schema<unknown>>(inner: S): NullableSchema<Infer<S>>;
};

export interface LoginRequest {
  pin: string;
}

export interface LoginResponse {
  token: string;
}

export interface IdParams {
  id: string;
}

export interface Contact {
  id: number;
  phone: string;
  name: string | null;
  opted_in?: boolean;
  archived_at?: string | null;
}

export interface CreateContactRequest {
  name: string;
  phone: string;
}

export type UpdateContactRequest =
  | { name: string; phone?: string }
  | { name?: string; phone: string };

export interface ArchiveRequest {
  archived: boolean;
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
  media_url: string | null;
  status: CampaignStatus;
  scheduled_at: string | null;
  sent_count: number;
  failed_count: number;
  total_count: number;
  created_by: string | null;
  created_at: string;
  archived_at: string | null;
}

export type RecipientStatus =
  | "pending"
  | "sent"
  | "delivered"
  | "failed"
  | "opted_out";

export interface RecipientCount {
  status: RecipientStatus;
  n: number;
}

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

export interface CreateCampaignRequest {
  name: string;
  body: string;
  contactIds: number[];
  phones: string[];
  scheduledAt: string | null;
  mediaUrl: string | null;
}

export interface CampaignCreatedResponse {
  id: number;
  total: number;
}

export interface OkResponse {
  ok: boolean;
}

export interface ArchiveCampaignResponse extends OkResponse {
  id: number;
  archived_at: string | null;
}

export interface SuggestRequest {
  prompt: string;
}

export interface SuggestResponse {
  text: string;
}

export interface UploadedMedia {
  url: string;
  filename: string;
  bytes: number;
  originalBytes: number;
  format: "jpg" | "gif";
}

export interface MediaConflict {
  error: string;
  conflict: true;
  filename: string;
  existingUrl: string;
}

export interface MediaConflictQuery {
  onConflict?: "copy" | "replace";
}

export interface AccountBalanceResponse {
  balance: string;
  autoReload: boolean;
  pricePerSegment: string | null;
  currency: string | null;
}

export type LogLevel = "info" | "warn" | "error";
export type LogCategory =
  | "send"
  | "dlr"
  | "inbound"
  | "kommo"
  | "voice"
  | "auth"
  | "campaign"
  | "contact"
  | "media"
  | "system";

export interface LogEntry {
  id: number;
  level: LogLevel;
  category: LogCategory;
  message: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export interface LogPage {
  logs: LogEntry[];
  nextBefore: number | null;
}

export interface LogsQuery {
  level?: LogLevel;
  category?: LogCategory;
  before?: string;
  limit?: string;
}

export type ApiContractName =
  | 'loginRequest'
  | 'loginResponse'
  | 'idParams'
  | 'contact'
  | 'contactList'
  | 'createContactRequest'
  | 'updateContactRequest'
  | 'archiveRequest'
  | 'campaign'
  | 'campaignList'
  | 'recipientCount'
  | 'recipient'
  | 'campaignDetail'
  | 'createCampaignRequest'
  | 'campaignCreatedResponse'
  | 'okResponse'
  | 'archiveCampaignResponse'
  | 'suggestRequest'
  | 'suggestResponse'
  | 'uploadedMedia'
  | 'mediaConflict'
  | 'mediaConflictQuery'
  | 'accountBalanceResponse'
  | 'logEntry'
  | 'logPage'
  | 'logsQuery';

export interface ContractMap {
  loginRequest: Schema<LoginRequest>;
  loginResponse: Schema<LoginResponse>;
  idParams: Schema<IdParams>;
  contact: Schema<Contact>;
  contactList: Schema<Contact[]>;
  createContactRequest: Schema<CreateContactRequest>;
  updateContactRequest: Schema<UpdateContactRequest>;
  archiveRequest: Schema<ArchiveRequest>;
  campaign: Schema<Campaign>;
  campaignList: Schema<Campaign[]>;
  recipientCount: Schema<RecipientCount>;
  recipient: Schema<Recipient>;
  campaignDetail: Schema<CampaignDetail>;
  createCampaignRequest: Schema<CreateCampaignRequest>;
  campaignCreatedResponse: Schema<CampaignCreatedResponse>;
  okResponse: Schema<OkResponse>;
  archiveCampaignResponse: Schema<ArchiveCampaignResponse>;
  suggestRequest: Schema<SuggestRequest>;
  suggestResponse: Schema<SuggestResponse>;
  uploadedMedia: Schema<UploadedMedia>;
  mediaConflict: Schema<MediaConflict>;
  mediaConflictQuery: Schema<MediaConflictQuery>;
  accountBalanceResponse: Schema<AccountBalanceResponse>;
  logEntry: Schema<LogEntry>;
  logPage: Schema<LogPage>;
  logsQuery: Schema<LogsQuery>;
}

export const contracts: ContractMap;

export function validate<S extends Schema<unknown>>(
  contract: S,
  value: unknown,
): ValidationResult<Infer<S>>;
