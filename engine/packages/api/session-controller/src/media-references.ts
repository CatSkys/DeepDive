/**
 * Authenticated GET/HEAD /api/file reads bounded file responses through
 * the composed filesystem provider. Paths and MIME types do not restrict access;
 * the connection service authenticates requests before this handler.
 * @module @deepseek-ai/dsh-api-session-controller/media-references
 */

import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-attachment'
import { FsError, type FileSystem } from '@deepseek-ai/dsh-fs'
import mime from 'mime-types'

const BASE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  // HTML and SVG files may be opened directly on the authenticated API origin.
  'Content-Security-Policy': "sandbox; default-src 'none'",
}

// DeepDive deviation from upstream: media files get their own byte cap and
// Range support so sandboxed widget iframes can play workspace video/audio
// (players probe with Range requests; the image cap is far too small for
// media). Upstream applies the image limit to every MIME and ignores ranges.
const MAX_MEDIA_BYTES = 512 * 1024 * 1024

function isMedia(mediaType: string): boolean {
  return mediaType.startsWith('video/') || mediaType.startsWith('audio/')
}

/**
 * Single-range parser per RFC 7233. Returns undefined for malformed or
 * multi-range values (callers ignore the header then, per RFC); returns
 * `{ start, end }` resolved against `size` (suffix ranges included); returns
 * null when the range is syntactically valid but starts past the file.
 */
function parseRange(value: string | null, size: number): { start: number; end: number } | null | undefined {
  if (value === null) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (match === null) return undefined
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return undefined
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (suffix === 0) return null
    const start = Math.max(0, size - suffix)
    return start >= size ? null : { start, end: size - 1 }
  }
  const start = Number(rawStart)
  if (start >= size) return null
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  return start > end ? null : { start, end }
}

async function serveFile(request: Request, fs: FileSystem, maxBytes: number): Promise<Response> {
  const fail = (status: number, text: string, extra?: Record<string, string>): Response =>
    new Response(request.method === 'HEAD' ? null : text, { status, headers: { ...BASE_HEADERS, ...extra } })
  const path = new URL(request.url).searchParams.get('path')
  if (path === null || path.length === 0) return fail(400, 'missing path')
  if (path.includes('\0') || !isAbsolute(path)) return fail(400, 'absolute path required')
  try {
    const target = await fs.resolve(path, { signal: request.signal })
    const mediaType = mime.lookup(target.displayPath) || 'application/octet-stream'
    const media = isMedia(mediaType)
    const cap = media ? MAX_MEDIA_BYTES : maxBytes
    const headers: Record<string, string> = {
      ...BASE_HEADERS,
      'Content-Type': mediaType,
      ...(media ? { 'Accept-Ranges': 'bytes' } : {}),
    }
    if (request.method === 'HEAD') {
      const info = await fs.stat(target, request.signal)
      if (info === undefined) return fail(404, 'not found')
      if (info.type !== 'file') return fail(403, 'not a regular file')
      if (info.size !== undefined) {
        if (info.size > cap) return fail(413, 'file exceeds byte limit')
        headers['Content-Length'] = String(info.size)
      }
      return new Response(null, { headers })
    }
    // Media range path: stat first for the range bounds and the early 413;
    // remote providers without a reported size fall back to the full body.
    if (media) {
      const info = await fs.stat(target, request.signal)
      if (info === undefined) return fail(404, 'not found')
      if (info.type !== 'file') return fail(403, 'not a regular file')
      if (info.size !== undefined) {
        if (info.size > cap) return fail(413, 'file exceeds byte limit')
        const range = parseRange(request.headers.get('range'), info.size)
        if (range === null) {
          return fail(416, 'range not satisfiable', { 'Content-Range': `bytes */${info.size}` })
        }
        if (range !== undefined) {
          const bytes = await fs.readByteRange(target, { offset: range.start, length: range.end - range.start + 1 }, request.signal)
          return new Response(bytes.slice(), {
            headers: {
              ...headers,
              'Content-Range': `bytes ${range.start}-${range.end}/${info.size}`,
              'Content-Length': String(bytes.byteLength),
            },
            status: 206,
          })
        }
      }
    }
    const bytes = await fs.readBytes(target, request.signal, cap)
    headers['Content-Length'] = String(bytes.byteLength)
    return new Response(bytes.slice(), { headers })
  } catch (error: unknown) {
    if (!(error instanceof FsError)) throw error
    const statuses: Partial<Record<FsError['code'], number>> = {
      FS_NOT_FOUND: 404,
      FS_NOT_REGULAR_FILE: 403,
      FS_PERMISSION_DENIED: 403,
      FS_SANDBOX_DENIED: 403,
      FS_TOO_LARGE: 413,
      FS_ABORTED: 499,
    }
    return fail(statuses[error.code] ?? 500, error.code)
  }
}

/**
 * File-display contribution. The connection service supplies authentication;
 * `ctx.fs` supplies the execution world's paths, reads, and access policy.
 */
export const SessionMediaReferences = {
  inject: ['connection', 'fs', 'attachments'],
  apply(ctx: Context): void {
    const maxBytes = ctx.attachments.imageLimits.maxImageBytes
    ctx.effect(() => ctx.connection.fetch.register({
      path: '/api/file',
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: request => serveFile(request, ctx.fs, maxBytes),
    }), 'session-controller: /api/file')
  },
}
