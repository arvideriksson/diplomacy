// GIFs in press, by link: a message that is nothing but a link to a GIF on a known GIF
// host renders as the animation. The message stays plain text in the database (so
// search, previews, the length cap and the RPCs are unchanged), and the image is served
// by the host's CDN — no storage or egress on our Supabase project.
//
// Only an allowlist of hosts is ever loaded: an <img> fetch tells the host the viewer's
// IP address, so an arbitrary URL in a message would let a player log who reads it.

/** Hosts whose files may be shown inline (exact host, or any subdomain of it). */
const MEDIA_HOSTS = ['giphy.com', 'tenor.com', 'klipy.com', 'i.imgur.com']

const IMAGE_EXT = /\.(gif|webp)$/i

function allowed(host: string): boolean {
  return MEDIA_HOSTS.some((h) => host === h || host.endsWith('.' + h))
}

/**
 * The image URL to show for a message body, or null when it should render as text.
 * Accepts a direct link to a .gif / .webp on an allowed host, and GIPHY page links
 * (giphy.com/gifs/some-title-<id>), which map to the GIF file by their id.
 */
export function gifUrl(body: string): string | null {
  const text = body.trim()
  if (!/^https:\/\/\S+$/.test(text)) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (!allowed(host)) return null

  // GIPHY page link: https://giphy.com/gifs/<slug>-<id>  (or /gifs/<id>)
  if (host === 'giphy.com' || host === 'www.giphy.com') {
    const m = url.pathname.match(/^\/(?:gifs|stickers)\/(?:[\w-]*-)?([A-Za-z0-9]+)\/?$/)
    return m ? `https://media.giphy.com/media/${m[1]}/giphy.gif` : null
  }
  return IMAGE_EXT.test(url.pathname) ? url.href : null
}
