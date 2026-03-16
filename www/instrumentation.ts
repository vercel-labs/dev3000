import { registerOTel } from "@vercel/otel"

export function register() {
  registerOTel({
    serviceName: "dev3000-www",
    // Attributes attached to every span — useful for filtering in the trace viewer
    attributes: {
      "deployment.environment": process.env.VERCEL_ENV ?? "development",
      "git.commit.sha": process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
      "git.commit.ref": process.env.VERCEL_GIT_COMMIT_REF ?? "unknown"
    }
  })
}
