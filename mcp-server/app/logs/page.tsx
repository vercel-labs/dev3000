import LogsClient from './LogsClient';

export default function LogsPage() {
  const version = process.env.DEV_PLAYWRIGHT_VERSION || '0.0.0';
  
  return <LogsClient version={version} />;
}