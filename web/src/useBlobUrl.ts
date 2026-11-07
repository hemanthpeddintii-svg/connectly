import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import type { RootState } from './store'

/** Media endpoints need the bearer header, so fetch as a blob instead of using a bare <img src>. */
export function useBlobUrl(path: string) {
  const token = useSelector((s: RootState) => s.auth.token)
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const ctl = new AbortController()
    let obj: string | null = null
    fetch(`/v0${path}`, { headers: { authorization: `Bearer ${token}` }, signal: ctl.signal })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob() })
      .then((b) => { obj = URL.createObjectURL(b); setUrl(obj) })
      .catch(() => { if (!ctl.signal.aborted) setFailed(true) })
    return () => { ctl.abort(); if (obj) URL.revokeObjectURL(obj) }
  }, [path, token])
  return { url, failed }
}
