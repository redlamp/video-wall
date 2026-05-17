"use client"

import { Dispatch, SetStateAction, useCallback, useEffect, useRef } from "react"

import type { WallVideo } from "@/lib/video-types"

type PlaybackSnapshot = {
  currentTime: number
  wasPlaying: boolean
}

export function useWallPlayback({
  wall,
  selectedWallIds,
  displayedWallIds,
  zoomedId,
  setZoomedId,
  playbackRate,
  masterVolume,
  muted,
  isPlaying,
  setIsPlaying,
  onMessage,
  wallVideosLength,
}: {
  wall: WallVideo[]
  selectedWallIds: Set<string>
  displayedWallIds: string[]
  zoomedId: string | null
  setZoomedId: Dispatch<SetStateAction<string | null>>
  playbackRate: number
  masterVolume: number
  muted: boolean
  isPlaying: boolean
  setIsPlaying: Dispatch<SetStateAction<boolean>>
  onMessage: (message: string) => void
  wallVideosLength: number
}) {
  const videoRefs = useRef(new Map<string, HTMLVideoElement>())
  const playbackRestoreRef = useRef(new Map<string, PlaybackSnapshot>())

  const registerVideoRef = useCallback((wallId: string, node: HTMLVideoElement | null) => {
    if (node) videoRefs.current.set(wallId, node)
    else videoRefs.current.delete(wallId)
  }, [])

  const seekTilePercent = useCallback(
    (wallId: string, percent: number) => {
      const ids =
        selectedWallIds.size > 0 && selectedWallIds.has(wallId)
          ? selectedWallIds
          : new Set([wallId])
      ids.forEach((id) => {
        const video = videoRefs.current.get(id)
        if (video && Number.isFinite(video.duration) && video.duration > 0) {
          video.currentTime = video.duration * percent
        }
      })
    },
    [selectedWallIds]
  )

  const applyToTargetVideos = useCallback(
    (operation: (video: HTMLVideoElement) => void | Promise<void>) => {
      const ids = selectedWallIds.size > 0 ? selectedWallIds : new Set(wall.map((item) => item.wallId))
      ids.forEach((wallId) => {
        const video = videoRefs.current.get(wallId)
        if (video) void operation(video)
      })
    },
    [selectedWallIds, wall]
  )

  const applyToAllVideos = useCallback(
    (operation: (video: HTMLVideoElement) => void | Promise<void>) => {
      wall.forEach((wallItem) => {
        const video = videoRefs.current.get(wallItem.wallId)
        if (video) void operation(video)
      })
    },
    [wall]
  )

  const playTargets = useCallback(() => {
    applyToTargetVideos((video) => video.play().catch(() => onMessage("Playback is blocked until a user gesture.")))
    setIsPlaying(true)
  }, [applyToTargetVideos, onMessage, setIsPlaying])

  const pauseTargets = useCallback(() => {
    applyToTargetVideos((video) => video.pause())
    setIsPlaying(false)
  }, [applyToTargetVideos, setIsPlaying])

  const playAll = useCallback(() => {
    applyToAllVideos((video) =>
      video.play().catch(() => onMessage("Playback is blocked until a user gesture."))
    )
    setIsPlaying(true)
  }, [applyToAllVideos, onMessage, setIsPlaying])

  const pauseAll = useCallback(() => {
    applyToAllVideos((video) => video.pause())
    setIsPlaying(false)
  }, [applyToAllVideos, setIsPlaying])

  const togglePlayTargets = useCallback(() => {
    const ids = selectedWallIds.size > 0 ? selectedWallIds : new Set(wall.map((item) => item.wallId))
    const shouldPlay = Array.from(ids).some((id) => videoRefs.current.get(id)?.paused !== false)
    if (shouldPlay) playTargets()
    else pauseTargets()
  }, [pauseTargets, playTargets, selectedWallIds, wall])

  const seekTargets = useCallback(
    (seconds: number) => {
      applyToTargetVideos((video) => {
        video.currentTime = Math.max(0, video.currentTime + seconds)
      })
    },
    [applyToTargetVideos]
  )

  const cycleZoomedVideo = useCallback(
    (direction: 1 | -1) => {
      if (!zoomedId || displayedWallIds.length === 0) return
      const currentIndex = displayedWallIds.indexOf(zoomedId)
      const startIndex = currentIndex === -1 ? 0 : currentIndex
      const nextIndex =
        (startIndex + direction + displayedWallIds.length) % displayedWallIds.length
      setZoomedId(displayedWallIds[nextIndex])
    },
    [displayedWallIds, setZoomedId, zoomedId]
  )

  const rememberPlaybackPosition = useCallback((wallId: string) => {
    const video = videoRefs.current.get(wallId)
    if (!video) return
    playbackRestoreRef.current.set(wallId, {
      currentTime: video.currentTime,
      wasPlaying: !video.paused,
    })
  }, [])

  const restorePlaybackIfNeeded = useCallback(
    async (wallId: string, element: HTMLVideoElement) => {
      const restore = playbackRestoreRef.current.get(wallId)
      if (restore && Number.isFinite(restore.currentTime) && element.duration > 0) {
        element.currentTime = Math.min(restore.currentTime, Math.max(0, element.duration - 0.05))
        if (restore.wasPlaying || isPlaying) {
          await element.play().catch(() => undefined)
        }
        playbackRestoreRef.current.delete(wallId)
      }
    },
    [isPlaying]
  )

  useEffect(() => {
    videoRefs.current.forEach((video) => {
      video.playbackRate = playbackRate
      video.volume = masterVolume
      video.muted = muted
    })
  }, [masterVolume, muted, playbackRate, wallVideosLength])

  useEffect(() => {
    if (!isPlaying) return
    videoRefs.current.forEach((video) => {
      if (video.paused) {
        void video.play().catch(() => onMessage("Press play once to allow browser autoplay."))
      }
    })
  }, [isPlaying, onMessage, wall])

  useEffect(() => {
    playbackRestoreRef.current.forEach((restore, wallId) => {
      const video = videoRefs.current.get(wallId)
      if (!video || !Number.isFinite(restore.currentTime) || video.duration <= 0) return
      video.currentTime = Math.min(restore.currentTime, Math.max(0, video.duration - 0.05))
      if (restore.wasPlaying || isPlaying) {
        void video.play().catch(() => undefined)
      }
      playbackRestoreRef.current.delete(wallId)
    })
  }, [isPlaying, wall])

  return {
    videoRefs,
    registerVideoRef,
    seekTilePercent,
    playAll,
    pauseAll,
    togglePlayTargets,
    seekTargets,
    cycleZoomedVideo,
    rememberPlaybackPosition,
    restorePlaybackIfNeeded,
  }
}
