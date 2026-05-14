import type { CatalogVideo } from "@/lib/video-types"

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "m4v", "mkv", "avi"])

export function isVideoFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase()
  return Boolean(extension && VIDEO_EXTENSIONS.has(extension))
}

export function videoKey(file: File) {
  const relativePath = getRelativePath(file)
  return `${relativePath || file.name}:${file.size}:${file.lastModified}`
}

export function getRelativePath(file: File) {
  return (
    (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
    file.name
  )
}

export function createCatalogVideo(file: File): CatalogVideo {
  const key = videoKey(file)
  return {
    id: crypto.randomUUID(),
    key,
    name: getRelativePath(file),
    file,
    url: URL.createObjectURL(file),
    modified: file.lastModified,
    size: file.size,
  }
}

export async function filesFromDataTransfer(dataTransfer: DataTransfer) {
  const items = Array.from(dataTransfer.items)
  const files: File[] = []

  const entries = items
    .map((item) => {
      const entryGetter = (
        item as DataTransferItem & {
          webkitGetAsEntry?: () => FileSystemEntry | null
        }
      ).webkitGetAsEntry
      return entryGetter?.call(item) ?? null
    })
    .filter(Boolean) as FileSystemEntry[]

  if (entries.length > 0) {
    for (const entry of entries) {
      files.push(...(await readEntryFiles(entry)))
    }
  } else {
    files.push(...Array.from(dataTransfer.files))
  }

  return files.filter(isVideoFile)
}

async function readEntryFiles(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry
    return new Promise((resolve) => fileEntry.file((file) => resolve([file])))
  }

  if (entry.isDirectory) {
    const directory = entry as FileSystemDirectoryEntry
    const reader = directory.createReader()
    const entries = await readAllDirectoryEntries(reader)
    const nested = await Promise.all(entries.map(readEntryFiles))
    return nested.flat()
  }

  return []
}

async function readAllDirectoryEntries(reader: FileSystemDirectoryReader) {
  const entries: FileSystemEntry[] = []

  while (true) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject)
    })
    if (batch.length === 0) break
    entries.push(...batch)
  }

  return entries
}

export function formatDuration(duration?: number) {
  if (!duration || !Number.isFinite(duration)) return "--:--"
  const totalSeconds = Math.round(duration)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}`
}

export function formatFileSize(size: number) {
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}
