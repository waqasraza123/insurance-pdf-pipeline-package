export type LeadStatusResp = {
  leadId?: string;
  correlationId?: string;
  status: string;
  stage: string;
  attempts: number;
  updatedAt?: string;
  doneAt?: string;
  error?: { message?: string } | null;
  pdfError?: { message?: string } | null;
};

export type UiState =
  | { kind: "idle" }
  | { kind: "progress"; title: string; detail: string; canRetry?: false }
  | { kind: "success"; title: string; detail: string; canRetry?: false }
  | { kind: "error"; title: string; detail: string; canRetry: boolean };

export function safeTrim(v: unknown): string;
export function readJsonSafe(res: Response): Promise<any | null>;

export function saveLeadId(
  leadId: string,
  opts?: { storageKey?: string; storage?: "session" | "local" },
): void;

export function readLeadIdFromUrl(opts?: {
  href?: string;
  param?: string;
}): string | null;

export function readLeadIdFromStorage(opts?: {
  storageKey?: string;
  storage?: "session" | "local";
}): string | null;

export function getLeadId(opts?: {
  href?: string;
  param?: string;
  storageKey?: string;
  storage?: "session" | "local";
  storageKeyLocal?: string;
}): string | null;

export function extractLeadIdFromBody(body: any): string;

export function buildThankYouUrl(
  leadId: string,
  opts?: { path?: string; param?: string },
): string;

export function validateEmail(email: string): boolean;
export function validatePhone(phone: string): boolean;

export function submitLead(
  payload: any,
  opts?: { endpoint?: string; timeoutMs?: number },
): Promise<{ ok: boolean; status: number; correlationId?: string; body: any }>;

export function normalizeLeadStatus(json: any): any;
export function norm(v: unknown): string;
export function isTerminalStatus(s: any): boolean;

export function leadUiFromStatus(
  s: any,
  opts?: {
    maxAttempts?: number;
    workingDetail?: string;
    successDetail?: string;
  },
): UiState;

export function fetchLeadStatus(
  leadId: string,
  opts?: { endpoint?: string },
): Promise<LeadStatusResp>;

export function retryLead(
  leadId: string,
  opts?: { endpoint?: string },
): Promise<boolean>;

export function pollLeadStatus(
  leadId: string,
  opts?: {
    onUi?: (ui: UiState, status: LeadStatusResp | null) => void;
    endpoint?: string;
    statusEndpoint?: string;
    endpointStatus?: string;
    intervalMs?: number;
    maxIntervalMs?: number;
    hardStopMs?: number;
    maxAttempts?: number;
    workingDetail?: string;
    successDetail?: string;
  },
): Promise<LeadStatusResp | null>;

export function logoDev(
  domain: string,
  opts: { token: string; size?: number },
): string;
