import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod/mini'
import { boardSchema, levelSchema } from '../packages/domain/schema.ts'
import { contract, errorSchema } from '../server/contract.ts'

function json(schema: z.ZodMiniType) {
  const { $schema: dialect, ...rest } = z.toJSONSchema(schema)
  void dialect
  return rest
}
const shared = [
  [JSON.stringify(json(boardSchema)), './board.schema.json'],
  [JSON.stringify(json(levelSchema)), './level.schema.json'],
] as const
function references(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(references)
  if (!value || typeof value !== 'object') return value
  const match = shared.find(([signature]) => signature === JSON.stringify(value))
  if (match) return { $ref: match[1] }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, references(item)]))
}
const content = (schema: z.ZodMiniType) => ({ 'application/json': { schema: references(json(schema)) } })

const paths: Record<string, Record<string, unknown>> = {}
for (const [key, route] of Object.entries(contract)) {
  const [method, path] = key.split(' ')
  paths[path] ??= {}
  paths[path][method.toLowerCase()] = {
    summary: route.label,
    ...('private' in route ? { security: [{ session: [] }] } : {}),
    ...('cron' in route ? { security: [{ cron: [] }] } : {}),
    ...('query' in route ? { parameters: Object.entries(route.query).map(([name, schema]) =>
      ({ in: 'query', name, required: false, schema: json(schema) })) } : {}),
    ...('input' in route ? { requestBody: { required: true, content: content(route.input) } } : {}),
    responses: {
      ['status' in route ? route.status : 200]: { description: '成功', content: content(route.response) },
      default: { description: '请求失败，code 标识原因', content: content(errorSchema) },
    },
  }
}

const files = {
  'docs/openapi.json': {
    openapi: '3.1.0', info: { title: '间取手帖 API', version: '1.0.0' }, paths,
    components: { securitySchemes: {
      session: { type: 'apiKey', in: 'cookie', name: 'madori_session' },
      cron: { type: 'http', scheme: 'bearer' },
    } },
  },
  'docs/board.schema.json': z.toJSONSchema(boardSchema),
  'docs/level.schema.json': z.toJSONSchema(levelSchema),
}

await mkdir('docs', { recursive: true })
for (const [name, data] of Object.entries(files)) {
  const text = JSON.stringify(data, null, 2) + '\n'
  if (process.argv.includes('--check')) {
    if (await readFile(name, 'utf8') !== text) throw new Error(`${name} 与运行时契约不同步。`)
  } else await writeFile(name, text)
}
