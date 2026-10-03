import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'authenticated');
  if (!auth.ok) return auth.response;
  const usage = req.nextUrl.searchParams.get('usage');
  const heads = await prisma.accountingHead.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } });
  return NextResponse.json(usage ? heads.filter((h) => h.usage.split(',').includes(usage)) : heads);
}
