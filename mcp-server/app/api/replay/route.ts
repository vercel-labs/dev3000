import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';

interface InteractionEvent {
  timestamp: string;
  type: 'CLICK' | 'TAP' | 'SCROLL' | 'KEY';
  x?: number;
  y?: number;
  target?: string;
  direction?: string;
  distance?: number;
  key?: string;
  url?: string;
}

interface NavigationEvent {
  timestamp: string;
  url: string;
}

interface ScreenshotEvent {
  timestamp: string;
  url: string;
  event: string;
}

interface ReplayData {
  interactions: InteractionEvent[];
  navigations: NavigationEvent[];
  screenshots: ScreenshotEvent[];
  startTime: string;
  endTime: string;
  duration: number;
}

function parseLogFile(logContent: string, startTime?: string, endTime?: string): ReplayData {
  const lines = logContent.split('\n');
  const interactions: InteractionEvent[] = [];
  const navigations: NavigationEvent[] = [];
  const screenshots: ScreenshotEvent[] = [];
  
  let actualStartTime = '';
  let actualEndTime = '';
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    const timestampMatch = line.match(/^\[([^\]]+)\]/);
    if (!timestampMatch) continue;
    
    const timestamp = timestampMatch[1];
    const logTime = new Date(timestamp);
    
    // Filter by time range if specified
    if (startTime && logTime < new Date(startTime)) continue;
    if (endTime && logTime > new Date(endTime)) continue;
    
    if (!actualStartTime) actualStartTime = timestamp;
    actualEndTime = timestamp;
    
    // Parse interaction events
    const interactionMatch = line.match(/\[INTERACTION\] (CLICK|TAP|SCROLL|KEY) (.+)/);
    if (interactionMatch) {
      const [, type, details] = interactionMatch;
      
      if (type === 'CLICK' || type === 'TAP') {
        const coordMatch = details.match(/at \((\d+), (\d+)\) on (.+)/);
        if (coordMatch) {
          interactions.push({
            timestamp,
            type: type as 'CLICK' | 'TAP',
            x: parseInt(coordMatch[1]),
            y: parseInt(coordMatch[2]),
            target: coordMatch[3]
          });
        }
      } else if (type === 'SCROLL') {
        const scrollMatch = details.match(/(\w+) (\d+)px to \((\d+), (\d+)\)/);
        if (scrollMatch) {
          interactions.push({
            timestamp,
            type: 'SCROLL',
            direction: scrollMatch[1],
            distance: parseInt(scrollMatch[2]),
            x: parseInt(scrollMatch[3]),
            y: parseInt(scrollMatch[4])
          });
        }
      } else if (type === 'KEY') {
        const keyMatch = details.match(/(.+) in (.+)/);
        if (keyMatch) {
          interactions.push({
            timestamp,
            type: 'KEY',
            key: keyMatch[1],
            target: keyMatch[2]
          });
        }
      }
    }
    
    // Parse navigation events
    const navigationMatch = line.match(/\[NAVIGATION\] (.+)/);
    if (navigationMatch) {
      navigations.push({
        timestamp,
        url: navigationMatch[1]
      });
    }
    
    // Parse screenshot events
    const screenshotMatch = line.match(/\[SCREENSHOT\] (.+)/);
    if (screenshotMatch) {
      const urlParts = screenshotMatch[1].split('/');
      const filename = urlParts[urlParts.length - 1];
      const eventType = filename.split('-').slice(3).join('-').replace('.png', '');
      
      screenshots.push({
        timestamp,
        url: screenshotMatch[1],
        event: eventType
      });
    }
  }
  
  const startTimeMs = new Date(actualStartTime).getTime();
  const endTimeMs = new Date(actualEndTime).getTime();
  const duration = endTimeMs - startTimeMs;
  
  return {
    interactions,
    navigations,
    screenshots,
    startTime: actualStartTime,
    endTime: actualEndTime,
    duration
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const startTime = searchParams.get('startTime');
    const endTime = searchParams.get('endTime');
    
    // Get log file path from environment
    const logFilePath = process.env.LOG_FILE_PATH || '/tmp/dev3000.log';
    
    if (!existsSync(logFilePath)) {
      return NextResponse.json({ error: 'Log file not found' }, { status: 404 });
    }
    
    const logContent = readFileSync(logFilePath, 'utf8');
    
    if (action === 'parse') {
      // Parse the log file and return replay data
      const replayData = parseLogFile(logContent, startTime || undefined, endTime || undefined);
      return NextResponse.json(replayData);
    }
    
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Replay API error:', error);
    return NextResponse.json(
      { error: 'Failed to process replay request' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, replayData, speed = 1 } = body;
    
    if (action === 'execute') {
      // For now, return the replay script that could be executed
      // In a full implementation, this could launch a new Playwright session
      const replayScript = generateReplayScript(replayData, speed);
      
      return NextResponse.json({
        success: true,
        message: 'Replay script generated',
        script: replayScript
      });
    }
    
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Replay execution error:', error);
    return NextResponse.json(
      { error: 'Failed to execute replay' },
      { status: 500 }
    );
  }
}

function generateReplayScript(replayData: ReplayData, speed: number): string {
  const events = [
    ...replayData.interactions.map(i => ({ ...i, eventType: 'interaction' })),
    ...replayData.navigations.map(n => ({ ...n, eventType: 'navigation' }))
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  let script = `
// Generated replay script
const replayEvents = ${JSON.stringify(events, null, 2)};
const speed = ${speed};
const startTime = new Date('${replayData.startTime}').getTime();

async function executeReplay() {
  console.log('Starting session replay...');
  
  for (const event of replayEvents) {
    const eventTime = new Date(event.timestamp).getTime();
    const delay = (eventTime - startTime) / speed;
    
    await new Promise(resolve => setTimeout(resolve, delay));
    
    if (event.eventType === 'navigation') {
      console.log('Navigate to:', event.url);
      // window.location.href = event.url;
    } else if (event.eventType === 'interaction') {
      if (event.type === 'CLICK') {
        console.log('Click at:', event.x, event.y, 'on', event.target);
        // Simulate click at coordinates
      } else if (event.type === 'SCROLL') {
        console.log('Scroll:', event.direction, event.distance + 'px to', event.x, event.y);
        // window.scrollTo(event.x, event.y);
      } else if (event.type === 'KEY') {
        console.log('Key press:', event.key, 'in', event.target);
        // Simulate key press
      }
    }
  }
  
  console.log('Replay complete!');
}

// executeReplay();
`;
  
  return script;
}