import type { CatalogVideo, CropMode, WallVideo } from "@/lib/video-types"

export type PackedWallItem = {
  wallItem: WallVideo
  video: CatalogVideo
  videos: CatalogVideo[]
  width: number
  aspect: number
}

export type PackedRow = {
  items: PackedWallItem[]
  width: number
  offset: number
}

export type ReplaceDirection = "next" | "previous"
export type InsertPosition = "before" | "after"
export type AspectFilter = "mixed" | "landscape" | "portrait"

export function getEffectiveAspectRatio(video: CatalogVideo, cropMode: CropMode) {
  const naturalAspect = video.width && video.height ? video.width / video.height : 16 / 9
  if (cropMode === "detected" && video.crop && hasMeaningfulCrop(video.crop)) {
    return Math.max(0.25, Math.min(4, naturalAspect * (video.crop.width / video.crop.height)))
  }
  return Math.max(0.25, Math.min(4, naturalAspect))
}

export function hasKnownAspect(video: CatalogVideo) {
  return Boolean(video.width && video.height)
}

export function filterCatalogByAspect(
  catalog: CatalogVideo[],
  aspectFilter: AspectFilter,
  cropMode: CropMode
) {
  if (aspectFilter === "mixed") return catalog
  return catalog.filter((video) => {
    if (!hasKnownAspect(video)) return false
    const aspect = getEffectiveAspectRatio(video, cropMode)
    return aspectFilter === "landscape" ? aspect >= 1 : aspect < 1
  })
}

export function packRows(
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

export function buildWallToFillRows({
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
      nextWall.push(createWallItem(item.id))
    }
    return nextWall
  }

  while (
    candidates.length > 0 &&
    !wallRowsAreFilled(nextWall, catalogById, rows, rowHeight, containerWidth, cropMode)
  ) {
    const item = candidates.shift()
    if (!item) break
    nextWall.push(createWallItem(item.id))
  }

  return nextWall
}

export function replaceWallVideo({
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
    ...extraCandidates.map((item) => createWallItem(item.id)),
  ]

  return {
    wall: wall.flatMap((item) => (item.wallId === wallId ? replacementItems : [item])),
    nextShownIds: candidates.map((item) => item.id),
  }
}

export function updateShownSet(current: Set<string>, nextId: string, catalogLength: number) {
  const next = new Set(current)
  if (next.size >= catalogLength) next.clear()
  next.add(nextId)
  return next
}

export function reorderWall(
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

export function getRowHeight(containerHeight: number, rows: number) {
  const safeRows = Math.max(1, rows)
  const totalGap = (safeRows - 1) * 6
  if (containerHeight <= totalGap) return 120
  return Math.max(48, (containerHeight - totalGap) / safeRows)
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

function createWallItem(catalogId: string): WallVideo {
  return {
    wallId: crypto.randomUUID(),
    catalogId,
    pinned: false,
    history: [catalogId],
    historyIndex: 0,
  }
}

export function getWallCatalogIds(wallItem: WallVideo) {
  return wallItem.catalogIds?.length ? wallItem.catalogIds : [wallItem.catalogId]
}

function shortestRowIndex(rows: PackedRow[]) {
  let shortest = 0
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].width < rows[shortest].width) shortest = index
  }
  return shortest
}

function hasMeaningfulCrop(crop: { width: number; height: number }) {
  return crop.width < 0.97 || crop.height < 0.97
}

function shuffle<T>(items: T[]) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
