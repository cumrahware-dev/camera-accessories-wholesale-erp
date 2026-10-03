import 'server-only';
import { NextResponse } from 'next/server';
import { PurchasingError } from './common';

export function purchasingError(e: unknown) {
  if (e instanceof PurchasingError) return NextResponse.json({ error: e.message, ...(e.extra || {}) }, { status: e.status });
  const msg = (e as any)?.message || '';
  // database-level immutability guards
  if (/immutable|append-only/i.test(msg)) return NextResponse.json({ error: 'This record is posted and cannot be changed.' }, { status: 409 });
  if ((e as any)?.code === 'P2002') return NextResponse.json({ error: 'A record with the same reference already exists.' }, { status: 409 });
  console.error('[purchasing] unexpected error:', msg);
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
}

export const actorOf = (u: { id: string; name: string; role: string }) => ({ id: u.id, name: u.name, role: u.role });
