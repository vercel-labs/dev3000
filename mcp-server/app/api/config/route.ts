import { NextResponse } from 'next/server';
import { ConfigApiResponse } from '../../types';

export async function GET(): Promise<NextResponse> {
  const response: ConfigApiResponse = {
    version: process.env.DEV_PLAYWRIGHT_VERSION || '0.0.0'
  };
  
  return NextResponse.json(response);
}