import type { Board, Level } from '../../packages/domain/model.ts'
import { validate } from '../../packages/domain/validate.ts'
import type { Report } from '../../packages/domain/validate.ts'

export interface Request { revision: number; level: Level; board: Board }
export interface Response { revision: number; report: Report }

self.onmessage = (event: MessageEvent<Request>) => {
  const { revision, level, board } = event.data
  self.postMessage({ revision, report: validate(level, board) } satisfies Response)
}
