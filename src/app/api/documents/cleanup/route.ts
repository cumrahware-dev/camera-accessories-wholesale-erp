import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { reconcilePendingDeletes } from '@/lib/documents/purge';

export const dynamic = 'force-dynamic';

/** Retries stored-file removals that failed when a document was deleted. Idempotent. */
export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'documents.delete');
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await reconcilePendingDeletes());
  } catch (e: any) {
    console.error('[document cleanup]', e?.message);
    return NextResponse.json({ error: 'The cleanup could not be run.' }, { status: 500 });
  }
}
