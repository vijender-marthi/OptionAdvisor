import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(scriptDir, '..')
const repoRoot = resolve(frontendRoot, '..')
const schemaPath = resolve(frontendRoot, 'src/api/generated/openapi.json')
const outputPath = resolve(frontendRoot, 'src/api/generated/openapi-types.ts')

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
const paths = schema.paths && typeof schema.paths === 'object' ? schema.paths : {}
const allowedMethods = new Set(['get', 'post', 'put', 'patch', 'delete'])

function tsString(value) {
  return JSON.stringify(String(value))
}

function operationIdFor(method, path, operation) {
  const raw = operation && typeof operation.operationId === 'string' ? operation.operationId.trim() : ''
  if (raw) return raw
  return `${method}_${path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`
}

const operations = []
for (const path of Object.keys(paths).sort()) {
  const byMethod = paths[path] || {}
  for (const method of Object.keys(byMethod).sort()) {
    if (!allowedMethods.has(method)) continue
    const operation = byMethod[method] || {}
    operations.push({
      method,
      path,
      operationId: operationIdFor(method, path, operation),
      tags: Array.isArray(operation.tags) ? operation.tags.map(String).sort() : [],
      summary: typeof operation.summary === 'string' ? operation.summary : '',
    })
  }
}

const apiPaths = [...new Set(operations.map(op => op.path))].sort()
const operationIds = [...new Set(operations.map(op => op.operationId))].sort()
const methods = [...new Set(operations.map(op => op.method))].sort()

const contents = `/* eslint-disable */
/**
 * Generated from FastAPI OpenAPI.
 *
 * Source: ${relative(repoRoot, schemaPath)}
 * Generator: ${relative(repoRoot, fileURLToPath(import.meta.url))}
 *
 * Do not edit by hand. Run \`npm --prefix frontend run generate:openapi\`.
 */

export type ApiHttpMethod = ${methods.map(tsString).join(' | ') || 'never'}

export type ApiPath = ${apiPaths.map(tsString).join(' | ') || 'never'}

export type ApiOperationId = ${operationIds.map(tsString).join(' | ') || 'never'}

export type ApiOperation = {
  readonly method: ApiHttpMethod
  readonly path: ApiPath
  readonly operationId: ApiOperationId
  readonly tags: readonly string[]
  readonly summary: string
}

export const API_OPERATIONS = ${JSON.stringify(operations, null, 2)} as const satisfies readonly ApiOperation[]

export const API_OPERATION_BY_ID = Object.fromEntries(
  API_OPERATIONS.map(operation => [operation.operationId, operation]),
) as unknown as Record<ApiOperationId, ApiOperation>

export const API_PATHS = ${JSON.stringify(apiPaths, null, 2)} as const satisfies readonly ApiPath[]
`

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, contents, 'utf8')
console.log(`Wrote ${relative(repoRoot, outputPath)}`)
