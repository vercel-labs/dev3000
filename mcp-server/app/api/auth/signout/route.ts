import { cookies } from "next/headers"

export async function POST() {
  const cookieStore = await cookies()
  const accessToken = cookieStore.get("access_token")?.value

  if (!accessToken) {
    return Response.json({ error: "No access token found" }, { status: 401 })
  }

  const credentials = `${process.env.NEXT_PUBLIC_CLIENT_ID}:${process.env.CLIENT_SECRET}`

  const response = await fetch("https://vercel.com/api/login/oauth/token/revoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(credentials).toString("base64")}`
    },
    body: new URLSearchParams({
      token: accessToken
    })
  })

  if (!response.ok) {
    const errorData = await response.json()
    console.error("Error revoking token:", errorData)
    return Response.json({ error: "Failed to revoke access token" }, { status: response.status })
  }

  cookieStore.set("access_token", "", { maxAge: 0 })
  cookieStore.set("refresh_token", "", { maxAge: 0 })

  return Response.json({}, { status: response.status })
}
