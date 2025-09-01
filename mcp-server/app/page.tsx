export default function HomePage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full">
        <h1 className="text-3xl font-bold text-gray-900 mb-6 text-center">
          Dev Log Feed
        </h1>
        
        <div className="space-y-4">
          <a 
            href="/logs"
            className="block w-full bg-blue-500 text-white text-center py-3 px-4 rounded hover:bg-blue-600 transition-colors"
          >
            📊 View Development Logs
          </a>
          
          <a 
            href="/api/mcp/http"
            className="block w-full bg-green-500 text-white text-center py-3 px-4 rounded hover:bg-green-600 transition-colors"
          >
            🤖 MCP Endpoint
          </a>
        </div>
        
        <div className="mt-6 text-sm text-gray-600 text-center">
          <p>Real-time development monitoring with visual context</p>
          <p className="mt-2">Server logs + Browser events + Screenshots</p>
        </div>
      </div>
    </div>
  );
}