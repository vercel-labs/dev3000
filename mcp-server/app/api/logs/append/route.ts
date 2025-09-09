import { NextRequest } from 'next/server';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

interface LogEntry {
  entry: string;
  source?: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const body = await request.json();
    const { entry, source }: LogEntry = body;
    
    if (!entry) {
      return Response.json({ error: 'Log entry is required' }, { 
        status: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      });
    }
    
    const logPath = process.env.LOG_FILE_PATH || './ai-dev-tools/consolidated.log';
    
    // Ensure directory exists
    const logDir = dirname(logPath);
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    
    // Append the log entry
    const logLine = `${entry}\n`;
    appendFileSync(logPath, logLine, 'utf-8');
    
    return Response.json({ 
      success: true, 
      message: 'Log entry appended',
      source: source || 'unknown'
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
    
  } catch (error) {
    console.error('Failed to append log:', error);
    return Response.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { 
      status: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    });
  }
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}