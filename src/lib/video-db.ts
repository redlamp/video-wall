"use client"

import { openDB, type DBSchema } from "idb"

import type { SessionSnapshot, VideoMeta } from "@/lib/video-types"

interface VideoWallDb extends DBSchema {
  metadata: {
    key: string
    value: VideoMeta
  }
  sessions: {
    key: string
    value: SessionSnapshot
  }
}

const DB_NAME = "video-wall"
const DB_VERSION = 1

function getDb() {
  return openDB<VideoWallDb>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("metadata")) {
        db.createObjectStore("metadata", { keyPath: "key" })
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions")
      }
    },
  })
}

export async function getVideoMeta(key: string) {
  const db = await getDb()
  return db.get("metadata", key)
}

export async function saveVideoMeta(meta: VideoMeta) {
  const db = await getDb()
  await db.put("metadata", meta)
}

export async function saveLastSession(snapshot: SessionSnapshot) {
  const db = await getDb()
  await db.put("sessions", snapshot, "last")
}

export async function getLastSession() {
  const db = await getDb()
  return db.get("sessions", "last")
}
