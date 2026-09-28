import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-auth';
import { answerSalesQuestion, SUGGESTED_QUESTIONS } from '@/lib/sales-assistant';

export async function GET(req: NextRequest) {
  const auth = await guardApi(req, 'reports.sales');
  if (!auth.ok) return auth.response;

  return NextResponse.json({ suggestedQuestions: SUGGESTED_QUESTIONS });
}

export async function POST(req: NextRequest) {
  const auth = await guardApi(req, 'reports.sales');
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json().catch(() => ({}));
    const question = (body.question || '').trim();

    if (!question) {
      return NextResponse.json({ error: 'A question is required' }, { status: 400 });
    }

    const answer = await answerSalesQuestion(question, auth.user);
    return NextResponse.json({ success: true, answer });
  } catch (error: any) {
    console.error('Sales assistant error:', error);
    return NextResponse.json({ error: error.message || 'Failed to answer question' }, { status: 500 });
  }
}
