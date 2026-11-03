import { describe, expect, it } from 'vitest'
import { gifUrl } from '../chatGif'

describe('gifUrl', () => {
  it('maps a GIPHY page link to its GIF', () => {
    expect(gifUrl('https://giphy.com/gifs/the-office-michael-scott-no-12XMGIWtrHBl5e'))
      .toBe('https://media.giphy.com/media/12XMGIWtrHBl5e/giphy.gif')
    expect(gifUrl('https://giphy.com/gifs/12XMGIWtrHBl5e')).toBe('https://media.giphy.com/media/12XMGIWtrHBl5e/giphy.gif')
  })
  it('keeps direct media links on allowed hosts', () => {
    for (const u of [
      'https://media.giphy.com/media/abc/giphy.gif',
      'https://media1.giphy.com/media/abc/giphy.webp',
      'https://i.giphy.com/abc.gif',
      'https://media.tenor.com/AbCd/hello.gif',
      'https://static.klipy.com/ii/x/y.gif',
      'https://i.imgur.com/abc.gif',
    ]) expect(gifUrl(u)).toBe(u)
  })
  it('tolerates surrounding whitespace', () => {
    expect(gifUrl('  https://i.imgur.com/abc.gif\n')).toBe('https://i.imgur.com/abc.gif')
  })
  it('leaves everything else as text', () => {
    for (const b of [
      'hello',
      'look https://i.imgur.com/abc.gif',          // link inside a sentence
      'http://i.imgur.com/abc.gif',                // not https
      'https://example.com/cat.gif',               // host not allowed
      'https://giphy.com.evil.com/x.gif',          // look-alike host
      'https://evilgiphy.com/x.gif',
      'https://i.imgur.com/abc.png',               // not a GIF
      'https://tenor.com/view/hello-12345',        // Tenor page: no file URL without their API
      'https://giphy.com/explore/cats',
    ]) expect(gifUrl(b)).toBeNull()
  })
})
