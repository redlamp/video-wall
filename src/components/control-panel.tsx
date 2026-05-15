"use client"

import {
  PointerEvent as ReactPointerEvent,
  ReactElement,
  ReactNode,
  forwardRef,
  useState,
} from "react"
import {
  ArrowRightFromLine,
  ArrowRightLeft,
  Check,
  Crop,
  Dice5,
  FastForward,
  Maximize2,
  Minus,
  Moon,
  PaintBucket,
  Pause,
  Pin,
  PinOff,
  Play,
  Plus,
  Ratio,
  RectangleHorizontal,
  RectangleVertical,
  Rows3,
  Shuffle,
  SkipBack,
  SkipForward,
  Sun,
  View,
  Volume2,
  VolumeX,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { CropMode } from "@/lib/video-types"
import type { AspectFilter } from "@/lib/wall-layout"
import { cn } from "@/lib/utils"

export type ScrollMode = "all" | "row"
export type ThemeMode = "dark" | "light"
export type PanelPosition = {
  left: number
  top: number
}

export const ControlPanel = forwardRef<HTMLDivElement, ControlPanelProps>(function ControlPanel(
  {
    panelPinned,
    panelPosition,
    rows,
    playbackRate,
    masterVolume,
    muted,
    cropMode,
    aspectFilter,
    isPlaying,
    shuffleOn,
    scrollMode,
    themeMode,
    onMouseEnter,
    onMouseLeave,
    onPanelPointerDown,
    onPanelPointerMove,
    onPanelPointerUp,
    onPanelPointerCancel,
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
    onThemeModeChange,
  },
  ref
) {
  const [openDropdown, setOpenDropdown] = useState<"aspect" | "crop" | null>(null)
  const AspectIcon =
    aspectFilter === "landscape"
      ? RectangleHorizontal
      : aspectFilter === "portrait"
        ? RectangleVertical
        : Ratio
  const CropIcon = cropMode === "fill" ? Maximize2 : cropMode === "fit" ? Crop : View
  const menuSide =
    !panelPosition ||
    (typeof window !== "undefined" && panelPosition.top > window.innerHeight / 2)
      ? "top"
      : "bottom"

  return (
    <div
      ref={ref}
      data-testid="control-panel"
      className={cn(
        "absolute z-30 w-fit max-w-[calc(100vw-1.5rem)] cursor-move rounded-lg border border-white/10 bg-popover/65 p-2 text-popover-foreground shadow-2xl backdrop-blur-xl",
        panelPosition ? "" : "bottom-2 left-1/2 -translate-x-1/2"
      )}
      style={panelPosition ? { left: panelPosition.left, top: panelPosition.top } : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={onPanelPointerDown}
      onPointerMove={onPanelPointerMove}
      onPointerUp={onPanelPointerUp}
      onPointerCancel={onPanelPointerCancel}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-nowrap items-center gap-2 pr-20">
          <TooltipButton label="Fill gaps in wall">
            <Button size="sm" variant="secondary" onClick={onFill}>
              <PaintBucket data-icon="inline-start" />
              Fill wall
            </Button>
          </TooltipButton>
          <TooltipButton label="Refresh with random videos">
            <Button size="sm" variant="secondary" onClick={onShuffle}>
              <Dice5 data-icon="inline-start" />
              Random
            </Button>
          </TooltipButton>
          <TooltipButton label="Shuffle video selection">
            <Button
              size="sm"
              variant={shuffleOn ? "default" : "outline"}
              onClick={() => onShuffleOnChange(!shuffleOn)}
            >
              <Shuffle data-icon="inline-start" />
              Shuffle
            </Button>
          </TooltipButton>
          <TooltipButton label="Scroll rows together or separately">
            <Button
              size="sm"
              variant={scrollMode === "row" ? "default" : "outline"}
              onClick={() => onScrollModeChange(scrollMode === "row" ? "all" : "row")}
            >
              {scrollMode === "row" ? (
                <ArrowRightLeft data-icon="inline-start" />
              ) : (
                <ArrowRightFromLine data-icon="inline-start" />
              )}
              {scrollMode === "row" ? "Scroll Row" : "Scroll All"}
            </Button>
          </TooltipButton>

          <IconMenu
            label="Aspect ratio filter"
            tooltip="Filter by aspect ratio"
            icon={<AspectIcon data-icon="inline-start" />}
            side={menuSide}
            open={openDropdown === "aspect"}
            onOpenChange={(open) => setOpenDropdown(open ? "aspect" : null)}
            items={[
              {
                label: "Mixed",
                icon: <Ratio data-icon="inline-start" />,
                selected: aspectFilter === "mixed",
                onSelect: () => onAspectFilterChange("mixed"),
              },
              {
                label: "Landscape",
                icon: <RectangleHorizontal data-icon="inline-start" />,
                selected: aspectFilter === "landscape",
                onSelect: () => onAspectFilterChange("landscape"),
              },
              {
                label: "Portrait",
                icon: <RectangleVertical data-icon="inline-start" />,
                selected: aspectFilter === "portrait",
                onSelect: () => onAspectFilterChange("portrait"),
              },
            ]}
          />

          <IconMenu
            label="Crop mode"
            tooltip="Video framing"
            icon={<CropIcon data-icon="inline-start" />}
            side={menuSide}
            open={openDropdown === "crop"}
            onOpenChange={(open) => setOpenDropdown(open ? "crop" : null)}
            items={[
              {
                label: "Detected",
                icon: <View data-icon="inline-start" />,
                selected: cropMode === "detected",
                onSelect: () => onCropModeChange("detected"),
              },
              {
                label: "Fill",
                icon: <Maximize2 data-icon="inline-start" />,
                selected: cropMode === "fill",
                onSelect: () => onCropModeChange("fill"),
              },
              {
                label: "Fit",
                icon: <Crop data-icon="inline-start" />,
                selected: cropMode === "fit",
                onSelect: () => onCropModeChange("fit"),
              },
            ]}
          />
        </div>

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
        </div>
      </div>
      <Button
        className="absolute right-11 top-2"
        size="icon-sm"
        variant="ghost"
        onClick={() => onThemeModeChange(themeMode === "dark" ? "light" : "dark")}
        aria-label={themeMode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      >
        {themeMode === "dark" ? <Sun data-icon="inline-start" /> : <Moon data-icon="inline-start" />}
      </Button>
      <Button
        className="absolute right-2 top-2"
        size="icon-sm"
        variant={panelPinned ? "default" : "ghost"}
        onClick={onTogglePin}
        aria-label="Pin control panel"
      >
        {panelPinned ? <PinOff data-icon="inline-start" /> : <Pin data-icon="inline-start" />}
      </Button>
    </div>
  )
})

type ControlPanelProps = {
  panelPinned: boolean
  panelPosition: PanelPosition | null
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
  themeMode: ThemeMode
  onMouseEnter: () => void
  onMouseLeave: () => void
  onPanelPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPanelPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPanelPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPanelPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void
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
  onThemeModeChange: (value: ThemeMode) => void
}

function IconMenu({
  label,
  tooltip,
  icon,
  side = "bottom",
  open,
  onOpenChange,
  items,
}: {
  label: string
  tooltip: string
  icon: ReactNode
  side?: "top" | "bottom"
  open: boolean
  onOpenChange: (open: boolean) => void
  items: Array<{
    label: string
    icon: ReactNode
    selected: boolean
    onSelect: () => void
  }>
}) {
  return (
    <div className="relative" data-panel-interactive>
      <TooltipButton label={tooltip}>
        <Button
          size="sm"
          variant="outline"
          className="w-14 px-2"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
        >
          {icon}
        </Button>
      </TooltipButton>
      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute right-0 z-[70] min-w-36 rounded-lg border border-border bg-popover p-1 text-sm text-popover-foreground shadow-xl",
            side === "top" ? "bottom-[calc(100%+0.25rem)]" : "top-[calc(100%+0.25rem)]"
          )}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitemradio"
              aria-checked={item.selected}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-accent hover:text-accent-foreground",
                item.selected && "bg-accent text-accent-foreground"
              )}
              onClick={() => {
                item.onSelect()
                onOpenChange(false)
              }}
            >
              {item.icon}
              <span className="flex-1 whitespace-nowrap">{item.label}</span>
              {item.selected ? <Check data-icon="inline-start" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
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
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="flex size-6 cursor-default items-center justify-center rounded text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={label}
            >
              {icon}
            </button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
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

function TooltipButton({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={children as ReactElement} />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
