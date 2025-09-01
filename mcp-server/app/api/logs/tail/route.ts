import { NextRequest } from 'next/server';
import { readFileSync, existsSync } from 'fs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const lines = parseInt(searchParams.get('lines') || '50');
    const logPath = searchParams.get('logPath') || process.env.LOG_FILE_PATH || './ai-dev-tools/consolidated.log';
    
    if (!existsSync(logPath)) {
      return Response.json({ error: 'Log file not found' }, { status: 404 });
    }
    
    const logContent = readFileSync(logPath, 'utf-8');
    const allLines = logContent.split('\n').filter(line => line.trim());
    const tailLines = allLines.slice(-lines);
    
    return Response.json({ 
      lines: tailLines,
      total: allLines.length 
    });
  } catch (error) {
    return Response.json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}