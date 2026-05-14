import type { CropRect } from "@/lib/video-types"

type DetectionResult = {
  crop: CropRect
  confidence: number
}

const SAMPLE_SIZE = 192
const BLACK_THRESHOLD = 24
const EDGE_REQUIRED_RATIO = 0.92

export async function detectLetterbox(video: HTMLVideoElement) {
  if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) {
    return undefined
  }

  const sampleTimes = [0.12, 0.5, 0.88]
    .map((part) => Math.max(0.05, video.duration * part))
    .filter((time) => time < video.duration)

  const results: DetectionResult[] = []
  const originalTime = video.currentTime
  const wasPaused = video.paused

  for (const time of sampleTimes) {
    try {
      await seek(video, time)
      const result = detectCurrentFrame(video)
      if (result) results.push(result)
    } catch {
      // A single bad frame should not block playback or metadata.
    }
  }

  await seek(video, originalTime).catch(() => undefined)
  if (!wasPaused) {
    await video.play().catch(() => undefined)
  }

  if (results.length === 0) return undefined

  const crop = medianCrop(results.map((result) => result.crop))
  const confidence =
    results.reduce((sum, result) => sum + result.confidence, 0) / results.length

  if (crop.width > 0.98 && crop.height > 0.98) {
    return { crop: { x: 0, y: 0, width: 1, height: 1 }, confidence: 0.2 }
  }

  return { crop, confidence }
}

function detectCurrentFrame(video: HTMLVideoElement): DetectionResult | undefined {
  const canvas = document.createElement("canvas")
  const ratio = video.videoWidth / video.videoHeight
  canvas.width = ratio >= 1 ? SAMPLE_SIZE : Math.max(64, Math.round(SAMPLE_SIZE * ratio))
  canvas.height = ratio >= 1 ? Math.max(64, Math.round(SAMPLE_SIZE / ratio)) : SAMPLE_SIZE

  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) return undefined

  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)

  const top = findFirstContentRow(data, width, height, 0, 1)
  const bottom = findFirstContentRow(data, width, height, height - 1, -1)
  const left = findFirstContentColumn(data, width, height, 0, 1)
  const right = findFirstContentColumn(data, width, height, width - 1, -1)

  const crop = {
    x: clamp(left / width),
    y: clamp(top / height),
    width: clamp((right - left + 1) / width),
    height: clamp((bottom - top + 1) / height),
  }

  const removedArea = 1 - crop.width * crop.height
  return { crop, confidence: removedArea > 0.03 ? 0.72 : 0.25 }
}

function findFirstContentRow(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  start: number,
  direction: 1 | -1
) {
  for (let y = start; y >= 0 && y < height; y += direction) {
    let black = 0
    for (let x = 0; x < width; x += 1) {
      if (isBlack(pixelLuminance(data, (y * width + x) * 4))) black += 1
    }
    if (black / width < EDGE_REQUIRED_RATIO) return y
  }
  return direction === 1 ? 0 : height - 1
}

function findFirstContentColumn(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  start: number,
  direction: 1 | -1
) {
  for (let x = start; x >= 0 && x < width; x += direction) {
    let black = 0
    for (let y = 0; y < height; y += 1) {
      if (isBlack(pixelLuminance(data, (y * width + x) * 4))) black += 1
    }
    if (black / height < EDGE_REQUIRED_RATIO) return x
  }
  return direction === 1 ? 0 : width - 1
}

function pixelLuminance(data: Uint8ClampedArray, index: number) {
  return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722
}

function isBlack(luminance: number) {
  return luminance < BLACK_THRESHOLD
}

function medianCrop(crops: CropRect[]) {
  return {
    x: median(crops.map((crop) => crop.x)),
    y: median(crops.map((crop) => crop.y)),
    width: median(crops.map((crop) => crop.width)),
    height: median(crops.map((crop) => crop.height)),
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value))
}

function seek(video: HTMLVideoElement, time: number) {
  return new Promise<void>((resolve, reject) => {
    const handleSeeked = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      reject(new Error("Video seek failed"))
    }
    const cleanup = () => {
      video.removeEventListener("seeked", handleSeeked)
      video.removeEventListener("error", handleError)
    }

    video.addEventListener("seeked", handleSeeked, { once: true })
    video.addEventListener("error", handleError, { once: true })
    video.currentTime = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.05))
  })
}
