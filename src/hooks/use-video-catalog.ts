"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { mapWithConcurrency } from "@/lib/async-queue"
import { createCatalogVideo, isVideoFile } from "@/lib/media"
import { persistVideoDetails, readVideoDetails } from "@/lib/media-details"
import { getVideoMeta, saveVideoMeta } from "@/lib/video-db"
import type { CatalogVideo } from "@/lib/video-types"
import { hasKnownAspect } from "@/lib/wall-layout"

const METADATA_CONCURRENCY = 4

export function useVideoCatalog({
  onMessage,
}: {
  onMessage: (message: string) => void
}) {
  const [catalog, setCatalog] = useState<CatalogVideo[]>([])
  const catalogUrlsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    catalogUrlsRef.current = new Set(catalog.map((item) => item.url))
  }, [catalog])

  useEffect(() => {
    return () => {
      catalogUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  const ingestFiles = useCallback(
    async (files: File[]) => {
      const videos = files.filter(isVideoFile)
      if (videos.length === 0) {
        onMessage("No browser-playable video files found.")
        return { addedVideos: [] as CatalogVideo[], nextCatalog: catalog }
      }

      const existingKeys = new Set(catalog.map((item) => item.key))
      const nextVideos = await mapWithConcurrency(
        videos,
        METADATA_CONCURRENCY,
        async (file) => {
          const item = createCatalogVideo(file)
          const meta = await getVideoMeta(item.key).catch(() => undefined)
          if (meta) {
            const cachedItem = {
              ...item,
              duration: meta.duration,
              width: meta.width,
              height: meta.height,
              crop: meta.crop,
              cropConfidence: meta.cropConfidence,
            }
            if (hasKnownAspect(cachedItem)) return cachedItem
            const details = await readVideoDetails(cachedItem).catch(() => undefined)
            if (details) persistVideoDetails(cachedItem, details)
            return details ? { ...cachedItem, ...details } : cachedItem
          }
          const details = await readVideoDetails(item).catch(() => undefined)
          if (details) persistVideoDetails(item, details)
          return details ? { ...item, ...details } : item
        }
      )

      const seenKeys = new Set(existingKeys)
      const uniqueVideos: CatalogVideo[] = []
      const duplicateVideos: CatalogVideo[] = []

      nextVideos.forEach((item) => {
        if (seenKeys.has(item.key)) {
          duplicateVideos.push(item)
          return
        }
        seenKeys.add(item.key)
        uniqueVideos.push(item)
      })
      duplicateVideos.forEach((item) => URL.revokeObjectURL(item.url))

      if (uniqueVideos.length === 0) {
        onMessage("Those videos are already in the catalog.")
        return { addedVideos: [], nextCatalog: catalog }
      }

      const nextCatalog = [...catalog, ...uniqueVideos]
      setCatalog(nextCatalog)
      onMessage(`Added ${uniqueVideos.length} video${uniqueVideos.length === 1 ? "" : "s"}.`)
      return { addedVideos: uniqueVideos, nextCatalog }
    },
    [catalog, onMessage]
  )

  const clearCatalog = useCallback(() => {
    catalog.forEach((item) => URL.revokeObjectURL(item.url))
    setCatalog([])
    onMessage("Catalog cleared.")
  }, [catalog, onMessage])

  const markVideoError = useCallback(
    (video: CatalogVideo) => {
      const error = "Browser could not play this video."
      setCatalog((current) =>
        current.map((item) => (item.id === video.id ? { ...item, unsupported: true, error } : item))
      )
      onMessage(`${error} ${video.name}`)
    },
    [onMessage]
  )

  const updateVideoDetails = useCallback((video: CatalogVideo, element: HTMLVideoElement) => {
    const width = element.videoWidth
    const height = element.videoHeight
    const duration = element.duration

    setCatalog((current) => {
      const currentVideo = current.find((item) => item.id === video.id)
      if (
        currentVideo?.duration === duration &&
        currentVideo.width === width &&
        currentVideo.height === height
      ) {
        return current
      }
      return current.map((item) =>
        item.id === video.id ? { ...item, width, height, duration } : item
      )
    })

    const openedAt = timestamp()
    void saveVideoMeta({
      key: video.key,
      name: video.name,
      duration,
      width,
      height,
      modified: video.modified,
      crop: video.crop,
      cropConfidence: video.cropConfidence,
      lastOpenedAt: openedAt,
    })

    return { width, height, duration, openedAt }
  }, [])

  const updateVideoCrop = useCallback(
    (
      video: CatalogVideo,
      metadata: { duration: number; width?: number; height?: number; openedAt: number },
      detection: { crop: CatalogVideo["crop"]; confidence: number }
    ) => {
      if (!detection.crop) return
      setCatalog((current) =>
        current.map((item) =>
          item.id === video.id
            ? { ...item, crop: detection.crop, cropConfidence: detection.confidence }
            : item
        )
      )
      void saveVideoMeta({
        key: video.key,
        name: video.name,
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        modified: video.modified,
        crop: detection.crop,
        cropConfidence: detection.confidence,
        lastOpenedAt: metadata.openedAt,
      })
    },
    []
  )

  return {
    catalog,
    setCatalog,
    ingestFiles,
    clearCatalog,
    markVideoError,
    updateVideoDetails,
    updateVideoCrop,
  }
}

function timestamp() {
  return new Date().getTime()
}
