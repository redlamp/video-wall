"use client"

import {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import gsap from "gsap"
import Image from "next/image"
import {
  FolderOpen,
  Plus,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { CatalogSidebar } from "@/components/catalog-sidebar"
import { ControlPanel, type PanelPosition, type ScrollMode, type ThemeMode } from "@/components/control-panel"
import { VideoTile } from "@/components/video-tile"
import { createAsyncLimiter, mapWithConcurrency } from "@/lib/async-queue"
import { detectLetterbox } from "@/lib/crop-detection"
import { createCatalogVideo, filesFromDataTransfer, isVideoFile } from "@/lib/media"
import { persistVideoDetails, readVideoDetails } from "@/lib/media-details"
import { getVideoMeta, saveLastSession, saveVideoMeta } from "@/lib/video-db"
import type { CatalogVideo, CropMode, SortMode, WallVideo } from "@/lib/video-types"
import {
  buildWallToFillRows,
  filterCatalogByAspect,
  getRowHeight,
  getWallCatalogIds,
  hasKnownAspect,
  packRows,
  reorderWall,
  replaceWallVideo,
  updateShownSet,
  type AspectFilter,
  type InsertPosition,
  type ReplaceDirection,
} from "@/lib/wall-layout"
import { cn } from "@/lib/utils"

const DEFAULT_ROWS = 2
const SEEK_SECONDS = 5
const METADATA_CONCURRENCY = 4
const CROP_DETECTION_CONCURRENCY = 2
const SUPPORTED_ACCEPT = ".mp4,.mov,.webm,.m4v,.mkv,.avi,video/*"
const PUBLIC_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ""
const THEME_STORAGE_KEY = "video-wall-theme"
const THEME_CHANGE_EVENT = "video-wall-theme-change"
const runCropDetection = createAsyncLimiter(CROP_DETECTION_CONCURRENCY)

type DragRect = {
  startX: number
  startY: number
  x: number
  y: number
  width: number
  height: number
}

type InsertTarget = {
  wallId: string
  position: InsertPosition
} | null
type PlaybackSnapshot = {
  currentTime: number
  wasPlaying: boolean
}
type PanelDrag = {
  offsetX: number
  offsetY: number
}

function getStoredThemeMode(): ThemeMode {
  if (typeof window === "undefined") return "dark"
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  return stored === "light" || stored === "dark" ? stored : "dark"
}

function subscribeToThemeModeChange(onStoreChange: () => void) {
  const handleStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) onStoreChange()
  }

  window.addEventListener("storage", handleStorage)
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange)

  return () => {
    window.removeEventListener("storage", handleStorage)
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange)
  }
}

function useThemeMode() {
  const themeMode = useSyncExternalStore<ThemeMode>(
    subscribeToThemeModeChange,
    getStoredThemeMode,
    () => "dark"
  )

  const setThemeMode = useCallback((value: ThemeMode) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, value)
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  }, [])

  return [themeMode, setThemeMode] as const
}

export function VideoWallApp() {
  const [catalog, setCatalog] = useState<CatalogVideo[]>([])
  const [wall, setWall] = useState<WallVideo[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [shownThisSession, setShownThisSession] = useState<Set<string>>(new Set())
  const [rows, setRows] = useState(DEFAULT_ROWS)
  const [sortMode, setSortMode] = useState<SortMode>("date")
  const [playbackRate, setPlaybackRate] = useState(1)
  const [masterVolume, setMasterVolume] = useState(0.2)
  const [muted, setMuted] = useState(true)
  const [cropMode, setCropMode] = useState<CropMode>("detected")
  const [aspectFilter, setAspectFilter] = useState<AspectFilter>("mixed")
  const [panelOpen, setPanelOpen] = useState(true)
  const [panelPinned, setPanelPinned] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [shuffleOn, setShuffleOn] = useState(true)
  const [scrollMode, setScrollMode] = useState<ScrollMode>("all")
  const [themeMode, setThemeMode] = useThemeMode()
  const [wallSize, setWallSize] = useState({ width: 0, height: 0 })
  const [zoomedId, setZoomedId] = useState<string | null>(null)
  const [dragRect, setDragRect] = useState<DragRect | null>(null)
  const [draggedWallId, setDraggedWallId] = useState<string | null>(null)
  const [insertTarget, setInsertTarget] = useState<InsertTarget>(null)
  const [dropActive, setDropActive] = useState(false)
  const [panelPosition, setPanelPosition] = useState<PanelPosition | null>(null)
  const [message, setMessage] = useState("")

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
  const playbackRestoreRef = useRef(new Map<string, PlaybackSnapshot>())
  const panelDragRef = useRef<PanelDrag | null>(null)
  const catalogUrlsRef = useRef<Set<string>>(new Set())

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

  useEffect(() => {
    catalogUrlsRef.current = new Set(catalog.map((item) => item.url))
  }, [catalog])

  useEffect(() => {
    return () => {
      catalogUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", themeMode === "dark")
  }, [themeMode])

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

      if (zoomedId === wallId) {
        gsap.killTweensOf(node)
        gsap.set(node, { clearProps: "transform" })
        return
      }

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
  }, [draggedWallId, packedRows, zoomedId])

  const addFiles = useCallback(
    async (files: File[]) => {
      const videos = files.filter(isVideoFile)
      if (videos.length === 0) {
        setMessage("No browser-playable video files found.")
        return
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
    async (random = false, replace = false) => {
      let sourceCatalog = filteredCatalog

      if (aspectFilter !== "mixed" && sortedCatalog.some((item) => !hasKnownAspect(item))) {
        const hydratedCatalog = await hydrateCatalogDetails(sortedCatalog)
        sourceCatalog = filterCatalogByAspect(hydratedCatalog, aspectFilter, cropMode)
        setCatalog((current) => mergeHydratedCatalog(current, hydratedCatalog))
      }

      const nextWall = buildWallToFillRows({
        catalog: sourceCatalog,
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
    [aspectFilter, cropMode, filteredCatalog, rowHeight, rows, sortedCatalog, wall, wallSize.width]
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

  useEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    gsap.to(panel, {
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

  const clearPanelHideTimer = useCallback(() => {
    if (panelHideTimerRef.current) clearTimeout(panelHideTimerRef.current)
    panelHideTimerRef.current = null
  }, [])

  const showPanel = useCallback(() => {
    setPanelOpen(true)
    clearPanelHideTimer()
  }, [clearPanelHideTimer])

  const schedulePanelHide = useCallback(() => {
    clearPanelHideTimer()
    if (!panelPinned) {
      panelHideTimerRef.current = setTimeout(() => {
        setPanelOpen(false)
      }, 4000)
    }
  }, [clearPanelHideTimer, panelPinned])

  const revealPanel = useCallback(() => {
    showPanel()
    schedulePanelHide()
  }, [schedulePanelHide, showPanel])

  const startPanelDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest("button,input,[role='combobox'],[data-panel-interactive]")) return
    const panel = panelRef.current
    if (!panel) return

    const rect = panel.getBoundingClientRect()
    panelDragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    }
    setPanelPosition({ left: rect.left, top: rect.top })
    panel.setPointerCapture(event.pointerId)
  }

  const dragPanel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = panelDragRef.current
    const panel = panelRef.current
    if (!drag || !panel) return

    const rect = panel.getBoundingClientRect()
    setPanelPosition({
      left: clamp(event.clientX - drag.offsetX, 8, window.innerWidth - rect.width - 8),
      top: clamp(event.clientY - drag.offsetY, 8, window.innerHeight - rect.height - 8),
    })
  }

  const finishPanelDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panelDragRef.current) return
    panelDragRef.current = null
    panelRef.current?.releasePointerCapture(event.pointerId)
  }

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

  const rememberPlaybackPosition = (wallId: string) => {
    const video = videoRefs.current.get(wallId)
    if (!video) return
    playbackRestoreRef.current.set(wallId, {
      currentTime: video.currentTime,
      wasPlaying: !video.paused,
    })
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
    rememberPlaybackPosition(draggedId)
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
    rememberPlaybackPosition(draggedId)
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

  const markVideoError = useCallback((video: CatalogVideo) => {
    const error = "Browser could not play this video."
    setCatalog((current) =>
      current.map((item) => (item.id === video.id ? { ...item, unsupported: true, error } : item))
    )
    setMessage(`${error} ${video.name}`)
  }, [])

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
      const detection = await runCropDetection(() => {
        if (videoRefs.current.get(wallId) !== element) return Promise.resolve(undefined)
        return detectLetterbox(element)
      })
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

    const restore = playbackRestoreRef.current.get(wallId)
    if (restore && Number.isFinite(restore.currentTime) && element.duration > 0) {
      element.currentTime = Math.min(restore.currentTime, Math.max(0, element.duration - 0.05))
      if (restore.wasPlaying || isPlaying) {
        await element.play().catch(() => undefined)
      }
      playbackRestoreRef.current.delete(wallId)
    }
  }

  return (
    <main
      className="relative flex h-screen overflow-hidden bg-background text-foreground"
      onPointerMove={(event) => {
        if (window.innerHeight - event.clientY <= 72) revealPanel()
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
        selectedCount={selectedIds.size}
        wallCount={wall.length}
        catalogCount={catalog.length}
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
        <div className="absolute inset-x-0 bottom-0 h-20" onMouseEnter={revealPanel} />
        <ControlPanel
          ref={panelRef}
          panelPinned={panelPinned}
          panelPosition={panelPosition}
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
          themeMode={themeMode}
          onMouseEnter={showPanel}
          onMouseLeave={schedulePanelHide}
          onPanelPointerDown={startPanelDrag}
          onPanelPointerMove={dragPanel}
          onPanelPointerUp={finishPanelDrag}
          onPanelPointerCancel={finishPanelDrag}
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
          onFill={() => void fillWall(shuffleOn, false)}
          onShuffle={() => void fillWall(true, true)}
          onShuffleOnChange={setShuffleOn}
          onScrollModeChange={setScrollMode}
          onThemeModeChange={setThemeMode}
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
                    className="flex h-full gap-1.5 transition-[margin-left] duration-300 ease-out"
                    style={{
                      width: row.width,
                      marginLeft: `${
                        scrollMode === "row"
                          ? Math.max(0, (wallSize.width - row.width) / 2)
                          : Math.max(0, (wallContentWidth - row.width) / 2)
                      }px`,
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
                        onError={() => markVideoError(video)}
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

      <StatusMessage message={message} onDismiss={() => setMessage("")} />

      {dropActive ? (
        <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-lg border border-primary bg-background/75 text-sm font-medium text-foreground backdrop-blur">
          Drop files or folders to build the wall
        </div>
      ) : null}
    </main>
  )
}

function StatusMessage({
  message,
  onDismiss,
}: {
  message: string
  onDismiss: () => void
}) {
  if (!message) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute bottom-24 right-4 z-40 flex max-w-sm items-center gap-2 rounded-lg border border-border bg-popover/80 px-3 py-2 text-sm text-popover-foreground shadow-xl backdrop-blur-xl"
    >
      <span className="min-w-0 flex-1">{message}</span>
      <Button size="icon-xs" variant="ghost" onClick={onDismiss} aria-label="Dismiss status">
        <X data-icon="inline-start" />
      </Button>
    </div>
  )
}

function EmptyWall({ onAddFiles, onAddFolder }: { onAddFiles: () => void; onAddFolder: () => void }) {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-lg border border-dashed border-border bg-card/50 p-8 text-center">
        <Image
          src={`${PUBLIC_BASE_PATH}/video-wall-logo.png`}
          alt=""
          width={48}
          height={48}
          className="size-12 rounded-lg"
          draggable={false}
        />
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

async function hydrateCatalogDetails(catalog: CatalogVideo[]) {
  return mapWithConcurrency(
    catalog,
    METADATA_CONCURRENCY,
    async (item) => {
      if (item.duration && hasKnownAspect(item)) return item
      const details = await readVideoDetails(item).catch(() => undefined)
      if (details) persistVideoDetails(item, details)
      return details ? { ...item, ...details } : item
    }
  )
}

function mergeHydratedCatalog(current: CatalogVideo[], hydrated: CatalogVideo[]) {
  const hydratedById = new Map(hydrated.map((item) => [item.id, item]))
  return current.map((item) => hydratedById.get(item.id) ?? item)
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

function intersects(a: DOMRect, b: DOMRect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function timestamp() {
  return new Date().getTime()
}
