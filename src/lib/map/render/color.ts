// Nation colours as the render layers paint them.
import type { RenderState } from './types'

export const nationColor = (state: RenderState, nation: string): string => {
  const color = state.nationColors?.[nation]
  if (!color) {
    throw new Error(`No colour for nation "${nation}"`)
  }
  return color
}

export const toRgba = (color: string, opacity: number): string => {
  const hex = color.match(/^#([0-9a-fA-F]{6})$/)
  if (hex) {
    const r = parseInt(hex[1].slice(0, 2), 16)
    const g = parseInt(hex[1].slice(2, 4), 16)
    const b = parseInt(hex[1].slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${opacity})`
  }
  return color.replace(
    /rgb(a?)\((\d+), (\d+), (\d+)(, [\d.]+)?\)/,
    `rgba($2, $3, $4, ${opacity})`
  )
}
