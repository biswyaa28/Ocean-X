import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const ua = request.headers.get('user-agent') || 'unknown';
  const host = request.headers.get('host') || 'unknown';
  console.log(`[HEALTH_PROBE] Pinged from Host: ${host}, User-Agent: ${ua}`);
  return NextResponse.json({ status: 'ok', time: new Date().toISOString() });
}
