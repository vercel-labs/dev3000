import { spawn } from 'node:child_process';
const proc = spawn('docker', ['compose', '-f', 'docker/docker-compose.yml', 'down'], { stdio: 'inherit' });
proc.on('exit', (code) => process.exit(code ?? 0));
