import LogsClient from './LogsClient';

export default function LogsPage() {
  const version = process.env.DEV3000_VERSION || '0.0.0';
  
  return <LogsClient version={version} />;
}