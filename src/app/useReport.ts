import { useEffect, useRef, useState } from 'react'
import type { Board, Level } from '../../packages/domain/model.ts'
import { validate } from '../../packages/domain/validate.ts'
import type { Report } from '../../packages/domain/validate.ts'
import type { Request, Response } from '../workers/validation.ts'

export function useReport(level: Level, board: Board) {
  const worker = useRef<Worker | null>(null)
  const revision = useRef(0)
  const [report, setReport] = useState<Report>(() => validate(level, board))

  useEffect(() => {
    try {
      worker.current = new Worker(new URL('../workers/validation.ts', import.meta.url), { type: 'module' })
    } catch { worker.current = null }
    return () => { worker.current?.terminate(); worker.current = null }
  }, [])

  useEffect(() => {
    const id = ++revision.current
    const instance = worker.current
    if (!instance) { setReport(validate(level, board)); return }
    instance.onmessage = (event: MessageEvent<Response>) => {
      if (event.data.revision === id) setReport(event.data.report)
    }
    instance.onerror = () => {
      instance.terminate()
      worker.current = null
      setReport(validate(level, board))
    }
    instance.postMessage({ revision: id, level, board } satisfies Request)
    return () => { instance.onmessage = null; instance.onerror = null }
  }, [level, board])

  return report
}
