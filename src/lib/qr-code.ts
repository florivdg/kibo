import { renderSVG } from 'uqr'

// Rendered locally, so the encoded value (e.g. a TOTP secret) never leaves the
// page. The border is the four-module quiet zone scanners expect.
export function qrCodeSvg(value: string) {
  return renderSVG(value, { border: 4 })
}

// The same code as a file of its own. uqr only sets a viewBox, which is fine
// inside a sized box on the page, but leaves other programs to guess a size.
export function qrCodeSvgFile(svg: string) {
  const size = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)
  if (!size) return svg
  return svg.replace('<svg ', `<svg width="${size[1]}" height="${size[2]}" `)
}
