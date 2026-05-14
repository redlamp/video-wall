export type SortMode = "name" | "date" | "duration"
export type CropMode = "fit" | "fill" | "detected"

export type CropRect = {
  x: number
  y: number
  width: number
  height: number
}

export type VideoMeta = {
  key: string
  name: string
  duration?: number
  width?: number
  height?: number
  modified?: number
  crop?: CropRect
  cropConfidence?: number
  lastOpenedAt: number
}

export type CatalogVideo = {
  id: string
  key: string
  name: string
  file: File
  url: string
  modified: number
  size: number
  duration?: number
  width?: number
  height?: number
  crop?: CropRect
  cropConfidence?: number
  unsupported?: boolean
}

export type WallVideo = {
  wallId: string
  catalogId: string
  catalogIds?: string[]
  pinned: boolean
  history?: string[]
  historyIndex?: number
}

export type SessionSnapshot = {
  catalogIds: string[]
  wall: WallVideo[]
  rows: number
  sortMode: SortMode
  playbackRate: number
  masterVolume: number
  cropMode: CropMode
  shuffleOn?: boolean
  savedAt: number
}
