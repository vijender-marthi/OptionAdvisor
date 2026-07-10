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
const schemas = schema.components && typeof schema.components === 'object' && schema.components.schemas && typeof schema.components.schemas === 'object'
  ? schema.components.schemas
  : {}
const allowedMethods = new Set(['get', 'post', 'put', 'patch', 'delete'])

function tsString(value) {
  return JSON.stringify(String(value))
}

function operationIdFor(method, path, operation) {
  const raw = operation && typeof operation.operationId === 'string' ? operation.operationId.trim() : ''
  if (raw) return raw
  return `${method}_${path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`
}

function schemaNameFromRef(ref) {
  const prefix = '#/components/schemas/'
  if (typeof ref !== 'string' || !ref.startsWith(prefix)) return 'unknown'
  return ref.slice(prefix.length)
}

function literalUnion(values) {
  return values.map(value => JSON.stringify(value)).join(' | ') || 'never'
}

function parenthesize(typeText) {
  return typeText.includes(' | ') ? `(${typeText})` : typeText
}

function schemaToType(value) {
  if (!value || typeof value !== 'object') return 'unknown'

  if (typeof value.$ref === 'string') {
    return `ApiSchemas[${JSON.stringify(schemaNameFromRef(value.$ref))}]`
  }

  if (Array.isArray(value.enum)) {
    return literalUnion(value.enum)
  }

  if (Array.isArray(value.const)) {
    return literalUnion(value.const)
  }

  if (Object.prototype.hasOwnProperty.call(value, 'const')) {
    return JSON.stringify(value.const)
  }

  const unionSchemas = Array.isArray(value.anyOf) ? value.anyOf : Array.isArray(value.oneOf) ? value.oneOf : null
  if (unionSchemas) {
    const unionTypes = [...new Set(unionSchemas.map(schemaToType))]
    return unionTypes.join(' | ') || 'unknown'
  }

  if (Array.isArray(value.allOf) && value.allOf.length) {
    const allTypes = [...new Set(value.allOf.map(schemaToType))]
    return allTypes.map(parenthesize).join(' & ') || 'unknown'
  }

  const rawType = value.type
  const typeList = Array.isArray(rawType) ? rawType : rawType ? [rawType] : []
  if (typeList.length > 1) {
    const nonNullTypes = typeList.filter(type => type !== 'null').map(type => schemaToType({ ...value, type }))
    const unionTypes = [...new Set([...nonNullTypes, ...(typeList.includes('null') ? ['null'] : [])])]
    return unionTypes.join(' | ') || 'unknown'
  }

  const type = typeList[0]
  if (type === 'null') return 'null'
  if (type === 'string') return 'string'
  if (type === 'number' || type === 'integer') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'array') {
    return `Array<${schemaToType(value.items)}>`
  }

  const properties = value.properties && typeof value.properties === 'object' ? value.properties : null
  if (type === 'object' || properties || value.additionalProperties) {
    if (properties) {
      const required = new Set(Array.isArray(value.required) ? value.required : [])
      const entries = Object.keys(properties).sort().map(propertyName => {
        const optional = required.has(propertyName) ? '' : '?'
        return `    readonly ${JSON.stringify(propertyName)}${optional}: ${schemaToType(properties[propertyName])}`
      })

      if (value.additionalProperties && value.additionalProperties !== false) {
        const additionalType = value.additionalProperties === true ? 'unknown' : schemaToType(value.additionalProperties)
        entries.push(`    readonly [key: string]: ${additionalType}`)
      }

      return `{\n${entries.join('\n')}\n  }`
    }

    if (value.additionalProperties && value.additionalProperties !== false) {
      const additionalType = value.additionalProperties === true ? 'unknown' : schemaToType(value.additionalProperties)
      return `Record<string, ${additionalType}>`
    }

    return 'Record<string, unknown>'
  }

  return 'unknown'
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
const schemaNames = Object.keys(schemas).sort()
const apiSchemas = schemaNames.map(name => `  readonly ${JSON.stringify(name)}: ${schemaToType(schemas[name])}`).join('\n')

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

export type ApiSchemaName = ${schemaNames.map(tsString).join(' | ') || 'never'}

export type ApiSchemas = {
${apiSchemas || '  readonly [key: string]: never'}
}

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
