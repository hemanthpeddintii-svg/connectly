/**
 * Extension points shared by feature modules. server.ts consults these; each feature plugin
 * registers its rules at startup by pushing into the arrays. This keeps features independent.
 */
import type { SQLInputValue } from 'node:sqlite'
import type { WebSocket } from 'ws'
import type { UserRow } from '../db.ts'

export type SqlFragment = { sql: string; params: SQLInputValue[] }

/**
 * Wall visibility rules. Return a boolean SQL expression about the candidate user (table alias `u`,
 * a row of `users`) or null for no restriction. Example: `{ sql: 'u.age >= ?', params: [25] }`.
 * Use bound parameters only; never interpolate values into the SQL.
 */
export const wallFilters: Array<(viewerId: string) => SqlFragment | null> = []

/** Same contract as wallFilters, applied to the other member in the viewer's connections list (alias `u`). */
export const connectionFilters: Array<(viewerId: string) => SqlFragment | null> = []

/** Return an error code to refuse a like/skip from `fromId` on `target`, else null. */
export const actionGuards: Array<(fromId: string, target: UserRow) => string | null> = []

/** Return an error code to refuse a message (text or attachment) from `sender` to member `otherId`, else null. */
export const messageGuards: Array<(sender: UserRow, otherId: string) => string | null> = []

/** Called after a message is stored and delivered. Must not throw; errors are swallowed. */
export type MessageEvent = { connectionId: string; senderId: string; recipientId: string; preview: string }
export const messageListeners: Array<(e: MessageEvent) => void> = []

/** Live WebSocket connections by user id. */
export const sockets = new Map<string, Set<WebSocket>>()

export function pushToUser(userId: string, payload: unknown) {
  const data = JSON.stringify(payload)
  for (const ws of sockets.get(userId) ?? []) ws.send(data)
}

/** Closes a member's live sockets (used when their sessions are revoked). */
export function disconnectUser(userId: string) {
  for (const ws of sockets.get(userId) ?? []) ws.close(4401, 'session_revoked')
  sockets.delete(userId)
}

export function composeFilters(filters: Array<(viewerId: string) => SqlFragment | null>, viewerId: string): SqlFragment {
  const parts = filters.map((f) => f(viewerId)).filter((x): x is SqlFragment => x !== null)
  return { sql: parts.map((p) => ` AND (${p.sql})`).join(''), params: parts.flatMap((p) => p.params) }
}

/** Maps a guard error code to an HTTP status. */
export const errorStatus = (code: string) => (code === 'not_found' ? 404 : 403)

/**
 * The single rule for "may this member send a message to that member?": every registered messageGuard.
 * Chat is free once a request is accepted. Returns an error code or null.
 */
export function checkMessageAllowed(sender: UserRow, otherId: string): string | null {
  for (const g of messageGuards) {
    const code = g(sender, otherId)
    if (code) return code
  }
  return null
}

export function notifyMessage(e: MessageEvent) {
  for (const l of messageListeners) {
    try { l(e) } catch { /* listeners must not break delivery */ }
  }
}
