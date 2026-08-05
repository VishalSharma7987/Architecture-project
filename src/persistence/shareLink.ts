import { parseDesign, type DesignDocument, type ParseResult } from './schema'

/**
 * Share links carry the whole design in the URL fragment.
 *
 * The fragment is used deliberately: it is never sent to a server, so a shared
 * design stays between the two people who have the link. The payload is gzipped
 * before base64 — a modest plan is ~2 KB of JSON, which base64s to ~2.7 KB and
 * starts to strain what browsers and chat clients will carry intact. Gzip
 * typically cuts that by 4-5x because the JSON is so repetitive.
 */

const PREFIX = '#design='

/** base64url — the standard alphabet's `+/=` are unsafe in a URL. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

const canCompress = () => typeof CompressionStream !== 'undefined'

/**
 * Encodes a design into a shareable absolute URL.
 *
 * The payload is tagged `g` (gzipped) or `r` (raw) so a link made in a browser
 * with CompressionStream still opens in one without it.
 */
export async function createShareLink(doc: DesignDocument): Promise<string> {
  const json = JSON.stringify(doc)
  const payload = canCompress()
    ? 'g' + toBase64Url(await gzip(json))
    : 'r' + toBase64Url(new TextEncoder().encode(json))

  const base = `${window.location.origin}${window.location.pathname}`
  return `${base}${PREFIX}${payload}`
}

/** The encoded design in the current URL, or null if there isn't one. */
export function readShareFragment(hash: string = window.location.hash): string | null {
  return hash.startsWith(PREFIX) ? hash.slice(PREFIX.length) : null
}

/** Decodes and validates a share payload. Untrusted — anyone can craft a link. */
export async function decodeShareLink(payload: string): Promise<ParseResult> {
  try {
    const tag = payload[0]
    const body = payload.slice(1)

    let json: string
    if (tag === 'g') {
      if (!canCompress()) {
        return { ok: false, error: 'This browser cannot open compressed share links.' }
      }
      json = await gunzip(fromBase64Url(body))
    } else if (tag === 'r') {
      json = new TextDecoder().decode(fromBase64Url(body))
    } else {
      return { ok: false, error: 'That link is not a Space Designer share link.' }
    }

    return parseDesign(JSON.parse(json))
  } catch {
    return { ok: false, error: 'That share link is damaged or incomplete.' }
  }
}

/** Removes the design fragment without reloading — used by "Edit a copy". */
export function clearShareFragment(): void {
  window.history.replaceState(
    null,
    '',
    `${window.location.origin}${window.location.pathname}`,
  )
}
