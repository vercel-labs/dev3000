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
    
    // Parse interaction events (both old and new formats)
    const interactionMatch = line.match(/\[INTERACTION\] (.+)/);
    if (interactionMatch) {
      const data = interactionMatch[1];
      
      try {
        // Try parsing as JSON (new format)
        const interactionData = JSON.parse(data);
        
        if (interactionData.type === 'CLICK' || interactionData.type === 'TAP') {
          interactions.push({
            timestamp,
            type: interactionData.type as 'CLICK' | 'TAP',
            x: interactionData.coordinates?.x || 0,
            y: interactionData.coordinates?.y || 0,
            target: interactionData.target || 'unknown'
          });
        } else if (interactionData.type === 'SCROLL') {
          interactions.push({
            timestamp,
            type: 'SCROLL',
            direction: interactionData.direction || 'DOWN',
            distance: interactionData.distance || 0,
            x: interactionData.to?.x || 0,
            y: interactionData.to?.y || 0
          });
        } else if (interactionData.type === 'KEY') {
          interactions.push({
            timestamp,
            type: 'KEY',
            key: interactionData.key || 'unknown',
            target: interactionData.target || 'unknown'
          });
        }
      } catch (jsonError) {
        // Fallback to old format parsing
        const oldFormatMatch = data.match(/(CLICK|TAP|SCROLL|KEY) (.+)/);
        if (oldFormatMatch) {
          const [, type, details] = oldFormatMatch;
          
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
      // Generate CDP commands for replay
      const cdpCommands = generateCDPCommands(replayData, speed);
      
      // Try to execute the commands via CDP
      try {
        const result = await executeCDPCommands(cdpCommands);
        return NextResponse.json({
          success: true,
          message: 'Replay executed successfully',
          result: result,
          totalCommands: cdpCommands.length
        });
      } catch (error) {
        // Fallback: return commands for manual execution
        return NextResponse.json({
          success: false,
          message: 'CDP execution failed, returning commands for manual execution',
          commands: cdpCommands,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
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

interface CDPCommand {
  method: string;
  params: any;
  delay: number;
  description: string;
}

function generateCDPCommands(replayData: ReplayData, speed: number): CDPCommand[] {
  const events = [
    ...replayData.interactions.map(i => ({ ...i, eventType: 'interaction' })),
    ...replayData.navigations.map(n => ({ ...n, eventType: 'navigation' }))
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  
  const commands: CDPCommand[] = [];
  const startTime = new Date(replayData.startTime).getTime();
  
  for (const event of events) {
    const eventTime = new Date(event.timestamp).getTime();
    const delay = Math.max(0, (eventTime - startTime) / speed);
    
    if (event.eventType === 'navigation') {
      commands.push({
        method: 'Page.navigate',
        params: { url: event.url },
        delay: delay,
        description: `Navigate to ${event.url}`
      });
    } else if (event.eventType === 'interaction') {
      if (event.type === 'CLICK' && event.x !== undefined && event.y !== undefined) {
        // Mouse down
        commands.push({
          method: 'Input.dispatchMouseEvent',
          params: {
            type: 'mousePressed',
            x: event.x,
            y: event.y,
            button: 'left',
            clickCount: 1
          },
          delay: delay,
          description: `Click at (${event.x}, ${event.y}) on ${event.target}`
        });
        
        // Mouse up (after small delay)
        commands.push({
          method: 'Input.dispatchMouseEvent',
          params: {
            type: 'mouseReleased',
            x: event.x,
            y: event.y,
            button: 'left',
            clickCount: 1
          },
          delay: 50, // 50ms between down and up
          description: `Release click at (${event.x}, ${event.y})`
        });
      } else if (event.type === 'SCROLL' && event.x !== undefined && event.y !== undefined) {
        commands.push({
          method: 'Runtime.evaluate',
          params: {
            expression: `window.scrollTo({left: ${event.x}, top: ${event.y}, behavior: 'smooth'})`
          },
          delay: delay,
          description: `Scroll to (${event.x}, ${event.y})`
        });
      } else if (event.type === 'KEY' && event.key) {
        // Key down
        commands.push({
          method: 'Input.dispatchKeyEvent',
          params: {
            type: 'keyDown',
            key: event.key,
            text: event.key.length === 1 ? event.key : undefined
          },
          delay: delay,
          description: `Key down: ${event.key}`
        });
        
        // Key up
        commands.push({
          method: 'Input.dispatchKeyEvent',
          params: {
            type: 'keyUp',
            key: event.key
          },
          delay: 50,
          description: `Key up: ${event.key}`
        });
      }
    }
  }
  
  return commands;
}

async function executeCDPCommands(commands: CDPCommand[]): Promise<any> {
  // For now, we'll try to connect to the CDP session
  // This would require the browser to be launched with --remote-debugging-port
  // or we'd need to get the CDP endpoint from the Playwright instance
  
  // Since we can't easily access the existing Playwright browser from here,
  // let's return the commands for the client to execute
  throw new Error('Direct CDP execution not yet implemented - browser connection needed');
}