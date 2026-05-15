"use client"

import {
  ChevronLeft,
  ChevronRight,
  CircleOff,
  FolderOpen,
  Plus,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { formatDuration, formatFileSize } from "@/lib/media"
import type { CatalogVideo, SortMode } from "@/lib/video-types"
import { cn } from "@/lib/utils"

export function CatalogSidebar({
  open,
  catalog,
  activeIds,
  sortMode,
  selectedCount,
  wallCount,
  catalogCount,
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
  selectedCount: number
  wallCount: number
  catalogCount: number
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
          <div className="px-3 pb-3 text-center text-xs text-muted-foreground">
            {wallCount} on wall · {catalogCount} in catalog · {selectedCount} selected
          </div>
          <Separator />
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-1 p-2">
              {catalog.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="flex min-h-16 w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-sidebar-accent disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={item.unsupported}
                  title={item.error}
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
                  {item.unsupported ? <Badge variant="destructive">error</Badge> : null}
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
