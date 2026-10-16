import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { guardApi } from '@/lib/api-auth';
import { retryEmailLog } from '@/lib/email-service';
import dataStore from '@/lib/data-store';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'authenticated');
  if (!auth.ok) return auth.response;

  try {
    const searchParams = req.nextUrl.searchParams;
    const status = searchParams.get('status');
    const type = searchParams.get('type');

    let logs: any[] = [];
    try {
      const where: any = {};
      if (status && status !== 'ALL') where.status = status;
      if (type && type !== 'ALL') where.notificationType = type;

      logs = await prisma.emailLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    } catch {
      logs = [];
    }

    return NextResponse.json(logs);
  } catch (error: any) {
    console.error('Error fetching notification logs:', error);
    return NextResponse.json({ error: 'Failed to fetch notification logs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'authenticated');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const { logId } = body;

    if (!logId) {
      return NextResponse.json({ error: 'Notification logId is required for retry' }, { status: 400 });
    }

    const result = await retryEmailLog(logId);
    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error retrying notification:', error);
    return NextResponse.json({ error: error.message || 'Retry failed' }, { status: 500 });
  }
}
