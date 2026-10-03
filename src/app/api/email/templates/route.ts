import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { DEFAULT_TEMPLATES, TEMPLATE_LABELS, TEMPLATE_VARIABLES, getTemplate, isTemplateKey, type TemplateKey } from '@/lib/email/templates';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'settings.read');
  if (!auth.ok) return auth.response;
  const keys = Object.keys(DEFAULT_TEMPLATES) as TemplateKey[];
  const templates = await Promise.all(keys.map(async (key) => ({ key, label: TEMPLATE_LABELS[key], ...(await getTemplate(key)), defaults: DEFAULT_TEMPLATES[key] })));
  return NextResponse.json({ templates, variables: TEMPLATE_VARIABLES });
}

/** { key, subject, body } saves an override; { key, reset: true } restores the default. */
export async function PUT(req: NextRequest) {
  const auth = await guardApi(req, 'settings.write');
  if (!auth.ok) return auth.response;
  const b = await req.json().catch(() => null);
  if (!b || !isTemplateKey(b.key)) return NextResponse.json({ error: 'Unknown template.' }, { status: 400 });
  const key = b.key as TemplateKey;
  const actor = { id: auth.user.id, name: auth.user.name, role: auth.user.role };
  if (b.reset) {
    await prisma.emailTemplate.deleteMany({ where: { key } });
    await writeAudit(actor, { action: 'EMAIL_TEMPLATE_RESET', entityType: 'EmailTemplate', entityId: key, entityLabel: TEMPLATE_LABELS[key], description: `Email template "${TEMPLATE_LABELS[key]}" reset to default` });
    return NextResponse.json({ key, ...DEFAULT_TEMPLATES[key], customized: false });
  }
  const subject = String(b.subject ?? '').trim();
  const body = String(b.body ?? '').trim();
  if (!subject || subject.length > 250) return NextResponse.json({ error: 'Subject is required (up to 250 characters).' }, { status: 400 });
  if (!body || body.length > 10_000) return NextResponse.json({ error: 'Message is required (up to 10,000 characters).' }, { status: 400 });
  const row = await prisma.emailTemplate.upsert({
    where: { key },
    create: { key, subject, body, updatedById: auth.user.id, updatedByName: auth.user.name },
    update: { subject, body, updatedById: auth.user.id, updatedByName: auth.user.name },
  });
  await writeAudit(actor, { action: 'EMAIL_TEMPLATE_UPDATED', entityType: 'EmailTemplate', entityId: key, entityLabel: TEMPLATE_LABELS[key], description: `Email template "${TEMPLATE_LABELS[key]}" updated` });
  return NextResponse.json({ key: row.key, subject: row.subject, body: row.body, customized: true });
}
