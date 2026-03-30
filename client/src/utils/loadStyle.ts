const TILE_ORIGIN = 'http://10.181.1.65:8080'
const STYLE_URL = '/tiles/styles/basic/style.json'

// style.json ni yuklab, ichidagi barcha HTTP URL larni proxy yo'liga almashtiradi
export async function loadStyle(): Promise<object> {
  const res = await fetch(STYLE_URL)
  const text = await res.text()
  const rewritten = text.split(TILE_ORIGIN).join('/tiles')
  return JSON.parse(rewritten)
}
