#!/usr/bin/env tsx

import { exec } from 'child_process';
import { existsSync } from 'fs';

console.log('🧪 Testing postinstall script locally...');
console.log('📍 Current directory:', process.cwd());
console.log('📁 mcp-server directory exists:', existsSync('mcp-server'));

const command = 'cd mcp-server && pnpm install --frozen-lockfile --silent --no-optional';
console.log('🚀 Running command:', command);

const startTime = Date.now();
const child = exec(command, (error, stdout, stderr) => {
  const duration = Date.now() - startTime;
  console.log(`⏰ Command completed in ${duration}ms`);
  
  if (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
  
  if (stdout) {
    console.log('📝 STDOUT:', stdout);
  }
  
  if (stderr) {
    console.log('⚠️  STDERR:', stderr);
  }
  
  console.log('✅ Postinstall script completed successfully');
  process.exit(0);
});

// Add timeout to detect hanging
const timeout = setTimeout(() => {
  console.log('⏰ Script has been running for more than 30 seconds...');
  console.log('🔍 Child process PID:', child.pid);
  console.log('📊 Child process still running');
}, 30000);

child.on('exit', (code) => {
  clearTimeout(timeout);
  console.log('🏁 Child process exited with code:', code);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n🛑 Received SIGINT, killing child process...');
  child.kill('SIGTERM');
  clearTimeout(timeout);
  process.exit(1);
});