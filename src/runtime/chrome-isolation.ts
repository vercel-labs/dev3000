import { spawn } from "node:child_process"
import { createHash, X509Certificate } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { connect } from "node:tls"
import { getAgentBrowserBinaryPath } from "../utils/agent-browser.js"

/** Filesystem confinement applies to Chrome's browser process and every child, including CDP file operations. */
export function isolatedChromeInvocation(binary: string, args: string[], profile: string, certificatePin?: string) {
  if (process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec"))
    throw new Error("Sandbox mode requires macOS Chrome filesystem isolation; this platform is not supported yet")
  const executable = realpathSync(binary)
  const marker = executable.indexOf(".app/")
  if (marker < 0) throw new Error("Sandbox mode requires Chrome installed in an application bundle")
  mkdirSync(profile, { recursive: true, mode: 0o700 })
  const directory = realpathSync(resolve(profile))
  const temporary = join(directory, "d3k-temp")
  mkdirSync(temporary, { recursive: true, mode: 0o700 })
  const readable = [
    executable.slice(0, marker + 4),
    "/System/Library",
    "/System/Cryptexes",
    "/usr/lib",
    "/usr/share",
    "/usr/bin",
    "/bin",
    "/sbin",
    "/Library/Fonts",
    "/Library/Apple",
    "/private/preboot",
    "/private/var/db/dyld",
    "/private/etc",
    "/private/var/run",
    "/Library/Preferences/SystemConfiguration",
    "/dev",
    directory
  ]
  // Chrome's singleton socket ignores TMPDIR on macOS. Allow only its generated socket directories.
  const socket = '(regex #"^/private/var/folders/[^/]+/[^/]+/T/com\\.google\\.Chrome[^/]*(/.*)?$")'
  const except = (paths: string[]) =>
    `(require-all (require-not (literal "/")) ${paths.map((path) => `(require-not (subpath ${JSON.stringify(path)}))`).join(" ")} (require-not ${socket}))`
  const policy = `(version 1)
(allow default)
(deny file-read-data ${except(readable)})
(deny file-write* ${except([directory, "/dev"])})
(deny appleevent-send)
(deny mach-lookup (global-name "com.apple.pasteboard.1") (global-name "com.apple.pasteboard") (global-name "com.apple.pbs"))`
  // Seatbelt cannot be nested. The outer policy confines all Chrome processes, rather than renderers alone.
  const chromeArgs = args.filter((arg) => arg !== "--no-sandbox" && arg !== "--disable-setuid-sandbox")
  chromeArgs.push(
    "--no-sandbox",
    "--disable-breakpad",
    "--password-store=basic",
    "--use-mock-keychain",
    "--disable-features=ChromeBrowserCloudManagement",
    `--crash-dumps-dir=${join(temporary, "crashes")}`
  )
  if (certificatePin) chromeArgs.push(`--ignore-certificate-errors-spki-list=${certificatePin}`)
  return {
    binary: "/usr/bin/sandbox-exec",
    args: ["-p", policy, executable, ...chromeArgs],
    env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8", HOME: directory, TMPDIR: temporary }
  }
}

/** Use the separately installed automation browser, never a managed everyday profile. */
export async function sandboxChromePath(log: (message: string) => void): Promise<string> {
  if (process.platform !== "darwin") throw new Error("Sandbox mode currently requires macOS filesystem confinement")
  const installed = findSandboxChrome()
  if (installed) return installed
  log("Downloading Chrome for Testing for the isolated browser (first run only)")
  await new Promise<void>((accept, reject) => {
    const installer = spawn(getAgentBrowserBinaryPath(), ["install"], { stdio: "inherit", shell: false })
    installer.once("error", (error) => reject(new Error(`Could not install Chrome for Testing: ${error.message}`)))
    installer.once("exit", (code) => {
      if (code === 0) accept()
      else reject(new Error("Chrome for Testing installation failed. Check your network connection and retry d3k."))
    })
  })
  const binary = findSandboxChrome()
  if (!binary) throw new Error("Chrome for Testing installation completed but its application bundle was not found")
  return binary
}

function findSandboxChrome(): string | undefined {
  const root = join(homedir(), ".agent-browser", "browsers")
  const installed = existsSync(root) ? readdirSync(root).filter((name) => /^chrome-[0-9.]+$/.test(name)) : []
  installed.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  for (const name of installed) {
    const binary = join(root, name, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing")
    if (existsSync(binary)) return binary
  }
  return undefined
}

/** Trust exactly the certificate served by canonical Portless, without reading the user's keychain. */
export async function portlessCertificatePin(appUrl: string): Promise<string> {
  return new Promise((accept, reject) => {
    const socket = connect({
      host: "127.0.0.1",
      port: 443,
      servername: new URL(appUrl).hostname,
      rejectUnauthorized: false
    })
    socket.setTimeout(5000, () => socket.destroy(new Error("Portless TLS certificate unavailable")))
    socket.once("error", reject)
    socket.once("secureConnect", () => {
      try {
        const certificate = new X509Certificate(socket.getPeerCertificate().raw)
        const publicKey = certificate.publicKey.export({ type: "spki", format: "der" })
        accept(createHash("sha256").update(publicKey).digest("base64"))
      } catch (error) {
        reject(error)
      } finally {
        socket.destroy()
      }
    })
  })
}
