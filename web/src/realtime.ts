import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { api } from './api'
import type { AppDispatch, RootState } from './store'

/** Opens the chat socket while signed in; reconnects with backoff and refetches on each push. */
export function useRealtime() {
  const token = useSelector((s: RootState) => s.auth.token)
  const dispatch = useDispatch<AppDispatch>()
  useEffect(() => {
    if (!token) return
    let ws: WebSocket | null = null
    let closed = false
    let delay = 1000
    let timer: ReturnType<typeof setTimeout>
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/v0/ws?token=${encodeURIComponent(token)}`)
      ws.onopen = () => { delay = 1000 }
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data)
          if (m.type === 'message') dispatch(api.util.invalidateTags([{ type: 'Messages', id: m.connectionId }]))
          // A woman received a request.
          else if (m.type === 'request') dispatch(api.util.invalidateTags(['Requests']))
          // A man's request was answered; an accepted one also opens a chat.
          else if (m.type === 'request_update') dispatch(api.util.invalidateTags(['SentRequests', 'Connections']))
        } catch { /* ignore malformed frame */ }
      }
      ws.onclose = (e) => {
        if (closed || e.code === 4401) return
        timer = setTimeout(connect, delay)
        delay = Math.min(delay * 2, 30000)
      }
    }
    connect()
    return () => { closed = true; clearTimeout(timer); ws?.close() }
  }, [token, dispatch])
}
