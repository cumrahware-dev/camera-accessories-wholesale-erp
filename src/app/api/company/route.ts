import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { hasPermission } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { invalidateCompanySettingsCache } from '@/lib/settings-cache';
import { composeAddress, bankAccountUsage } from '@/lib/company';
import { COMPANY_TEXT_FIELDS, validateCompany } from '@/lib/company-input';

export const dynamic = 'force-dynamic';

const SETTINGS_ID = 'global-settings';
const VIEW_FIELDS = [...COMPANY_TEXT_FIELDS, 'companyAddress', 'invoiceNextNumber', 'proformaNextNumber'] as const;

const pick = (row: any) => Object.fromEntries(VIEW_FIELDS.map((k) => [k, row?.[k] ?? '']));

/** Company & Business Details for the settings page. Super Admin edits; Manager can view; depot users have no access. */
export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'company.read');
  if (!auth.ok) return auth.response;
  try {
    const [row, banks] = await Promise.all([
      prisma.companySettings.findUnique({ where: { id: SETTINGS_ID } }),
      prisma.bankAccount.findMany({ orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    const bankAccounts = await Promise.all(banks.map(async (b) => ({ ...b, usedByIssuedDocuments: await bankAccountUsage(b.id) })));
    return NextResponse.json({ company: pick(row), bankAccounts, canEdit: hasPermission(auth.user.role, 'settings.write', auth.user.permissionRevokes) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e: any) {
    console.error('[company] load failed:', e?.message);
    return NextResponse.json({ error: 'Could not load company details.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await guardApi(req, 'settings.write');
  if (!auth.ok) return auth.response;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  try {
    const current: any = (await prisma.companySettings.findUnique({ where: { id: SETTINGS_ID } })) || {};
    const { errors, data } = validateCompany(body, current);
    if (Object.keys(errors).length) return NextResponse.json({ error: 'Please correct the highlighted fields.', fields: errors }, { status: 400 });

    // The printed address is composed from its parts, one line per row.
    const after = { ...current, ...data };
    data.companyAddress = composeAddress({ office: after.addressOffice, building: after.addressBuilding, street: after.addressStreet, area: after.addressArea, poBox: after.poBox, city: after.addressCity, country: after.addressCountry });
    if (data.vatGstNumber !== undefined) data.taxRegistrationNumber = data.vatGstNumber; // one TRN, never two that disagree

    const changed = Object.keys(data).filter((k) => k !== 'companyAddress' && String(current[k] ?? '') !== String(data[k] ?? '')).concat(String(current.companyAddress ?? '') !== data.companyAddress ? ['companyAddress'] : []);
    const row = await prisma.companySettings.upsert({ where: { id: SETTINGS_ID }, update: data, create: { id: SETTINGS_ID, ...data } });
    invalidateCompanySettingsCache();
    if (changed.length) {
      await writeAudit({ id: auth.user.id, name: auth.user.name, role: auth.user.role }, {
        action: 'COMPANY_DETAILS_UPDATED', entityType: 'CompanySettings', entityId: SETTINGS_ID, entityLabel: 'Company & Business Details',
        description: `Company details updated: ${changed.join(', ')}`,
        previousValue: Object.fromEntries(changed.map((k) => [k, current[k] ?? ''])), newValue: Object.fromEntries(changed.map((k) => [k, (row as any)[k] ?? ''])),
      });
    }
    return NextResponse.json({ company: pick(row), changed, message: 'Company details updated successfully.' });
  } catch (e: any) {
    console.error('[company] save failed:', e?.message);
    return NextResponse.json({ error: 'Could not save company details. Nothing was changed.' }, { status: 500 });
  }
}
