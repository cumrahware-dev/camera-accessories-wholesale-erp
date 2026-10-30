export const CARRIER_TYPES = ['AIR_CARGO', 'COURIER', 'SEA_FREIGHT', 'ROAD_TRANSPORT', 'OTHER'] as const;
export type CarrierType = (typeof CARRIER_TYPES)[number];

export const CARRIER_TYPE_LABELS: Record<CarrierType, string> = {
  AIR_CARGO: 'Air Cargo',
  COURIER: 'Courier',
  SEA_FREIGHT: 'Sea Freight',
  ROAD_TRANSPORT: 'Road Transport',
  OTHER: 'Other',
};

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

/** Validates a carrier create/update body. `requireName` = true for create (PATCH may leave fields unset). */
export function parseCarrierInput(body: any, requireName: boolean) {
  const name = typeof body?.name === 'string' ? body.name.trim() : undefined;
  if (requireName && !name) return { error: 'Carrier name is required.' };
  if (name !== undefined && name.length > 200) return { error: 'Carrier name is too long.' };
  const type = body?.type !== undefined ? ((CARRIER_TYPES as readonly string[]).includes(body.type) ? body.type : 'COURIER') : undefined;
  const opt = (v: unknown, max = 500) => {
    if (v === undefined) return undefined;
    const s = typeof v === 'string' ? v.trim() : '';
    return s ? s.slice(0, max) : null;
  };
  const email = opt(body?.email, 200);
  if (email && !EMAIL_RE.test(email)) return { error: 'Enter a valid email address, or leave it blank.' };

  const data: Record<string, unknown> = {};
  if (name !== undefined) data.name = name;
  if (type !== undefined) data.type = type;
  const fields: [string, unknown][] = [
    ['code', opt(body?.code, 40)],
    ['contactPerson', opt(body?.contactPerson, 150)],
    ['contactNumber', opt(body?.contactNumber, 60)],
    ['email', email],
    ['website', opt(body?.website, 300)],
    ['trackingUrlTemplate', opt(body?.trackingUrlTemplate, 500)],
    ['address', opt(body?.address, 500)],
    ['remarks', opt(body?.remarks, 1000)],
  ];
  for (const [k, v] of fields) if (v !== undefined) data[k] = v;
  if (typeof body?.isActive === 'boolean') data.isActive = body.isActive;

  return { data: data as { name?: string; type?: CarrierType; code?: string | null; contactPerson?: string | null; contactNumber?: string | null; email?: string | null; website?: string | null; trackingUrlTemplate?: string | null; address?: string | null; remarks?: string | null; isActive?: boolean } };
}

/** Fills {awb} in a carrier's tracking URL template; null when no template is configured. */
export function trackingUrlFor(template: string | null | undefined, awb: string): string | null {
  const t = (template || '').trim();
  if (!t) return null;
  return t.replace(/\{awb\}/gi, encodeURIComponent(awb));
}
