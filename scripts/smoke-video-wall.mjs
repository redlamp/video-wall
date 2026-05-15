import { spawn, spawnSync } from "node:child_process"
import { mkdir, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { chromium } from "playwright"

const DEFAULT_URL = "http://127.0.0.1:3014/"
const SMOKE_URL = process.env.SMOKE_URL ?? DEFAULT_URL
const VIDEO_DIR = path.join(os.tmpdir(), "video-wall-smoke")
const VIDEO_FIXTURES = [
  { file: "landscape-a.mp4", size: "640x360", duration: 6 },
  { file: "landscape-b.mp4", size: "640x360", duration: 6 },
  { file: "portrait-a.mp4", size: "360x640", duration: 6 },
  { file: "portrait-b.mp4", size: "360x640", duration: 6 },
]

let devServer

function logStep(message) {
  process.stdout.write(`\n[smoke] ${message}\n`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function exists(filePath) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
  }
}

async function waitForServer(url, timeoutMs = 45000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable(url)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function ensureServer(url) {
  if (await isReachable(url)) return

  const parsedUrl = new URL(url)
  const host = parsedUrl.hostname
  const port = parsedUrl.port || (parsedUrl.protocol === "https:" ? "443" : "80")
  const npm = process.platform === "win32" ? "npm.cmd" : "npm"

  logStep(`starting local dev server on ${host}:${port}`)
  devServer = spawn(npm, ["run", "dev", "--", "--hostname", host, "--port", port], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  })

  let serverOutput = ""
  devServer.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString()
  })
  devServer.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString()
  })
  devServer.on("exit", (code) => {
    if (code && code !== 0) {
      process.stderr.write(serverOutput)
    }
  })

  await waitForServer(url)
}

function ensureFfmpeg() {
  const result = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" })
  assert(
    result.status === 0,
    "ffmpeg is required for smoke video fixtures. Install ffmpeg or run against an existing session manually."
  )
}

async function ensureFixtureVideos() {
  ensureFfmpeg()
  await mkdir(VIDEO_DIR, { recursive: true })

  const outputPaths = []
  for (const fixture of VIDEO_FIXTURES) {
    const outputPath = path.join(VIDEO_DIR, fixture.file)
    outputPaths.push(outputPath)
    if (await exists(outputPath)) continue

    logStep(`creating fixture ${fixture.file}`)
    const result = spawnSync(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        `testsrc2=size=${fixture.size}:rate=24:duration=${fixture.duration}`,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-an",
        outputPath,
      ],
      { stdio: "inherit" }
    )
    assert(result.status === 0, `Failed to create fixture video ${fixture.file}`)
  }

  return outputPaths
}

async function runSmoke() {
  await ensureServer(SMOKE_URL)
  const fixturePaths = await ensureFixtureVideos()
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const consoleIssues = []

  await context.addInitScript(() => {
    localStorage.setItem("video-wall-theme", "light")
  })

  const page = await context.newPage()
  page.on("console", (message) => {
    const type = message.type()
    const text = message.text()
    if (type === "error" || /hydration|recoverable error/i.test(text)) {
      consoleIssues.push(`${type}: ${text}`)
    }
  })
  page.on("pageerror", (error) => {
    consoleIssues.push(`pageerror: ${error.message}`)
  })

  logStep(`opening ${SMOKE_URL}`)
  await page.goto(SMOKE_URL, { waitUntil: "networkidle" })
  await page.getByRole("heading", { name: "Video Wall" }).waitFor({ state: "visible" })

  const themeButtonLabel = await page.getByTestId("control-panel").getByLabel("Switch to dark theme").count()
  assert(themeButtonLabel === 1, "Light theme did not hydrate to the expected theme toggle state")

  logStep("adding local fixture videos")
  await page.locator('input[type="file"]').first().setInputFiles(fixturePaths)
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="wall-video"]').length > 0)
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("video")).every(
      (video) => video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0
    )
  )

  const videoStates = await page.getByTestId("wall-video").evaluateAll((videos) =>
    videos.map((video) => ({
      muted: video.muted,
      volume: video.volume,
      paused: video.paused,
      width: video.videoWidth,
      height: video.videoHeight,
    }))
  )
  assert(videoStates.length > 0, "No wall videos were rendered")
  assert(videoStates.every((video) => video.muted), "Wall videos should be muted by default")
  assert(
    videoStates.every((video) => Math.abs(video.volume - 0.2) < 0.01),
    "Wall videos should inherit the 20% default volume"
  )

  const firstTile = page.getByTestId("video-tile").first()
  await firstTile.click({ position: { x: 24, y: 24 } })
  await firstTile.hover()

  const firstVideo = page.getByTestId("wall-video").first()
  const firstTimeline = firstTile.getByTestId("video-timeline")
  await firstTimeline.waitFor({ state: "attached" })

  if (await firstVideo.evaluate((video) => video.paused)) {
    const playButton = page.getByRole("button", { name: "Play all videos" })
    if ((await playButton.count()) === 1) await playButton.click()
    await page.waitForFunction(() => {
      const video = document.querySelector('[data-testid="wall-video"]')
      return video instanceof HTMLVideoElement && !video.paused
    })
  }

  logStep("checking hovered timeline updates")
  const beforeTimeline = Number(await firstTimeline.inputValue())
  await page.waitForTimeout(800)
  const afterTimeline = Number(await firstTimeline.inputValue())
  assert(afterTimeline > beforeTimeline, "Hovered video timeline did not advance")

  logStep("checking timeline scrub")
  const duration = Number(await firstTimeline.getAttribute("max"))
  const targetTime = Math.max(0.5, duration * 0.5)
  await firstTimeline.evaluate((input, nextValue) => {
    input.value = String(nextValue)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
  }, targetTime)
  await page.waitForFunction((expected) => {
    const video = document.querySelector('[data-testid="wall-video"]')
    return video instanceof HTMLVideoElement && Math.abs(video.currentTime - expected) < 0.75
  }, targetTime)

  logStep("checking zoomed video escapes row bounds and preserves aspect")
  const tileBoxBeforeZoom = await firstTile.boundingBox()
  assert(tileBoxBeforeZoom, "Could not measure tile before zoom")
  await firstTile.dblclick({ position: { x: Math.min(40, tileBoxBeforeZoom.width / 2), y: Math.min(40, tileBoxBeforeZoom.height / 2) } })
  const zoomFrame = page.getByTestId("zoomed-video-frame")
  await zoomFrame.waitFor({ state: "visible" })
  const zoomBox = await zoomFrame.boundingBox()
  assert(zoomBox, "Could not measure zoomed frame")
  assert(
    zoomBox.width > tileBoxBeforeZoom.width || zoomBox.height > tileBoxBeforeZoom.height,
    "Zoomed video frame did not grow beyond its row tile"
  )

  const naturalAspect = await firstVideo.evaluate((video) => video.videoWidth / video.videoHeight)
  const zoomAspect = zoomBox.width / zoomBox.height
  assert(
    Math.abs(naturalAspect - zoomAspect) < 0.08,
    `Zoomed video aspect ratio changed unexpectedly: natural=${naturalAspect.toFixed(3)} zoom=${zoomAspect.toFixed(3)}`
  )

  await page.mouse.click(8, 8)
  await zoomFrame.waitFor({ state: "detached" })
  assert((await page.getByTestId("video-tile").count()) === videoStates.length, "Zoom return changed tile count")

  assert(consoleIssues.length === 0, `Console/page errors detected:\n${consoleIssues.join("\n")}`)
  await browser.close()
  logStep("passed")
}

try {
  await runSmoke()
} finally {
  if (devServer) {
    devServer.kill()
  }
}
