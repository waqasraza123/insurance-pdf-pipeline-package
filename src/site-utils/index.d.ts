export const email: {
  pick(v: unknown): string;
  esc(v?: unknown): string;
  originFromEnv(env: any): string;
  label(map: Record<string, string>, raw: unknown, fallback?: string): string;
  money(v: unknown, opts?: { locale?: string; currency?: string }): string;
  yn(v: unknown): string;
};

export const pdf: {
  pick(v: unknown): string;
  label(map: Record<string, string>, raw: unknown): string;
  money(v: unknown, opts?: { locale?: string; currency?: string }): string;
  yn(v: unknown): string;
  safeIso(v: unknown): string;
};
