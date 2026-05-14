"use client"

import {
  ChangeEvent,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
  CSSProperties,
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import gsap from "gsap"
import {
  ChevronLeft,
  ChevronRight,
  CircleOff,
  Crop,
  Dice5,
  FastForward,
  FolderOpen,
  Maximize2,
  Minus,
  PaintBucket,
  Pause,
  Pin,
  PinOff,
  Play,
  Plus,
  Rows3,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { detectLetterbox } from "@/lib/crop-detection"
import { createCatalogVideo, filesFromDataTransfer, formatDuration, formatFileSize, isVideoFile } from "@/lib/media"
import { getVideoMeta, saveLastSession, saveVideoMeta } from "@/lib/video-db"
import type { CatalogVideo, CropMode, SortMode, WallVideo } from "@/lib/video-types"
import { cn } from "@/lib/utils"

const DEFAULT_ROWS = 2
const SEEK_SECONDS = 5
const SUPPORTED_ACCEPT = ".mp4,.mov,.webm,.m4v,.mkv,.avi,video/*"

type DragRect = {
  startX: number
  startY: number
  x: number
  y: number
  width: number
  height: number
}

type PackedWallItem = {
  wallItem: WallVideo
  video: CatalogVideo
  videos: CatalogVideo[]
  width: number
  aspect: number
}

type PackedRow = {
  items: PackedWallItem[]
  width: number
  offset: number
}

type ReplaceDirection = "next" | "previous"
type InsertPosition = "before" | "after"
type InsertTarget = {
  wallId: string
  position: InsertPosition
} | null
type ScrollMode = "all" | "row"
type AspectFilter = "mixed" | "landscape" | "portrait"

export function VideoWallApp() {
  const [catalog, setCatalog] = useState<CatalogVideo[]>([])
  const [wall, setWall] = useState<WallVideo[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [shownThisSession, setShownThisSession] = useState<Set<string>>(new Set())
  const [rows, setRows] = useState(DEFAULT_ROWS)
  const [sortMode, setSortMode] = useState<SortMode>("date")
  const [playbackRate, setPlaybackRate] = useState(1)
  const [masterVolume, setMasterVolume] = useState(0.2)
  const [muted, setMuted] = useState(false)
  const [cropMode, setCropMode] = useState<CropMode>("detected")
  const [aspectFilter, setAspectFilter] = useState<AspectFilter>("mixed")
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelPinned, setPanelPinned] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [shuffleOn, setShuffleOn] = useState(true)
  const [scrollMode, setScrollMode] = useState<ScrollMode>("all")
  const [wallSize, setWallSize] = useState({ width: 0, height: 0 })
  const [zoomedId, setZoomedId] = useState<string | null>(null)
  const [dragRect, setDragRect] = useState<DragRect | null>(null)
  const [draggedWallId, setDraggedWallId] = useState<string | null>(null)
  const [insertTarget, setInsertTarget] = useState<InsertTarget>(null)
  const [dropActive, setDropActive] = useState(false)
  const [, setMessage] = useState("Drop videos or folders to begin.")

  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const wallRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<number, HTMLDivElement>())
  const tileRefs = useRef(new Map<string, HTMLDivElement>())
  const videoRefs = useRef(new Map<string, HTMLVideoElement>())
  const [tileMutedIds, setTileMutedIds] = useState<Set<string>>(new Set())
  const panelHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const layoutPositionsRef = useRef<Map<string, DOMRect>>(new Map())

  const sortedCatalog = useMemo(() => {
    return [...catalog].sort((a, b) => {
      if (sortMode === "name") return a.name.localeCompare(b.name)
      if (sortMode === "duration") return (a.duration ?? Infinity) - (b.duration ?? Infinity)
      return b.modified - a.modified
    })
  }, [catalog, sortMode])

  const filteredCatalog = useMemo(
    () => filterCatalogByAspect(sortedCatalog, aspectFilter, cropMode),
    [aspectFilter, cropMode, sortedCatalog]
  )

  const selectedWallIds = useMemo(() => selectedIds, [selectedIds])

  const wallVideos = useMemo(() => {
    const catalogById = new Map(catalog.map((item) => [item.id, item]))
    return wall
      .map((wallItem) => {
        const videos = getWallCatalogIds(wallItem)
          .map((catalogId) => catalogById.get(catalogId))
          .filter((video): video is CatalogVideo => Boolean(video))
        return videos.length > 0 ? { wallItem, video: videos[0], videos } : null
      })
      .filter(
        (item): item is { wallItem: WallVideo; video: CatalogVideo; videos: CatalogVideo[] } =>
          Boolean(item)
      )
  }, [catalog, wall])

  const rowHeight = getRowHeight(wallSize.height, rows)
  const packedRows = useMemo(
    () => packRows(wallVideos, rows, rowHeight, wallSize.width, cropMode),
    [cropMode, rowHeight, rows, wallSize.width, wallVideos]
  )
  const displayedWallIds = useMemo(
    () => packedRows.flatMap((row) => row.items.map((item) => item.wallItem.wallId)),
    [packedRows]
  )
  const wallContentWidth = useMemo(
    () =>
      scrollMode === "row"
        ? wallSize.width
        : Math.max(wallSize.width, ...packedRows.map((row) => row.width)),
    [packedRows, scrollMode, wallSize.width]
  )

  useLayoutEffect(() => {
    const previousPositions = layoutPositionsRef.current
    const nextPositions = new Map<string, DOMRect>()

    tileRefs.current.forEach((node, wallId) => {
      const nextRect = node.getBoundingClientRect()
      const previousRect = previousPositions.get(wallId)
      nextPositions.set(wallId, nextRect)

      if (!previousRect || draggedWallId === wallId) return
      const deltaX = previousRect.left - nextRect.left
      const deltaY = previousRect.top - nextRect.top
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) return

      gsap.fromTo(
        node,
        { x: deltaX, y: deltaY },
        { x: 0, y: 0, duration: 0.28, ease: "power2.out", overwrite: "auto" }
      )
    })

    layoutPositionsRef.current = nextPositions
  }, [draggedWallId, packedRows])

  const addFiles = useCallback(
    async (files: File[]) => {
      const videos = files.filter(isVideoFile)
      if (videos.length === 0) {
        setMessage("No browser-playable video files found.")
        return
      }

      const existingKeys = new Set(catalog.map((item) => item.key))
      const nextVideos = await Promise.all(
        videos.map(async (file) => {
          const item = createCatalogVideo(file)
          const meta = await getVideoMeta(item.key).catch(() => undefined)
          if (meta) {
            return {
              ...item,
              duration: meta.duration,
              width: meta.width,
              height: meta.height,
              crop: meta.crop,
              cropConfidence: meta.cropConfidence,
            }
          }
          const details = await readVideoDetails(item).catch(() => undefined)
          return details ? { ...item, ...details } : item
        })
      )

      const uniqueVideos = nextVideos.filter((item) => !existingKeys.has(item.key))
      if (uniqueVideos.length === 0) {
        setMessage("Those videos are already in the catalog.")
        return
      }

      const nextCatalog = [...catalog, ...uniqueVideos]
      const nextWall = buildWallToFillRows({
        catalog: filterCatalogByAspect(nextCatalog, aspectFilter, cropMode),
        currentWall: wall,
        rows,
        rowHeight,
        containerWidth: wallSize.width,
        cropMode,
        random: shuffleOn,
        replace: false,
      })

      setCatalog(nextCatalog)
      setWall(nextWall)
      setShownThisSession(new Set(nextWall.map((item) => item.catalogId)))
      setMessage(`Added ${uniqueVideos.length} video${uniqueVideos.length === 1 ? "" : "s"}.`)
      setIsPlaying(true)
    },
    [aspectFilter, catalog, cropMode, rowHeight, rows, shuffleOn, wall, wallSize.width]
  )

  const fillWall = useCallback(
    (random = false, replace = false) => {
      const nextWall = buildWallToFillRows({
        catalog: filteredCatalog,
        currentWall: wall,
        rows,
        rowHeight,
        containerWidth: wallSize.width,
        cropMode,
        random,
        replace,
      })
      setWall(nextWall)
      setSelectedIds(new Set())
      setShownThisSession(new Set(nextWall.map((item) => item.catalogId)))
      setIsPlaying(nextWall.length > 0)
    },
    [cropMode, filteredCatalog, rowHeight, rows, wall, wallSize.width]
  )

  const refillTile = useCallback(
    (wallId: string) => {
      setWall((current) => {
        const replaced = replaceWallVideo({
          wall: current,
          wallId,
          direction: "next",
          catalog: filteredCatalog,
          shownThisSession,
          shuffleOn,
          respectPinned: true,
          keepWallId: false,
        })
        if (replaced.nextShownIds.length > 0) {
          setShownThisSession((shown) =>
            replaced.nextShownIds.reduce(
              (next, shownId) => updateShownSet(next, shownId, catalog.length),
              shown
            )
          )
        }
        return buildWallToFillRows({
          catalog: filteredCatalog,
          currentWall: replaced.wall,
          rows,
          rowHeight,
          containerWidth: wallSize.width,
          cropMode,
          random: shuffleOn,
          replace: false,
        })
      })
    },
    [catalog.length, cropMode, filteredCatalog, rowHeight, rows, shownThisSession, shuffleOn, wallSize.width]
  )

  const stepTile = useCallback(
    (wallId: string, direction: ReplaceDirection) => {
      setWall((current) => {
        const ids =
          selectedWallIds.size > 0 && selectedWallIds.has(wallId)
            ? Array.from(selectedWallIds)
            : [wallId]
        let nextWall = current
        const nextShownIds: string[] = []

        for (const id of ids) {
          const replaced = replaceWallVideo({
            wall: nextWall,
            wallId: id,
            direction,
            catalog: filteredCatalog,
            shownThisSession,
            shuffleOn,
            respectPinned: false,
            keepWallId: true,
          })
          nextWall = replaced.wall
          nextShownIds.push(...replaced.nextShownIds)
        }

        if (nextShownIds.length > 0) {
          setShownThisSession((shown) =>
            nextShownIds.reduce(
              (next, shownId) => updateShownSet(next, shownId, catalog.length),
              shown
            )
          )
        }
        return buildWallToFillRows({
          catalog: filteredCatalog,
          currentWall: nextWall,
          rows,
          rowHeight,
          containerWidth: wallSize.width,
          cropMode,
          random: shuffleOn,
          replace: false,
        })
      })
    },
    [
      catalog.length,
      cropMode,
      rowHeight,
      rows,
      selectedWallIds,
      shownThisSession,
      shuffleOn,
      filteredCatalog,
      wallSize.width,
    ]
  )

  const togglePinTile = useCallback(
    (wallId: string) => {
      const ids =
        selectedWallIds.size > 0 && selectedWallIds.has(wallId)
          ? selectedWallIds
          : new Set([wallId])
      setWall((current) =>
        current.map((item) => (ids.has(item.wallId) ? { ...item, pinned: !item.pinned } : item))
      )
    },
    [selectedWallIds]
  )

  const removeTile = useCallback(
    (wallId: string) => {
      const ids =
        selectedWallIds.size > 0 && selectedWallIds.has(wallId)
          ? selectedWallIds
          : new Set([wallId])
      setWall((current) => current.filter((item) => !ids.has(item.wallId)))
      setSelectedIds(new Set())
      setTileMutedIds((current) => {
        const next = new Set(current)
        ids.forEach((id) => next.delete(id))
        return next
      })
    },
    [selectedWallIds]
  )

  const toggleMuteTile = useCallback(
    (wallId: string) => {
      const ids =
        selectedWallIds.size > 0 && selectedWallIds.has(wallId)
          ? selectedWallIds
          : new Set([wallId])
      setTileMutedIds((current) => {
        const next = new Set(current)
        const shouldMute = Array.from(ids).some((id) => !next.has(id))
        ids.forEach((id) => {
          if (shouldMute) next.add(id)
          else next.delete(id)
        })
        return next
      })
    },
    [selectedWallIds]
  )

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
    applyToTargetVideos((video) => video.play().catch(() => setMessage("Playback is blocked until a user gesture.")))
    setIsPlaying(true)
  }, [applyToTargetVideos])

  const pauseTargets = useCallback(() => {
    applyToTargetVideos((video) => video.pause())
    setIsPlaying(false)
  }, [applyToTargetVideos])

  const playAll = useCallback(() => {
    applyToAllVideos((video) =>
      video.play().catch(() => setMessage("Playback is blocked until a user gesture."))
    )
    setIsPlaying(true)
  }, [applyToAllVideos])

  const pauseAll = useCallback(() => {
    applyToAllVideos((video) => video.pause())
    setIsPlaying(false)
  }, [applyToAllVideos])

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
    [displayedWallIds, zoomedId]
  )

  const updateVideoSettings = useCallback(() => {
    videoRefs.current.forEach((video) => {
      video.playbackRate = playbackRate
      video.volume = masterVolume
      video.muted = muted
    })
  }, [masterVolume, muted, playbackRate])

  useEffect(updateVideoSettings, [updateVideoSettings, wallVideos.length])

  useEffect(() => {
    if (!isPlaying) return
    videoRefs.current.forEach((video) => {
      if (video.paused) {
        void video.play().catch(() => setMessage("Press play once to allow browser autoplay."))
      }
    })
  }, [isPlaying, wall])

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    gsap.to(panel, {
      y: panelOpen || panelPinned ? 0 : -86,
      opacity: panelOpen || panelPinned ? 1 : 0.08,
      duration: 0.22,
      ease: "power2.out",
    })
  }, [panelOpen, panelPinned])

  useEffect(() => {
    return () => {
      if (panelHideTimerRef.current) clearTimeout(panelHideTimerRef.current)
    }
  }, [wallVideos.length])

  const revealPanel = useCallback(() => {
    setPanelOpen(true)
    if (panelHideTimerRef.current) clearTimeout(panelHideTimerRef.current)
    if (!panelPinned) {
      panelHideTimerRef.current = setTimeout(() => {
        setPanelOpen(false)
      }, 4000)
    }
  }, [panelPinned])

  useEffect(() => {
    const wallElement = wallRef.current
    if (!wallElement) return

    const updateSize = () => {
      const rect = wallElement.getBoundingClientRect()
      const styles = window.getComputedStyle(wallElement)
      const verticalPadding =
        Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom)
      const horizontalPadding =
        Number.parseFloat(styles.paddingLeft) + Number.parseFloat(styles.paddingRight)
      setWallSize({
        width: Math.max(0, rect.width - horizontalPadding),
        height: Math.max(0, rect.height - verticalPadding),
      })
    }

    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(wallElement)
    window.addEventListener("resize", updateSize)

    return () => {
      observer.disconnect()
      window.removeEventListener("resize", updateSize)
    }
  }, [])

  useEffect(() => {
    const wallElement = wallRef.current
    if (!wallElement) return
    const target = Math.max(0, (wallElement.scrollWidth - wallElement.clientWidth) / 2)
    wallElement.scrollTo({ left: target, behavior: "smooth" })
  }, [wallContentWidth, rows, wall.length])

  useEffect(() => {
    if (scrollMode !== "row") return
    rowRefs.current.forEach((rowElement) => {
      const target = Math.max(0, (rowElement.scrollWidth - rowElement.clientWidth) / 2)
      rowElement.scrollTo({ left: target, behavior: "smooth" })
    })
  }, [packedRows, scrollMode, wall.length])

  useEffect(() => {
    const snapshot = {
      catalogIds: catalog.map((item) => item.id),
      wall,
      rows,
      sortMode,
      playbackRate,
      masterVolume,
      cropMode,
      shuffleOn,
      savedAt: Date.now(),
    }
    void saveLastSession(snapshot)
  }, [catalog, cropMode, masterVolume, playbackRate, rows, shuffleOn, sortMode, wall])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.matches("input, textarea, [contenteditable='true']")) return

      if (event.key === "`" || event.key === "~") {
        event.preventDefault()
        setPanelOpen((current) => !current)
        return
      }

      if (event.key === "Escape") {
        event.preventDefault()
        if (zoomedId) setZoomedId(null)
        else if (panelOpen) setPanelOpen(false)
        else setSelectedIds(new Set())
        return
      }

      if (event.code === "Space") {
        event.preventDefault()
        togglePlayTargets()
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault()
        const direction = event.key === "ArrowRight" ? 1 : -1
        if (zoomedId) cycleZoomedVideo(direction)
        else seekTargets(direction * SEEK_SECONDS)
      }

      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault()
        const direction = event.key === "ArrowUp" ? 0.05 : -0.05
        setMasterVolume((current) => Math.min(1, Math.max(0, current + direction)))
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [cycleZoomedVideo, panelOpen, seekTargets, togglePlayTargets, zoomedId])

  useEffect(() => {
    const zoomedTile = zoomedId ? tileRefs.current.get(zoomedId) : null
    if (!zoomedTile) return
    gsap.fromTo(
      zoomedTile,
      { scale: 0.96, opacity: 0.92 },
      { scale: 1, opacity: 1, duration: 0.2, ease: "power2.out" }
    )
  }, [zoomedId])

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    if (isInternalWallDrag(event, draggedWallId)) {
      event.preventDefault()
      setDropActive(false)
      return
    }
    event.preventDefault()
    setDropActive(false)
    const files = await filesFromDataTransfer(event.dataTransfer)
    await addFiles(files)
  }

  const handleFileInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    await addFiles(files)
    event.target.value = ""
  }

  const startTileDrag = (wallId: string, event: React.DragEvent<HTMLDivElement>) => {
    event.stopPropagation()
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("application/x-video-wall-id", wallId)
    setDraggedWallId(wallId)
    setInsertTarget(null)
  }

  const updateTileDragTarget = (wallId: string, event: React.DragEvent<HTMLDivElement>) => {
    const draggedId =
      draggedWallId || event.dataTransfer.getData("application/x-video-wall-id") || null
    if (!draggedId || draggedId === wallId) return
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const position = event.clientX < rect.left + rect.width / 2 ? "before" : "after"
    setInsertTarget({ wallId, position })
  }

  const finishTileDrop = (wallId: string, event: React.DragEvent<HTMLDivElement>) => {
    const draggedId =
      draggedWallId || event.dataTransfer.getData("application/x-video-wall-id") || null
    if (!draggedId || draggedId === wallId) {
      setDraggedWallId(null)
      setInsertTarget(null)
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const position = insertTarget?.wallId === wallId
      ? insertTarget.position
      : event.clientX < rect.left + rect.width / 2
        ? "before"
        : "after"

    setWall((current) => reorderWall(current, draggedId, wallId, position))
    setDraggedWallId(null)
    setInsertTarget(null)
  }

  const finishWallDrop = (event: React.DragEvent<HTMLDivElement>) => {
    const draggedId =
      draggedWallId || event.dataTransfer.getData("application/x-video-wall-id") || null
    if (!draggedId || !insertTarget) return
    event.preventDefault()
    event.stopPropagation()
    setWall((current) =>
      reorderWall(current, draggedId, insertTarget.wallId, insertTarget.position)
    )
    setDraggedWallId(null)
    setInsertTarget(null)
  }

  const selectTile = (wallId: string, event: ReactPointerEvent<HTMLDivElement>) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (event.ctrlKey || event.metaKey) {
        if (next.has(wallId)) next.delete(wallId)
        else next.add(wallId)
        return next
      }
      if (next.has(wallId) && next.size === 1) return new Set()
      return new Set([wallId])
    })
  }

  const startSelectionDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.shiftKey) return
    const rect = wallRef.current?.getBoundingClientRect()
    if (!rect) return
    event.preventDefault()
    setDragRect({
      startX: event.clientX - rect.left,
      startY: event.clientY - rect.top,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      width: 0,
      height: 0,
    })
  }

  const updateSelectionDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRect || !wallRef.current) return
    const bounds = wallRef.current.getBoundingClientRect()
    const currentX = event.clientX - bounds.left
    const currentY = event.clientY - bounds.top
    const x = Math.min(dragRect.startX, currentX)
    const y = Math.min(dragRect.startY, currentY)
    const width = Math.abs(currentX - dragRect.startX)
    const height = Math.abs(currentY - dragRect.startY)
    setDragRect({ ...dragRect, x, y, width, height })
  }

  const finishSelectionDrag = () => {
    if (!dragRect || !wallRef.current) return
    const wallBounds = wallRef.current.getBoundingClientRect()
    const selection = new DOMRect(
      wallBounds.left + dragRect.x,
      wallBounds.top + dragRect.y,
      dragRect.width,
      dragRect.height
    )
    const selected = new Set<string>()
    tileRefs.current.forEach((node, wallId) => {
      if (intersects(selection, node.getBoundingClientRect())) selected.add(wallId)
    })
    setSelectedIds(selected)
    setDragRect(null)
  }

  const clearCatalog = () => {
    catalog.forEach((item) => URL.revokeObjectURL(item.url))
    setCatalog([])
    setWall([])
    setSelectedIds(new Set())
    setTileMutedIds(new Set())
    setShownThisSession(new Set())
    setIsPlaying(false)
    setMessage("Catalog cleared.")
  }

  const handleMetadata = async (wallId: string, video: CatalogVideo, element: HTMLVideoElement) => {
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

    const hasCrop = Boolean(video.crop)
    if (!hasCrop) {
      const detection = await detectLetterbox(element)
      if (detection) {
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
          duration,
          width,
          height,
          modified: video.modified,
          crop: detection.crop,
          cropConfidence: detection.confidence,
          lastOpenedAt: openedAt,
        })
      }
    }

    if (isPlaying) {
      const current = videoRefs.current.get(wallId)
      await current?.play().catch(() => undefined)
    }
  }

  return (
    <main
      className="relative flex h-screen overflow-hidden bg-background text-foreground"
      onPointerMove={(event) => {
        if (event.clientY <= 72) revealPanel()
        if (event.clientX <= 16) setCatalogOpen(true)
      }}
      onDragOver={(event) => {
        if (isInternalWallDrag(event, draggedWallId)) {
          event.preventDefault()
          setDropActive(false)
          return
        }
        if (!isFileDrag(event)) return
        event.preventDefault()
        setDropActive(true)
      }}
      onDragLeave={(event) => {
        if (isInternalWallDrag(event, draggedWallId)) return
        setDropActive(false)
      }}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        accept={SUPPORTED_ACCEPT}
        multiple
        onChange={handleFileInput}
      />
      <input
        ref={folderInputRef}
        className="hidden"
        type="file"
        accept={SUPPORTED_ACCEPT}
        multiple
        /* @ts-expect-error Chromium directory picker extension */
        webkitdirectory=""
        onChange={handleFileInput}
      />

      <CatalogSidebar
        open={catalogOpen}
        catalog={sortedCatalog}
        activeIds={new Set(wall.map((item) => item.catalogId))}
        sortMode={sortMode}
        onSortModeChange={setSortMode}
        onAddFiles={() => fileInputRef.current?.click()}
        onAddFolder={() => folderInputRef.current?.click()}
        onClear={clearCatalog}
        onToggle={() => setCatalogOpen((current) => !current)}
        onMouseEnter={() => setCatalogOpen(true)}
        onMouseLeave={() => setCatalogOpen(false)}
        onAddToWall={(catalogId) => {
          setWall((current) => [
            ...current,
            {
              wallId: crypto.randomUUID(),
              catalogId,
              pinned: false,
              history: [catalogId],
              historyIndex: 0,
            },
          ])
          setShownThisSession((current) => new Set(current).add(catalogId))
        }}
      />

      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="absolute inset-x-0 top-0 h-20" onMouseEnter={revealPanel} />
        <ControlPanel
          ref={panelRef}
          panelPinned={panelPinned}
          rows={rows}
          playbackRate={playbackRate}
          masterVolume={masterVolume}
          muted={muted}
          cropMode={cropMode}
          aspectFilter={aspectFilter}
          selectedCount={selectedIds.size}
          wallCount={wall.length}
          catalogCount={catalog.length}
          isPlaying={isPlaying}
          shuffleOn={shuffleOn}
          scrollMode={scrollMode}
          onMouseEnter={revealPanel}
          onMouseLeave={() => {
            if (!panelPinned) revealPanel()
          }}
          onTogglePin={() => setPanelPinned((current) => !current)}
          onRowsChange={setRows}
          onPlaybackRateChange={setPlaybackRate}
          onMasterVolumeChange={setMasterVolume}
          onMutedChange={setMuted}
          onCropModeChange={setCropMode}
          onAspectFilterChange={setAspectFilter}
          onPlay={playAll}
          onPause={pauseAll}
          onSeekBackward={() => seekTargets(-SEEK_SECONDS)}
          onSeekForward={() => seekTargets(SEEK_SECONDS)}
          onFill={() => fillWall(shuffleOn, false)}
          onShuffle={() => fillWall(true, true)}
          onShuffleOnChange={setShuffleOn}
          onScrollModeChange={setScrollMode}
        />

        <div
          ref={wallRef}
          className={cn(
            "relative min-h-0 flex-1 overflow-y-hidden p-2",
            scrollMode === "all" ? "overflow-x-auto" : "overflow-x-hidden"
          )}
          onPointerDown={startSelectionDrag}
          onPointerMove={updateSelectionDrag}
          onPointerUp={finishSelectionDrag}
          onDragOver={(event) => {
            if (draggedWallId) event.preventDefault()
          }}
          onDrop={finishWallDrop}
          onWheel={(event) => {
            if (scrollMode !== "all") return
            if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
              event.preventDefault()
              event.currentTarget.scrollLeft += event.deltaY
            }
          }}
        >
          {wallVideos.length === 0 ? (
            <EmptyWall
              onAddFiles={() => fileInputRef.current?.click()}
              onAddFolder={() => folderInputRef.current?.click()}
            />
          ) : (
            <div
              className="mx-auto flex h-full flex-col gap-1.5"
              style={{ width: wallContentWidth }}
            >
              {packedRows.map((row, rowIndex) => (
                <div
                  key={rowIndex}
                  ref={(node) => {
                    if (node) rowRefs.current.set(rowIndex, node)
                    else rowRefs.current.delete(rowIndex)
                  }}
                  className={cn(
                    scrollMode === "row" ? "overflow-x-auto overflow-y-hidden" : "overflow-hidden"
                  )}
                  style={{ height: rowHeight, width: wallContentWidth }}
                  onWheel={(event) => {
                    if (scrollMode !== "row") return
                    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
                      event.preventDefault()
                      event.currentTarget.scrollLeft += event.deltaY
                    }
                  }}
                >
                  <div
                    className="flex h-full gap-1.5 transition-transform duration-300 ease-out"
                    style={{
                      width: row.width,
                      transform: `translateX(${
                        scrollMode === "row" ? Math.max(0, (wallSize.width - row.width) / 2) : row.offset
                      }px)`,
                    }}
                  >
                    {row.items.map(({ wallItem, video, width }) => (
                      <VideoTile
                        key={wallItem.wallId}
                        ref={(node) => {
                          if (node) tileRefs.current.set(wallItem.wallId, node)
                          else tileRefs.current.delete(wallItem.wallId)
                        }}
                        videoRef={(node) => {
                          if (node) videoRefs.current.set(wallItem.wallId, node)
                          else videoRefs.current.delete(wallItem.wallId)
                        }}
                        wallId={wallItem.wallId}
                        video={video}
                        cropMode={cropMode}
                        rowHeight={rowHeight}
                        tileWidth={width}
                        selected={selectedIds.has(wallItem.wallId)}
                        pinned={wallItem.pinned}
                        zoomed={zoomedId === wallItem.wallId}
                        masterVolume={masterVolume}
                        muted={muted}
                        tileMuted={tileMutedIds.has(wallItem.wallId)}
                        playbackRate={playbackRate}
                        isPlaying={isPlaying}
                        dragging={draggedWallId === wallItem.wallId}
                        insertBefore={
                          insertTarget?.wallId === wallItem.wallId &&
                          insertTarget.position === "before"
                        }
                        insertAfter={
                          insertTarget?.wallId === wallItem.wallId &&
                          insertTarget.position === "after"
                        }
                        onDragStart={(event) => startTileDrag(wallItem.wallId, event)}
                        onDragOver={(event) => updateTileDragTarget(wallItem.wallId, event)}
                        onDrop={(event) => finishTileDrop(wallItem.wallId, event)}
                        onDragEnd={() => {
                          setDraggedWallId(null)
                          setInsertTarget(null)
                        }}
                        onSelect={selectTile}
                        onDoubleClick={() => setZoomedId(wallItem.wallId)}
                        onCloseZoom={() => setZoomedId(null)}
                        onEnded={() => refillTile(wallItem.wallId)}
                        onPrevious={() => stepTile(wallItem.wallId, "previous")}
                        onNext={() => stepTile(wallItem.wallId, "next")}
                        onSeekPercent={(percent) => seekTilePercent(wallItem.wallId, percent)}
                        onMetadata={(element) => void handleMetadata(wallItem.wallId, video, element)}
                        onToggleMute={() => toggleMuteTile(wallItem.wallId)}
                        onTogglePin={() => togglePinTile(wallItem.wallId)}
                        onRemove={() => removeTile(wallItem.wallId)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {dragRect ? (
            <div
              className="pointer-events-none absolute rounded border border-primary bg-primary/15"
              style={{
                left: dragRect.x,
                top: dragRect.y,
                width: dragRect.width,
                height: dragRect.height,
              }}
            />
          ) : null}
        </div>
      </section>

      {dropActive ? (
        <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-lg border border-primary bg-background/75 text-sm font-medium text-foreground backdrop-blur">
          Drop files or folders to build the wall
        </div>
      ) : null}
    </main>
  )
}

function CatalogSidebar({
  open,
  catalog,
  activeIds,
  sortMode,
  onSortModeChange,
  onAddFiles,
  onAddFolder,
  onClear,
  onToggle,
  onMouseEnter,
  onMouseLeave,
  onAddToWall,
}: {
  open: boolean
  catalog: CatalogVideo[]
  activeIds: Set<string>
  sortMode: SortMode
  onSortModeChange: (value: SortMode) => void
  onAddFiles: () => void
  onAddFolder: () => void
  onClear: () => void
  onToggle: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
  onAddToWall: (catalogId: string) => void
}) {
  return (
    <aside
      className={cn(
        "absolute inset-y-0 left-0 z-20 flex h-screen shrink-0 flex-col border-r border-white/10 bg-sidebar/55 shadow-2xl backdrop-blur-xl transition-[width]",
        open ? "w-72 pointer-events-auto" : "w-0 overflow-hidden border-transparent shadow-none pointer-events-none"
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex h-14 items-center gap-2 px-3">
        {open ? (
          <>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Catalog</div>
              <div className="text-xs text-muted-foreground">
                {catalog.length} videos · sorted by {sortMode}
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label="Collapse catalog">
              <ChevronLeft data-icon="inline-start" />
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="icon-sm" onClick={onToggle} aria-label="Open catalog">
            <ChevronRight data-icon="inline-start" />
          </Button>
        )}
      </div>

      {open ? (
        <>
          <div className="flex gap-2 px-3 pb-3">
            <Button size="sm" className="flex-1" onClick={onAddFolder}>
              <FolderOpen data-icon="inline-start" />
              Folder
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={onAddFiles}>
              <Plus data-icon="inline-start" />
              Files
            </Button>
          </div>
          <div className="px-3 pb-3">
            <Select value={sortMode} onValueChange={(value) => onSortModeChange(value as SortMode)}>
              <SelectTrigger size="sm" className="w-full">
                <SelectValue placeholder="Sort library" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="date">Date</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="duration">Duration</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-1 p-2">
              {catalog.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="flex min-h-16 w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-sidebar-accent"
                  onDoubleClick={() => onAddToWall(item.id)}
                >
                  <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded bg-muted text-xs text-muted-foreground">
                    {item.width && item.height ? `${item.width}p` : "VID"}
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.name}</span>
                    <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {formatDuration(item.duration)}
                      <span>·</span>
                      {formatFileSize(item.size)}
                    </span>
                  </span>
                  {activeIds.has(item.id) ? <Badge variant="secondary">wall</Badge> : null}
                </button>
              ))}
              {catalog.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  Drop videos or folders onto the window.
                </div>
              ) : null}
            </div>
          </ScrollArea>
          <div className="border-t border-border p-2">
            <Button variant="ghost" size="sm" className="w-full" onClick={onClear}>
              <CircleOff data-icon="inline-start" />
              Clear catalog
            </Button>
          </div>
        </>
      ) : null}
    </aside>
  )
}

const ControlPanel = forwardRef<HTMLDivElement, ControlPanelProps>(function ControlPanel(
  {
    panelPinned,
    rows,
    playbackRate,
    masterVolume,
    muted,
    cropMode,
    aspectFilter,
    shuffleOn,
    scrollMode,
    selectedCount,
    wallCount,
    catalogCount,
    isPlaying,
    onMouseEnter,
    onMouseLeave,
    onTogglePin,
    onRowsChange,
    onPlaybackRateChange,
    onMasterVolumeChange,
    onMutedChange,
    onCropModeChange,
    onAspectFilterChange,
    onPlay,
    onPause,
    onSeekBackward,
    onSeekForward,
    onFill,
    onShuffle,
    onShuffleOnChange,
    onScrollModeChange,
  },
  ref
) {
  return (
    <div
      ref={ref}
      className="absolute left-1/2 top-2 z-30 w-fit max-w-[calc(100vw-1.5rem)] -translate-x-1/2 rounded-lg border border-white/10 bg-popover/65 p-2 text-popover-foreground shadow-2xl backdrop-blur-xl"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-nowrap items-center gap-2">
        <div className="flex items-center gap-1">
          <TooltipButton label={isPlaying ? "Pause all videos" : "Play all videos"}>
            <Button
              size="icon-sm"
              onClick={isPlaying ? onPause : onPlay}
              aria-label={isPlaying ? "Pause all videos" : "Play all videos"}
            >
              {isPlaying ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
            </Button>
          </TooltipButton>
          <TooltipButton label="Skip backward 5 seconds">
            <Button size="icon-sm" variant="outline" onClick={onSeekBackward}>
              <SkipBack data-icon="inline-start" />
            </Button>
          </TooltipButton>
          <TooltipButton label="Skip forward 5 seconds">
            <Button size="icon-sm" variant="outline" onClick={onSeekForward}>
              <SkipForward data-icon="inline-start" />
            </Button>
          </TooltipButton>
        </div>

        <Separator orientation="vertical" className="h-7" />

        <Button
          variant={muted ? "default" : "outline"}
          size="icon-sm"
          onClick={() => onMutedChange(!muted)}
          aria-label={muted ? "Unmute all videos" : "Mute all videos"}
        >
          {muted ? <VolumeX data-icon="inline-start" /> : <Volume2 data-icon="inline-start" />}
        </Button>
        <ControlSlider
          label="Volume"
          showLabel={false}
          value={Math.round(masterVolume * 100)}
          min={0}
          max={100}
          onValueChange={(value) => onMasterVolumeChange(value / 100)}
        />

        <StepperControl
          label="Speed"
          icon={<FastForward data-icon="inline-start" />}
          value={`${playbackRate.toFixed(2)}x`}
          onDecrease={() => onPlaybackRateChange(Math.max(0.25, playbackRate - 0.25))}
          onIncrease={() => onPlaybackRateChange(Math.min(2, playbackRate + 0.25))}
        />

        <StepperControl
          label="Rows"
          icon={<Rows3 data-icon="inline-start" />}
          value={rows}
          onDecrease={() => onRowsChange(Math.max(1, rows - 1))}
          onIncrease={() => onRowsChange(Math.min(6, rows + 1))}
        />

        <Select value={cropMode} onValueChange={(value) => onCropModeChange(value as CropMode)}>
          <SelectTrigger size="sm" className="w-36">
            <Crop data-icon="inline-start" />
            <SelectValue placeholder="Crop" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="detected">Detected</SelectItem>
              <SelectItem value="fill">Fill</SelectItem>
              <SelectItem value="fit">Fit</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <Select
          value={aspectFilter}
          onValueChange={(value) => onAspectFilterChange(value as AspectFilter)}
        >
          <SelectTrigger size="sm" className="w-32">
            <SelectValue placeholder="Aspect" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="mixed">Mixed</SelectItem>
              <SelectItem value="landscape">Landscape</SelectItem>
              <SelectItem value="portrait">Portrait</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        </div>

        <div className="flex flex-nowrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={onFill}>
          <PaintBucket data-icon="inline-start" />
          Fill wall
        </Button>
        <Button size="sm" variant="outline" onClick={onShuffle}>
          <Dice5 data-icon="inline-start" />
          Random
        </Button>
        <Button
          size="sm"
          variant={shuffleOn ? "default" : "outline"}
          onClick={() => onShuffleOnChange(!shuffleOn)}
        >
          <Shuffle data-icon="inline-start" />
          Shuffle
        </Button>
        <Button
          size="sm"
          variant={scrollMode === "row" ? "default" : "outline"}
          onClick={() => onScrollModeChange(scrollMode === "row" ? "all" : "row")}
        >
          Scroll row
        </Button>
        </div>
      </div>
      <Button
        className="absolute bottom-2 right-2"
        size="icon-sm"
        variant={panelPinned ? "default" : "ghost"}
        onClick={onTogglePin}
        aria-label="Pin control panel"
      >
        {panelPinned ? <PinOff data-icon="inline-start" /> : <Pin data-icon="inline-start" />}
      </Button>
      <div className="mt-2 flex items-center justify-center text-xs text-muted-foreground">
        <span>
          {wallCount} on wall · {catalogCount} in catalog · {selectedCount || "none"} selected · ` toggles panel
        </span>
      </div>
    </div>
  )
})

type ControlPanelProps = {
  panelPinned: boolean
  rows: number
  playbackRate: number
  masterVolume: number
  muted: boolean
  cropMode: CropMode
  aspectFilter: AspectFilter
  selectedCount: number
  wallCount: number
  catalogCount: number
  isPlaying: boolean
  shuffleOn: boolean
  scrollMode: ScrollMode
  onMouseEnter: () => void
  onMouseLeave: () => void
  onTogglePin: () => void
  onRowsChange: (value: number) => void
  onPlaybackRateChange: (value: number) => void
  onMasterVolumeChange: (value: number) => void
  onMutedChange: (value: boolean) => void
  onCropModeChange: (value: CropMode) => void
  onAspectFilterChange: (value: AspectFilter) => void
  onPlay: () => void
  onPause: () => void
  onSeekBackward: () => void
  onSeekForward: () => void
  onFill: () => void
  onShuffle: () => void
  onShuffleOnChange: (value: boolean) => void
  onScrollModeChange: (value: ScrollMode) => void
}

function ControlSlider({
  label,
  showLabel = true,
  value,
  min,
  max,
  step = 1,
  onValueChange,
}: {
  label: string
  showLabel?: boolean
  value: number
  min: number
  max: number
  step?: number
  onValueChange: (value: number) => void
}) {
  return (
    <label className={cn("flex items-center gap-2 text-xs text-muted-foreground", showLabel ? "w-44" : "w-24")}>
      {showLabel ? <span className="w-20 shrink-0 truncate">{label}</span> : null}
      <Slider
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(values) =>
          onValueChange(Array.isArray(values) ? values[0] ?? value : values)
        }
      />
    </label>
  )
}

function StepperControl({
  label,
  icon,
  value,
  onDecrease,
  onIncrease,
}: {
  label: string
  icon: ReactNode
  value: string | number
  onDecrease: () => void
  onIncrease: () => void
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-background/45 p-1 text-xs text-muted-foreground">
      <span className="flex w-6 justify-center" aria-label={label}>
        {icon}
      </span>
      <Button size="icon-xs" variant="ghost" onClick={onDecrease} aria-label={`Decrease ${label}`}>
        <Minus data-icon="inline-start" />
      </Button>
      <span className="min-w-12 text-center tabular-nums text-foreground">{value}</span>
      <Button size="icon-xs" variant="ghost" onClick={onIncrease} aria-label={`Increase ${label}`}>
        <Plus data-icon="inline-start" />
      </Button>
    </div>
  )
}

const VideoTile = forwardRef<HTMLDivElement, VideoTileProps>(function VideoTile(
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
    onToggleMute,
    onTogglePin,
    onRemove,
  },
  ref
) {
  const cropStyle = getVideoCropStyle(video, cropMode)
  const [controlsVisible, setControlsVisible] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(video.duration ?? 0)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controlPointerActiveRef = useRef(false)
  const shortLoopSecondsRef = useRef(0)

  const revealControls = useCallback(() => {
    setControlsVisible(true)
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    controlsTimerRef.current = setTimeout(() => {
      setControlsVisible(false)
    }, 4000)
  }, [])

  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current)
    }
  }, [])

  useEffect(() => {
    shortLoopSecondsRef.current = 0
  }, [video.id, video.duration])

  useEffect(() => {
    const element = localVideoRef.current
    if (!element) return
    element.playbackRate = playbackRate
    element.volume = masterVolume
    element.muted = muted || tileMuted || masterVolume === 0
  }, [masterVolume, muted, playbackRate, tileMuted])

  const updateScrub = (event: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>) => {
    const nextTime = Number(event.currentTarget.value)
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
      <Button size="icon-xs" variant="secondary" onClick={onDoubleClick} aria-label="Zoom video">
        <Maximize2 data-icon="inline-start" />
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
      ref={ref}
      className={cn(
        "relative shrink-0 overflow-hidden rounded-md border bg-black shadow-sm outline-none",
        selected ? "border-primary ring-2 ring-primary/40" : "border-border/60",
        dragging && "opacity-45",
        !controlsVisible && !zoomed && "cursor-none",
        zoomed && "fixed left-1/2 top-1/2 z-40 h-[95vh] w-[95vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border-primary"
      )}
      style={
        zoomed
          ? undefined
          : {
              height: rowHeight,
              width: tileWidth,
            }
      }
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
        setControlsVisible(false)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onDoubleClick()
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
          className="fixed inset-0 -z-10 cursor-default bg-background/70"
          onClick={onCloseZoom}
        />
      ) : null}
      <video
        ref={(node) => {
          localVideoRef.current = node
          videoRef(node)
        }}
        src={video.url}
        className="h-full w-full bg-black"
        style={cropStyle}
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
          onMetadata(element)
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
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
        onError={() => undefined}
      />
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
            {video.crop ? <span>crop {Math.round((video.cropConfidence ?? 0) * 100)}%</span> : null}
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
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void
  onDragOver: (event: React.DragEvent<HTMLDivElement>) => void
  onDrop: (event: React.DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onSelect: (wallId: string, event: ReactPointerEvent<HTMLDivElement>) => void
  onDoubleClick: () => void
  onCloseZoom: () => void
  onEnded: () => void
  onPrevious: () => void
  onNext: () => void
  onSeekPercent: (percent: number) => void
  onMetadata: (element: HTMLVideoElement) => void
  onToggleMute: () => void
  onTogglePin: () => void
  onRemove: () => void
}

function EmptyWall({ onAddFiles, onAddFolder }: { onAddFiles: () => void; onAddFolder: () => void }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-lg border border-dashed border-border bg-card/50 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-lg bg-muted">
          <FolderOpen data-icon="inline-start" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Video Wall</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Drop local videos or folders onto the window. The wall fills itself, plays automatically, and replaces finished videos from the session catalog.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={onAddFolder}>
            <FolderOpen data-icon="inline-start" />
            Add Folder
          </Button>
          <Button variant="outline" onClick={onAddFiles}>
            <Plus data-icon="inline-start" />
            Add Files
          </Button>
        </div>
      </div>
    </div>
  )
}

function TooltipButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children as ReactElement} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function getEffectiveAspectRatio(video: CatalogVideo, cropMode: CropMode) {
  const naturalAspect = video.width && video.height ? video.width / video.height : 16 / 9
  if (cropMode === "detected" && video.crop && hasMeaningfulCrop(video.crop)) {
    return Math.max(0.25, Math.min(4, naturalAspect * (video.crop.width / video.crop.height)))
  }
  return Math.max(0.25, Math.min(4, naturalAspect))
}

function filterCatalogByAspect(
  catalog: CatalogVideo[],
  aspectFilter: AspectFilter,
  cropMode: CropMode
) {
  if (aspectFilter === "mixed") return catalog
  return catalog.filter((video) => {
    const aspect = getEffectiveAspectRatio(video, cropMode)
    return aspectFilter === "landscape" ? aspect >= 1 : aspect < 1
  })
}

function readVideoDetails(video: CatalogVideo) {
  return new Promise<Pick<CatalogVideo, "duration" | "width" | "height">>((resolve, reject) => {
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

function packRows(
  items: Array<{ wallItem: WallVideo; video: CatalogVideo; videos: CatalogVideo[] }>,
  rows: number,
  rowHeight: number,
  containerWidth: number,
  cropMode: CropMode
): PackedRow[] {
  const safeRows = Math.max(1, rows)
  const gap = 6
  const overflowAllowance = Math.max(12, containerWidth * 0.015)
  const packedRows: PackedRow[] = Array.from({ length: safeRows }, () => ({
    items: [],
    width: 0,
    offset: 0,
  }))

  let activeRow = 0

  for (const item of items) {
    const aspect = getEffectiveAspectRatio(item.video, cropMode)
    const width = Math.max(48, rowHeight * aspect)
    const row = packedRows[activeRow]
    const nextWidth = row.width + (row.items.length > 0 ? gap : 0) + width

    if (
      row.items.length > 0 &&
      nextWidth > containerWidth + overflowAllowance &&
      activeRow < safeRows - 1
    ) {
      activeRow += 1
    } else if (
      row.items.length > 0 &&
      nextWidth > containerWidth + overflowAllowance &&
      activeRow === safeRows - 1
    ) {
      activeRow = shortestRowIndex(packedRows)
    }

    const targetRow = packedRows[activeRow]
    targetRow.items.push({ ...item, aspect, width })
    targetRow.width += (targetRow.items.length > 1 ? gap : 0) + width
  }

  return packedRows.map((row) => {
    const maxRowWidth = containerWidth * 1.08
    const scaledItems =
      row.width > maxRowWidth
        ? row.items.map((item) => ({ ...item, width: item.width * (maxRowWidth / row.width) }))
        : row.items
    const scaledWidth = row.width > maxRowWidth ? maxRowWidth : row.width
    const centeredOffset = (containerWidth - scaledWidth) / 2
    const maxNegativeOffset = -overflowAllowance
    const offset = Math.max(maxNegativeOffset, centeredOffset)
    return { ...row, items: scaledItems, width: scaledWidth, offset }
  })
}

function buildWallToFillRows({
  catalog,
  currentWall,
  rows,
  rowHeight,
  containerWidth,
  cropMode,
  random,
  replace,
}: {
  catalog: CatalogVideo[]
  currentWall: WallVideo[]
  rows: number
  rowHeight: number
  containerWidth: number
  cropMode: CropMode
  random: boolean
  replace: boolean
}) {
  if (catalog.length === 0) return []

  const catalogById = new Map(catalog.map((item) => [item.id, item]))
  const retainedWall = replace
    ? currentWall.filter((item) => item.pinned && catalogById.has(item.catalogId))
    : currentWall.filter((item) => catalogById.has(item.catalogId))
  const usedIds = new Set(retainedWall.flatMap(getWallCatalogIds))
  const orderedCatalog = random ? shuffle(catalog) : catalog
  const candidates = orderedCatalog.filter((item) => !usedIds.has(item.id))
  const nextWall = [...retainedWall]

  if (containerWidth <= 0 || rowHeight <= 0) {
    const fallbackTarget = Math.min(catalog.length, Math.max(rows * 6, 1))
    for (const item of candidates.slice(0, Math.max(0, fallbackTarget - nextWall.length))) {
      nextWall.push({
        wallId: crypto.randomUUID(),
        catalogId: item.id,
        pinned: false,
        history: [item.id],
        historyIndex: 0,
      })
    }
    return nextWall
  }

  while (candidates.length > 0 && !wallRowsAreFilled(nextWall, catalogById, rows, rowHeight, containerWidth, cropMode)) {
    const item = candidates.shift()
    if (!item) break
    nextWall.push({
      wallId: crypto.randomUUID(),
      catalogId: item.id,
      pinned: false,
      history: [item.id],
      historyIndex: 0,
    })
  }

  return nextWall
}

function wallRowsAreFilled(
  wall: WallVideo[],
  catalogById: Map<string, CatalogVideo>,
  rows: number,
  rowHeight: number,
  containerWidth: number,
  cropMode: CropMode
) {
  const items = wall
    .map((wallItem) => {
      const video = catalogById.get(wallItem.catalogId)
      return video ? { wallItem, video, videos: [video] } : null
    })
    .filter(
      (item): item is { wallItem: WallVideo; video: CatalogVideo; videos: CatalogVideo[] } =>
        Boolean(item)
    )
  const packed = packRows(items, rows, rowHeight, containerWidth, cropMode)
  return packed.every((row) => row.items.length > 0 && row.width >= containerWidth * 0.96)
}

function replaceWallVideo({
  wall,
  wallId,
  direction,
  catalog,
  shownThisSession,
  shuffleOn,
  respectPinned,
  keepWallId,
}: {
  wall: WallVideo[]
  wallId: string
  direction: ReplaceDirection
  catalog: CatalogVideo[]
  shownThisSession: Set<string>
  shuffleOn: boolean
  respectPinned: boolean
  keepWallId: boolean
}) {
  const target = wall.find((item) => item.wallId === wallId)
  if (!target || (respectPinned && target.pinned)) {
    return { wall, nextShownIds: [] as string[] }
  }

  const history = target.history?.length ? target.history : [target.catalogId]
  const historyIndex = target.historyIndex ?? history.length - 1

  if (direction === "previous" && historyIndex > 0) {
    const previousId = history[historyIndex - 1]
    return {
      wall: wall.map((item) =>
        item.wallId === wallId
          ? { ...item, catalogId: previousId, history, historyIndex: historyIndex - 1 }
          : item
      ),
      nextShownIds: [] as string[],
    }
  }

  const targetVideo = catalog.find((item) => item.id === target.catalogId)
  const candidates = chooseReplacementVideos({
    catalog,
    wall,
    shownThisSession,
    shuffleOn,
    targetAspect: targetVideo ? getEffectiveAspectRatio(targetVideo, "detected") : undefined,
    allowPortraitPair: !keepWallId,
  })

  if (candidates.length === 0) {
    return { wall: wall.filter((item) => item.wallId !== wallId), nextShownIds: [] as string[] }
  }

  const [candidate, ...extraCandidates] = candidates
  const nextHistory =
    direction === "previous"
      ? [...history, candidate.id]
      : [...history.slice(0, historyIndex + 1), candidate.id]
  const replacementItems: WallVideo[] = [
    {
      ...target,
      wallId: keepWallId ? target.wallId : crypto.randomUUID(),
      catalogId: candidate.id,
      catalogIds: undefined,
      pinned: false,
      history: nextHistory,
      historyIndex: nextHistory.length - 1,
    },
    ...extraCandidates.map((item) => ({
      wallId: crypto.randomUUID(),
      catalogId: item.id,
      pinned: false,
      history: [item.id],
      historyIndex: 0,
    })),
  ]

  return {
    wall: wall.flatMap((item) => (item.wallId === wallId ? replacementItems : [item])),
    nextShownIds: candidates.map((item) => item.id),
  }
}

function chooseReplacementVideos({
  catalog,
  wall,
  shownThisSession,
  shuffleOn,
  targetAspect,
  allowPortraitPair,
}: {
  catalog: CatalogVideo[]
  wall: WallVideo[]
  shownThisSession: Set<string>
  shuffleOn: boolean
  targetAspect?: number
  allowPortraitPair: boolean
}) {
  if (catalog.length === 0) return []
  const used = new Set(wall.flatMap(getWallCatalogIds))
  const orderedCatalog = shuffleOn ? shuffle(catalog) : catalog
  const unseen = orderedCatalog.filter(
    (item) => !shownThisSession.has(item.id) && !used.has(item.id)
  )
  const loopPool = orderedCatalog.filter((item) => !used.has(item.id))
  const pool = unseen.length > 0 ? unseen : loopPool.length > 0 ? loopPool : orderedCatalog

  if (targetAspect && targetAspect > 1.3 && allowPortraitPair) {
    const portraits = pool.filter((item) => getEffectiveAspectRatio(item, "detected") < 0.9)
    if (portraits.length >= 2) return portraits.slice(0, 2)
  }

  if (!targetAspect) return pool[0] ? [pool[0]] : []
  const sortedByAspect = [...pool].sort(
    (a, b) =>
      Math.abs(getEffectiveAspectRatio(a, "detected") - targetAspect) -
      Math.abs(getEffectiveAspectRatio(b, "detected") - targetAspect)
  )
  return sortedByAspect[0] ? [sortedByAspect[0]] : []
}

function updateShownSet(current: Set<string>, nextId: string, catalogLength: number) {
  const next = new Set(current)
  if (next.size >= catalogLength) next.clear()
  next.add(nextId)
  return next
}

function getWallCatalogIds(wallItem: WallVideo) {
  return wallItem.catalogIds?.length ? wallItem.catalogIds : [wallItem.catalogId]
}

function reorderWall(
  wall: WallVideo[],
  draggedWallId: string,
  targetWallId: string,
  position: InsertPosition
) {
  const draggedIndex = wall.findIndex((item) => item.wallId === draggedWallId)
  const targetIndex = wall.findIndex((item) => item.wallId === targetWallId)
  if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return wall

  const next = [...wall]
  const [draggedItem] = next.splice(draggedIndex, 1)
  const adjustedTargetIndex = next.findIndex((item) => item.wallId === targetWallId)
  const insertIndex = position === "before" ? adjustedTargetIndex : adjustedTargetIndex + 1
  next.splice(insertIndex, 0, draggedItem)
  return next
}

function isInternalWallDrag(event: React.DragEvent<HTMLElement>, draggedWallId: string | null) {
  return (
    Boolean(draggedWallId) ||
    Array.from(event.dataTransfer.types).includes("application/x-video-wall-id")
  )
}

function isFileDrag(event: React.DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files")
}

function shortestRowIndex(rows: PackedRow[]) {
  let shortest = 0
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].width < rows[shortest].width) shortest = index
  }
  return shortest
}

function getRowHeight(containerHeight: number, rows: number) {
  const safeRows = Math.max(1, rows)
  const totalGap = (safeRows - 1) * 6
  if (containerHeight <= totalGap) return 120
  return Math.max(48, (containerHeight - totalGap) / safeRows)
}

function getVideoCropStyle(video: CatalogVideo, cropMode: CropMode): CSSProperties {
  if (cropMode === "fit") return { objectFit: "contain" }
  if (cropMode === "fill") return { objectFit: "cover" }
  if (!video.crop || !hasMeaningfulCrop(video.crop)) return { objectFit: "fill" }

  const { x, y, width, height } = video.crop
  return {
    objectFit: "fill",
    transformOrigin: `${(x + width / 2) * 100}% ${(y + height / 2) * 100}%`,
    transform: `scale(${1 / width}, ${1 / height})`,
  }
}

function hasMeaningfulCrop(crop: { width: number; height: number }) {
  return crop.width < 0.97 || crop.height < 0.97
}

function intersects(a: DOMRect, b: DOMRect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function shuffle<T>(items: T[]) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function timestamp() {
  return new Date().getTime()
}
