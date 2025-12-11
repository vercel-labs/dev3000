/**
 * Health check endpoint for cloud fix workflow
 */
export async function GET() {
  return Response.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    message: "Cloud fix workflow endpoint is deployed and accessible"
  })
}
