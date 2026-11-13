import { useEffect, useMemo, useRef, useState } from 'react'
import type { Board, Level } from '../../packages/domain/model.ts'
import { validate } from '../../packages/domain/validate.ts'
import type { Report } from '../../packages/domain/validate.ts'
import type { Request, Response } from '../workers/validation.ts'

export function useReport(level: Level, board: Board, draft: Board | null) {
  const worker = useRef<Worker | null>(null)
  const revision = useRef(0)
  const [preview, setPreview] = useState<{ level: Level; draft: Board; report: Report }>()
  const committed = useMemo(() => validate(level, board), [level, board])

  useEffect(() => {
    try {
      worker.current = new Worker(new URL('../workers/validation.ts', import.meta.url), { type: 'module' })
    } catch { worker.current = null }
    return () => { worker.current?.terminate(); worker.current = null }
  }, [])

  useEffect(() => {
    if (!draft) return
    const id = ++revision.current
    const instance = worker.current
    const fallback = () => setPreview({ level, draft, report: validate(level, draft) })
    if (!instance) { fallback(); return }
    instance.onmessage = (event: MessageEvent<Response>) => {
      if (event.data.revision === id) setPreview({ level, draft, report: event.data.report })
    }
    instance.onerror = () => {
      instance.terminate()
      worker.current = null
      fallback()
    }
    instance.postMessage({ revision: id, level, board: draft } satisfies Request)
    return () => { instance.onmessage = null; instance.onerror = null }
  }, [level, draft])

  return { committed, visible: draft && preview?.level === level && preview.draft === draft ? preview.report : committed }
}
