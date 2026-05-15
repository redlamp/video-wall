"use client"

import {
  ChangeEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import gsap from "gsap"
import {
  Maximize2,
  Minimize2,
  Pin,
  PinOff,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDuration } from "@/lib/media"
import type { CatalogVideo, CropMode } from "@/lib/video-types"
import { getEffectiveAspectRatio } from "@/lib/wall-layout"
import { cn } from "@/lib/utils"

export const VideoTile = forwardRef<HTMLDivElement, VideoTileProps>(function VideoTile(
  {
    videoRef,
    wallId,
    video,
    cropMode,
    rowHeight,
    tileWidth,
    selected,
    pinned,
    zoomed,
    masterVolume,
    muted,
    tileMuted,
    playbackRate,
    isPlaying,
    dragging,
    insertBefore,
    insertAfter,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
    onSelect,
    onDoubleClick,
    onCloseZoom,
    onEnded,
    onPrevious,
    onNext,
    onSeekPercent,
    onMetadata,
    onError,
    onToggleMute,
    onTogglePin,
    onRemove,
  },
  ref
) {
  const cropStyle = getVideoCropStyle(video, cropMode)
  const videoDisplayStyle = zoomed ? getZoomedVideoStyle(video, cropMode) : cropStyle
  const tileStyle = {
    height: rowHeight,
    width: tileWidth,
  }
  const zoomFrameStyle = zoomed ? getZoomedTileStyle(video, cropMode) : undefined
  const [controlsVisible, setControlsVisible] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(video.duration ?? 0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controlPointerActiveRef = useRef(false)
  const controlsVisibleRef = useRef(false)
  const currentTimeRef = useRef(0)
  const lastTimelineSyncRef = useRef(0)
  const shortLoopSecondsRef = useRef(0)

  const setRootRef = useCallback(
    (node: HTMLDivElement | null) => {
      rootRef.current = node
      if (typeof ref === "function") {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    },
    [ref]
  )

  const syncCurrentTime = useCallback(
    (element: HTMLVideoElement | null, force = false) => {
      if (!element) return
      const nextTime = element.currentTime
      currentTimeRef.current = nextTime
      if (!force && !controlsVisibleRef.current && !zoomed) return
      const now = performance.now()
      if (!force && now - lastTimelineSyncRef.current < 250) return
      lastTimelineSyncRef.current = now
      setCurrentTime(nextTime)
    },
    [zoomed]
  )

  const revealControls = useCallback(() => {
    controlsVisibleRef.current = true
    setControlsVisible(true)
    syncCurrentTime(localVideoRef.current, true)
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    controlsTimerRef.current = setTimeout(() => {
      controlsVisibleRef.current = false
      setControlsVisible(false)
    }, 4000)
  }, [syncCurrentTime])

  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    }
  }, [])

  useEffect(() => {
    shortLoopSecondsRef.current = 0
  }, [video.id, video.duration])

  useEffect(() => {
    const element = frameRef.current
    if (!element) return
    gsap.killTweensOf(element)
    if (zoomed) {
      gsap.fromTo(
        element,
        { opacity: 0.2 },
        { opacity: 1, duration: 0.18, ease: "power2.inOut", overwrite: "auto" }
      )
      return
    }
    gsap.set(element, { clearProps: "opacity" })
  }, [video.id, zoomed])

  useEffect(() => {
    const element = localVideoRef.current
    if (!element) return
    element.playbackRate = playbackRate
    element.volume = masterVolume
    element.muted = muted || tileMuted || masterVolume === 0
  }, [masterVolume, muted, playbackRate, tileMuted])

  const updateScrub = (event: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>) => {
    const nextTime = Number(event.currentTarget.value)
    currentTimeRef.current = nextTime
    lastTimelineSyncRef.current = performance.now()
    setCurrentTime(nextTime)
    onSeekPercent(duration > 0 ? nextTime / duration : 0)
  }
  const compactControls = !zoomed && tileWidth < 360

  const stopControlPointer = (event: ReactPointerEvent<HTMLElement>) => {
    controlPointerActiveRef.current = true
    event.stopPropagation()
  }

  const transportButtons = (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        size="icon-xs"
        variant={tileMuted ? "default" : "secondary"}
        onClick={onToggleMute}
        aria-label={tileMuted ? "Unmute video" : "Mute video"}
      >
        {tileMuted ? <VolumeX data-icon="inline-start" /> : <Volume2 data-icon="inline-start" />}
      </Button>
      <Button size="icon-xs" variant="secondary" onClick={onPrevious} aria-label="Previous video">
        <SkipBack data-icon="inline-start" />
      </Button>
      <Button size="icon-xs" variant="secondary" onClick={onNext} aria-label="Next video">
        <SkipForward data-icon="inline-start" />
      </Button>
    </div>
  )

  const tileActionButtons = (
    <div className="flex shrink-0 items-center gap-1">
      <Button size="icon-xs" variant="secondary" onClick={onTogglePin} aria-label="Pin video">
        {pinned ? <PinOff data-icon="inline-start" /> : <Pin data-icon="inline-start" />}
      </Button>
      <Button
        size="icon-xs"
        variant="secondary"
        onClick={zoomed ? onCloseZoom : onDoubleClick}
        aria-label={zoomed ? "Exit zoomed video" : "Zoom video"}
      >
        {zoomed ? <Minimize2 data-icon="inline-start" /> : <Maximize2 data-icon="inline-start" />}
      </Button>
      <Button size="icon-xs" variant="destructive" onClick={onRemove} aria-label="Remove video">
        <X data-icon="inline-start" />
      </Button>
    </div>
  )

  const timelineScrubber = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="w-9 shrink-0 tabular-nums">{formatDuration(currentTime)}</span>
      <input
        data-testid="video-timeline"
        className="h-1 min-w-0 flex-1 cursor-pointer accent-white"
        type="range"
        min={0}
        max={Math.max(0.01, duration || 0.01)}
        step={0.05}
        value={Math.min(currentTime, duration || currentTime)}
        onInput={updateScrub}
        onChange={updateScrub}
        onPointerDown={stopControlPointer}
      />
      <span className="w-9 shrink-0 tabular-nums">{formatDuration(duration)}</span>
    </div>
  )

  return (
    <div
      ref={setRootRef}
      data-testid="video-tile"
      data-wall-id={wallId}
      className={cn(
        "relative shrink-0 rounded-md border bg-black shadow-sm outline-none",
        zoomed ? "overflow-visible" : "overflow-hidden",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border/60",
        dragging && "opacity-45",
        !controlsVisible && !zoomed && "cursor-none"
      )}
      style={tileStyle}
      onPointerDown={(event) => {
        event.stopPropagation()
        revealControls()
        onSelect(wallId, event)
      }}
      draggable={!zoomed}
      onDragStart={(event) => {
        if (controlPointerActiveRef.current) {
          event.preventDefault()
          controlPointerActiveRef.current = false
          return
        }
        onDragStart(event)
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onPointerEnter={revealControls}
      onPointerMove={revealControls}
      onPointerLeave={() => {
        if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
        controlsVisibleRef.current = false
        setControlsVisible(false)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        if (zoomed) onCloseZoom()
        else onDoubleClick()
      }}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-y-3 left-1 z-20 w-1 rounded bg-primary opacity-0 shadow-[0_0_18px_hsl(var(--primary))] transition-opacity",
          insertBefore && "opacity-100"
        )}
      />
      <div
        className={cn(
          "pointer-events-none absolute inset-y-3 right-1 z-20 w-1 rounded bg-primary opacity-0 shadow-[0_0_18px_hsl(var(--primary))] transition-opacity",
          insertAfter && "opacity-100"
        )}
      />
      {zoomed ? (
        <button
          type="button"
          aria-label="Close zoomed video"
          className="fixed inset-0 z-40 cursor-default bg-background/70"
          onClick={onCloseZoom}
        />
      ) : null}
      <div
        ref={frameRef}
        data-testid={zoomed ? "zoomed-video-frame" : "video-frame"}
        className={cn(
          "relative h-full w-full overflow-hidden bg-black",
          zoomed &&
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-primary shadow-2xl"
        )}
        style={zoomFrameStyle}
        onPointerDown={(event) => {
          event.stopPropagation()
          revealControls()
          onSelect(wallId, event)
        }}
        onDoubleClick={(event) => {
          event.stopPropagation()
          if (zoomed) onCloseZoom()
          else onDoubleClick()
        }}
      >
        <video
          ref={(node) => {
            localVideoRef.current = node
            videoRef(node)
          }}
          data-testid="wall-video"
          src={video.url}
          className="h-full w-full bg-black"
          style={videoDisplayStyle}
          playsInline
          controls={false}
          draggable={false}
          muted={muted || tileMuted || masterVolume === 0}
          onLoadedMetadata={(event) => {
            const element = event.currentTarget
            element.playbackRate = playbackRate
            element.volume = masterVolume
            element.muted = muted || tileMuted || masterVolume === 0
            setDuration(element.duration || 0)
            syncCurrentTime(element, true)
            onMetadata(element)
          }}
          onTimeUpdate={(event) => syncCurrentTime(event.currentTarget)}
          onEnded={(event) => {
            const element = event.currentTarget
            if (element.duration > 0 && element.duration < 30 && shortLoopSecondsRef.current < 30) {
              shortLoopSecondsRef.current += element.duration
              element.currentTime = 0
              if (isPlaying) void element.play().catch(() => undefined)
              return
            }
            shortLoopSecondsRef.current = 0
            onEnded()
          }}
          onError={onError}
        />
        {video.unsupported ? (
          <div className="absolute inset-0 z-10 grid place-items-center bg-black/75 p-4 text-center text-xs text-white">
            <div>
              <div className="font-medium">Unable to play video</div>
              {video.error ? <div className="mt-1 text-white/70">{video.error}</div> : null}
            </div>
          </div>
        ) : null}
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/70 to-transparent p-2 transition-opacity",
            controlsVisible ? "opacity-100" : "opacity-0"
          )}
        >
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-white">{video.name}</div>
            <div className="mt-0.5 flex gap-1.5 text-[11px] text-white/70">
              <span>{formatDuration(video.duration)}</span>
              {video.crop ? (
                <span>crop {Math.round((video.cropConfidence ?? 0) * 100)}%</span>
              ) : null}
            </div>
          </div>
          <div className="flex gap-1">
            {pinned ? <Badge variant="secondary">Pinned</Badge> : null}
            {selected ? <Badge>Selected</Badge> : null}
          </div>
        </div>
        <div
          className={cn(
            "absolute inset-x-2 bottom-2 rounded bg-black/55 px-2 py-1 text-[11px] text-white shadow-lg backdrop-blur transition-opacity",
            compactControls ? "flex flex-col gap-1" : "flex items-center gap-2",
            controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
          )}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={() => {
            controlPointerActiveRef.current = false
          }}
          onPointerCancel={() => {
            controlPointerActiveRef.current = false
          }}
        >
          {compactControls ? (
            <>
              <div className="flex items-center justify-center gap-1">
                {transportButtons}
                {tileActionButtons}
              </div>
              {timelineScrubber}
            </>
          ) : (
            <>
              {transportButtons}
              {timelineScrubber}
              {tileActionButtons}
            </>
          )}
        </div>
      </div>
    </div>
  )
})

type VideoTileProps = {
  videoRef: (node: HTMLVideoElement | null) => void
  wallId: string
  video: CatalogVideo
  cropMode: CropMode
  rowHeight: number
  tileWidth: number
  selected: boolean
  pinned: boolean
  zoomed: boolean
  masterVolume: number
  muted: boolean
  tileMuted: boolean
  playbackRate: number
  isPlaying: boolean
  dragging: boolean
  insertBefore: boolean
  insertAfter: boolean
  onDragStart: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onSelect: (wallId: string, event: ReactPointerEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
  onCloseZoom: () => void
  onEnded: () => void
  onPrevious: () => void
  onNext: () => void
  onSeekPercent: (percent: number) => void
  onMetadata: (element: HTMLVideoElement) => void
  onError: () => void
  onToggleMute: () => void
  onTogglePin: () => void
  onRemove: () => void
}

function getVideoCropStyle(video: CatalogVideo, cropMode: CropMode): CSSProperties {
  if (cropMode === "fit") return { objectFit: "contain" }
  if (cropMode === "fill") return { objectFit: "cover" }
  if (!video.crop || !hasMeaningfulCrop(video.crop)) return { objectFit: "cover" }

  const { x, y, width, height } = video.crop
  const naturalAspect = video.width && video.height ? video.width / video.height : 16 / 9

  return {
    aspectRatio: `${naturalAspect}`,
    height: "auto",
    left: `${(-x / width) * 100}%`,
    maxHeight: "none",
    maxWidth: "none",
    objectFit: "contain",
    position: "absolute",
    top: `${(-y / height) * 100}%`,
    width: `${100 / width}%`,
  }
}

function getZoomedVideoStyle(video: CatalogVideo, cropMode: CropMode): CSSProperties {
  if (cropMode !== "detected" || !video.crop || !hasMeaningfulCrop(video.crop)) {
    return { objectFit: "contain" }
  }

  return getVideoCropStyle(video, cropMode)
}

function getZoomedTileStyle(video: CatalogVideo, cropMode: CropMode): CSSProperties {
  const aspect = getEffectiveAspectRatio(video, cropMode)
  return {
    width: `min(95vw, calc(95vh * ${aspect}))`,
    height: `min(95vh, calc(95vw / ${aspect}))`,
  }
}

function hasMeaningfulCrop(crop: { width: number; height: number }) {
  return crop.width < 0.97 || crop.height < 0.97
}
