import 'server-only';
import { NextResponse } from 'next/server';
import { PurchasingError } from './common';

export function purchasingError(e: unknown) {
  if (e instanceof PurchasingError) return NextResponse.json({ error: e.message, ...(e.extra || {}) }, { status: e.status });
  const msg = (e as any)?.message || '';
  // database-level immutability guards
  if (/immutable|append-only/i.test(msg)) return NextResponse.json({ error: 'This record is posted and cannot be changed.' }, { status: 409 });
  const code = (e as any)?.code as string | undefined;
  if (code === 'P2002') return NextResponse.json({ error: 'A record with the same reference already exists.' }, { status: 409 });
  // Every unexpected failure is logged in full and answered with a specific, actionable message plus a short code that
  // support can match to the server log; a bare "Something went wrong" hides the cause.
  const ref = Math.random().toString(36).slice(2, 8).toUpperCase();
  console.error(`[purchasing] unexpected error [${ref}] ${code || (e as any)?.name || ''}:`, msg);
  const fail = (status: number, error: string) => NextResponse.json({ error: `${error} (ref ${ref})`, code: code || 'UNEXPECTED', ref }, { status });
  if (code === 'P2021' || code === 'P2022' || /does not exist in the current database|column .* does not exist|relation .* does not exist/i.test(msg)) {
    return fail(503, 'The database is not up to date with this version of the application (a table or column is missing). Ask your administrator to run the pending database migrations (prisma migrate deploy)');
  }
  if (code === 'P2028') return fail(503, 'The database took too long to complete the posting, so nothing was changed. Please try again; if it keeps happening the database connection is slow');
  if (/invalid input syntax for type (integer|bigint)|out of range for type integer/i.test(msg)) return fail(503, 'The database still stores quantities as whole numbers. Ask your administrator to run the pending database migrations (prisma migrate deploy)');
  const cons = /violates (foreign key|unique|check|not-null) constraint "([^"]+)"/i.exec(msg) || /null value in column "([^"]+)"/i.exec(msg);
  if (cons) return fail(409, `The database rejected the change (${cons[0].replace(/^.*?(violates|null)/i, '$1')})`);
  if (code === 'P2003') return fail(409, 'A linked record (supplier, depot or product) no longer exists. Reload the page and select it again');
  if (code === 'P2000') return fail(400, 'One of the values is too long for its field. Shorten the supplier invoice number or notes');
  if (code === 'P2025') return fail(404, 'The record was not found or was changed by someone else. Reload the page');
  if (code === 'P2034' || /deadlock|could not serialize/i.test(msg)) return fail(409, 'Another user was updating the same records. Please try again');
  if (e instanceof Error && e.name === 'PrismaClientValidationError') return fail(400, 'The invoice contains a value the database cannot store. Check quantities, costs and dates');
  if (/offline|timed out|ECONNREFUSED|Can't reach database|connection/i.test(msg) || code === 'P1001' || code === 'P1002' || code === 'P1017') {
    return fail(503, 'The database is temporarily unavailable. Nothing was saved; please try again in a moment');
  }
  return fail(500, 'The invoice could not be saved because of an unexpected server error');
}

export const actorOf = (u: { id: string; name: string; role: string }) => ({ id: u.id, name: u.name, role: u.role });
