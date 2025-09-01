import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    logFilePath: process.env.LOG_FILE_PATH || '/tmp/dev-playwright-consolidated.log'
  });
}