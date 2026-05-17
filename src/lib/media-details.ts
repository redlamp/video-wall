import { saveVideoMeta } from "@/lib/video-db"
import type { CatalogVideo } from "@/lib/video-types"

export type VideoDetails = Pick<CatalogVideo, "duration" | "width" | "height">

export function persistVideoDetails(video: CatalogVideo, details: VideoDetails) {
  void saveVideoMeta({
    key: video.key,
    name: video.name,
    duration: details.duration,
    width: details.width,
    height: details.height,
    modified: video.modified,
    crop: video.crop,
    cropConfidence: video.cropConfidence,
    lastOpenedAt: timestamp(),
  })
}

export function readVideoDetails(video: CatalogVideo) {
  return new Promise<VideoDetails>((resolve, reject) => {
    const element = document.createElement("video")
    element.preload = "metadata"
    element.muted = true
    element.src = video.url
    element.onloadedmetadata = () => {
      resolve({
        duration: element.duration || undefined,
        width: element.videoWidth || undefined,
        height: element.videoHeight || undefined,
      })
      element.removeAttribute("src")
      element.load()
    }
    element.onerror = () => reject(new Error(`Unable to read metadata for ${video.name}`))
  })
}

function timestamp() {
  return new Date().getTime()
}
