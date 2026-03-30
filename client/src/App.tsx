import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { LngLat, OsrmResponse, OsrmStep, OsrmRoute } from './types'

const MAP_STYLE = 'http://10.181.1.65:8080/styles/basic/style.json'
const OSRM_BASE = 'http://10.181.1.65:5000'

function formatDistance(meters: number): string {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(2)} km`
    : `${Math.round(meters)} m`
}

function maneuverText(step: OsrmStep): string {
  const { type, modifier } = step.maneuver
  const street = step.name ? `"${step.name}"` : ''

  const modMap: Record<string, string> = {
    left: 'chapga',
    right: "o'ngga",
    'slight left': 'biroz chapga',
    'slight right': "biroz o'ngga",
    'sharp left': 'keskin chapga',
    'sharp right': "keskin o'ngga",
    straight: 'to\'g\'ri',
    uturn: 'orqaga',
  }

  const mod = modifier ? modMap[modifier] ?? modifier : ''

  switch (type) {
    case 'depart':     return `Yo'lga chiqing${street ? ` — ${street}` : ''}`
    case 'arrive':     return `Manzilga yetib keldingiz${street ? ` — ${street}` : ''}`
    case 'turn':       return `${mod ? mod.charAt(0).toUpperCase() + mod.slice(1) : 'Buring'}${street ? ` — ${street}` : ''}`
    case 'continue':   return `To\'g\'ri davom eting${street ? ` — ${street}` : ''}`
    case 'new name':   return `Davom eting${street ? ` — ${street}` : ''}`
    case 'merge':      return `${mod ? mod.charAt(0).toUpperCase() + mod.slice(1) + 'ga' : ''} qo\'shiling${street ? ` — ${street}` : ''}`
    case 'fork':       return `${mod ? mod.charAt(0).toUpperCase() + mod.slice(1) + 'dagi' : ''} ajralishdan boring${street ? ` — ${street}` : ''}`
    case 'on ramp':    return `Kirish yo\'liga chiqing${street ? ` — ${street}` : ''}`
    case 'off ramp':   return `Chiqish yo\'liga o\'ting${street ? ` — ${street}` : ''}`
    case 'end of road':return `${mod ? mod.charAt(0).toUpperCase() + mod.slice(1) + 'ga' : ''} buring${street ? ` — ${street}` : ''}`
    case 'roundabout': return `Dumaloq chorrahaga kiring${street ? ` — ${street}` : ''}`
    case 'exit roundabout': return `Dumaloq chorrahadan chiqing${street ? ` — ${street}` : ''}`
    case 'rotary':     return `Aylana yo\'lga kiring${street ? ` — ${street}` : ''}`
    case 'exit rotary':return `Aylana yo\'ldan chiqing${street ? ` — ${street}` : ''}`
    default:           return `${mod ? mod.charAt(0).toUpperCase() + mod.slice(1) : 'Davom eting'}${street ? ` — ${street}` : ''}`
  }
}

function maneuverIcon(step: OsrmStep): string {
  const { type, modifier } = step.maneuver
  if (type === 'depart') return '🚦'
  if (type === 'arrive') return '🏁'
  if (type === 'roundabout' || type === 'rotary') return '🔄'
  if (type === 'exit roundabout' || type === 'exit rotary') return '↪'
  if (modifier === 'left' || modifier === 'sharp left') return '⬅'
  if (modifier === 'right' || modifier === 'sharp right') return '➡'
  if (modifier === 'slight left') return '↖'
  if (modifier === 'slight right') return '↗'
  if (modifier === 'uturn') return '↩'
  return '⬆'
}

function formatDuration(seconds: number): string {
  const min = Math.floor(seconds / 60)
  if (min >= 60) {
    const h = Math.floor(min / 60)
    const m = min % 60
    return `${h} soat ${m} min`
  }
  return `${min} min`
}

const ALT_COLORS = ['#94a3b8', '#a78bfa', '#fb923c']
const ACTIVE_COLOR = '#2563eb'

function clearRouteLayers(map: maplibregl.Map) {
  for (let i = 0; i < 4; i++) {
    if (map.getLayer(`route-alt-${i}`)) map.removeLayer(`route-alt-${i}`)
    if (map.getSource(`route-alt-${i}`)) map.removeSource(`route-alt-${i}`)
  }
  if (map.getLayer('route-line')) map.removeLayer('route-line')
  if (map.getSource('route')) map.removeSource('route')
  if (map.getLayer('route-passed')) map.removeLayer('route-passed')
  if (map.getSource('route-passed')) map.removeSource('route-passed')
  if (map.getLayer('route-remaining')) map.removeLayer('route-remaining')
  if (map.getSource('route-remaining')) map.removeSource('route-remaining')
}

export default function App() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const stepMarkerRef = useRef<maplibregl.Marker | null>(null)

  const [points, setPoints] = useState<LngLat[]>([])
  const [allRoutes, setAllRoutes] = useState<OsrmRoute[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [steps, setSteps] = useState<OsrmStep[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stepsOpen, setStepsOpen] = useState(false)
  const [activeStep, setActiveStep] = useState<number | null>(null)

  // Xaritani ishga tushirish
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [69.2701, 41.3098],
      zoom: 12,
    })

    map.on('error', (e) => { console.error('MapLibre xato:', e) })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right')
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Klik hodisasi
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat
      setPoints((prev) => {
        if (prev.length >= 2) {
          markersRef.current.forEach((m) => m.remove())
          markersRef.current = []
          setAllRoutes([])
          setSelectedIdx(0)
          setError(null)
          clearRouteLayers(map)
          return [{ lng, lat }]
        }
        return [...prev, { lng, lat }]
      })
    }

    map.on('click', handleClick)
    return () => { map.off('click', handleClick) }
  }, [])

  // Yangi nuqta qo'shilganda marker chizish + 2 ta bo'lsa route olish
  useEffect(() => {
    const map = mapRef.current
    if (!map || points.length === 0) return

    const latest = points[points.length - 1]
    const isStart = points.length === 1

    const el = document.createElement('div')
    el.style.cssText = `
      width: 28px; height: 28px; border-radius: 50%;
      background: ${isStart ? '#22c55e' : '#ef4444'};
      border: 3px solid white;
      box-shadow: 0 2px 6px rgba(0,0,0,0.35);
      display: flex; align-items: center; justify-content: center;
      color: white; font-size: 12px; font-weight: bold;
    `
    el.textContent = isStart ? 'A' : 'B'

    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([latest.lng, latest.lat])
      .setPopup(
        new maplibregl.Popup({ offset: 20 }).setHTML(
          `<b>${isStart ? 'Boshlang\'ich' : 'Oxirgi'} nuqta</b><br/>
           ${latest.lat.toFixed(5)}, ${latest.lng.toFixed(5)}`
        )
      )
      .addTo(map)

    markersRef.current.push(marker)

    if (points.length === 2) {
      fetchRoute(points[0], points[1])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points])

  const drawRoutes = useCallback((routes: OsrmRoute[], activeIdx: number) => {
    const map = mapRef.current
    if (!map) return

    clearRouteLayers(map)

    // Avval alternativlarni chizish (pastda qolsin)
    routes.forEach((route, i) => {
      if (i === activeIdx) return
      const srcId = `route-alt-${i}`
      map.addSource(srcId, {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: route.geometry },
      })
      map.addLayer({
        id: srcId,
        type: 'line',
        source: srcId,
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ALT_COLORS[i % ALT_COLORS.length],
          'line-width': 5,
          'line-opacity': 0.7,
        },
      })
    })

    // Tanlangan yo'lni ustiga chizish
    const active = routes[activeIdx]
    map.addSource('route', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: active.geometry },
    })
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': ACTIVE_COLOR,
        'line-width': 6,
        'line-opacity': 0.9,
      },
    })
  }, [])

  const fetchRoute = useCallback(async (start: LngLat, end: LngLat) => {
    const map = mapRef.current
    if (!map) return

    setLoading(true)
    setError(null)

    try {
      const url =
        `${OSRM_BASE}/route/v1/driving/` +
        `${start.lng},${start.lat};${end.lng},${end.lat}` +
        `?overview=full&geometries=geojson&steps=true&alternatives=true`

      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const data: OsrmResponse = await res.json()
      if (data.code !== 'Ok' || !data.routes.length) {
        throw new Error('Yo\'l topilmadi')
      }

      setAllRoutes(data.routes)
      setSelectedIdx(0)
      setSteps(data.routes[0].legs.flatMap((leg) => leg.steps))

      drawRoutes(data.routes, 0)

      // Barcha yo'llarni sig'diradigan chegaralar
      const allCoords = data.routes.flatMap((r) => r.geometry.coordinates)
      const bounds = allCoords.reduce(
        (b, coord) => b.extend(coord as [number, number]),
        new maplibregl.LngLatBounds(
          allCoords[0] as [number, number],
          allCoords[0] as [number, number]
        )
      )
      map.fitBounds(bounds, { padding: 80, duration: 800 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Xatolik yuz berdi')
    } finally {
      setLoading(false)
    }
  }, [drawRoutes])

  const handleReset = () => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach((m) => m.remove())
    markersRef.current = []
    setPoints([])
    setAllRoutes([])
    setSelectedIdx(0)
    setSteps([])
    setStepsOpen(false)
    setActiveStep(null)
    stepMarkerRef.current?.remove()
    stepMarkerRef.current = null
    setError(null)
    clearRouteLayers(map)
  }

  const handleSelectRoute = (idx: number) => {
    if (idx === selectedIdx) return
    setSelectedIdx(idx)
    setSteps(allRoutes[idx].legs.flatMap((leg) => leg.steps))
    setStepsOpen(false)
    setActiveStep(null)
    stepMarkerRef.current?.remove()
    stepMarkerRef.current = null
    drawRoutes(allRoutes, idx)
  }

  const handleStepClick = (step: OsrmStep, idx: number) => {
    const map = mapRef.current
    if (!map) return
    setActiveStep(idx)

    // Eski step markerini o'chirish
    stepMarkerRef.current?.remove()

    const el = document.createElement('div')
    el.style.cssText = `
      width: 36px; height: 36px; border-radius: 50%;
      background: ${ACTIVE_COLOR};
      border: 3px solid white;
      box-shadow: 0 2px 10px rgba(37,99,235,0.5);
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
      animation: stepPop 0.25s ease;
    `
    el.textContent = maneuverIcon(step)

    stepMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat(step.maneuver.location)
      .setPopup(
        new maplibregl.Popup({ offset: 22, closeButton: false }).setHTML(
          `<div style="font-size:12px;font-weight:600;color:#1e293b;line-height:1.5">
            ${maneuverText(step)}
            ${step.distance > 0 ? `<br/><span style="color:#94a3b8;font-weight:400">${formatDistance(step.distance)}</span>` : ''}
          </div>`
        )
      )
      .addTo(map)

    stepMarkerRef.current.getPopup().addTo(map)

    map.flyTo({
      center: step.maneuver.location,
      zoom: 17,
      duration: 1800,
      essential: true,
      easing: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    })
  }

  // activeStep o'zgarganda yo'lni o'tilgan/qolgan qismlarga bo'lish
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Split layerlarni tozalash
    if (map.getLayer('route-passed')) map.removeLayer('route-passed')
    if (map.getSource('route-passed')) map.removeSource('route-passed')
    if (map.getLayer('route-remaining')) map.removeLayer('route-remaining')
    if (map.getSource('route-remaining')) map.removeSource('route-remaining')

    if (activeStep === null || steps.length === 0) {
      // To'liq yo'lni qayta ko'rsatish
      if (map.getLayer('route-line')) {
        map.setPaintProperty('route-line', 'line-opacity', 0.9)
      }
      return
    }

    // Asosiy yo'lni yashirish
    if (map.getLayer('route-line')) {
      map.setPaintProperty('route-line', 'line-opacity', 0)
    }

    // O'tilgan qism: 0 .. activeStep (inclusive)
    const passedCoords = steps
      .slice(0, activeStep + 1)
      .flatMap((s) => s.geometry.coordinates)

    // Qolgan qism: activeStep .. oxiri
    const remainingCoords = steps
      .slice(activeStep)
      .flatMap((s) => s.geometry.coordinates)

    if (passedCoords.length >= 2) {
      map.addSource('route-passed', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: passedCoords } },
      })
      map.addLayer({
        id: 'route-passed',
        type: 'line',
        source: 'route-passed',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': '#94a3b8',
          'line-width': 5,
          'line-opacity': 0.55,
          'line-dasharray': [2, 2],
        },
      })
    }

    if (remainingCoords.length >= 2) {
      map.addSource('route-remaining', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: remainingCoords } },
      })
      map.addLayer({
        id: 'route-remaining',
        type: 'line',
        source: 'route-remaining',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ACTIVE_COLOR,
          'line-width': 6,
          'line-opacity': 0.9,
        },
      })
    }
  }, [activeStep, steps])

  const activeRoute = useMemo(() => allRoutes[selectedIdx] ?? null, [allRoutes, selectedIdx])
  const fastestDuration = useMemo(() => allRoutes[0]?.duration ?? 0, [allRoutes])

  const statusText = () => {
    if (points.length === 0) return "Xaritaga bosing — boshlang'ich nuqta (A)"
    if (points.length === 1) return 'Xaritaga bosing — oxirgi nuqta (B)'
    if (loading) return 'Yo\'l hisoblanmoqda...'
    if (error) return error
    return `${allRoutes.length} ta yo'l topildi`
  }

  const phase = points.length === 0 ? 'idle'
    : points.length === 1 ? 'one'
    : loading ? 'loading'
    : error ? 'error'
    : 'done'

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* ── Chap panel ── */}
      <div style={{
        position: 'absolute', top: 16, left: 16,
        width: 300,
        maxHeight: 'calc(100vh - 32px)',
        display: 'flex', flexDirection: 'column',
        gap: 10,
        pointerEvents: 'none',
      }}>

        {/* Header kartochka */}
        <div style={{
          background: 'white',
          borderRadius: 16,
          padding: '14px 16px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          pointerEvents: 'auto',
        }}>
          {/* Sarlavha */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 10,
                background: 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16,
              }}>🗺</div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', lineHeight: 1.2 }}>OSRM Router</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Yo'l topuvchi</div>
              </div>
            </div>
            {points.length > 0 && (
              <button
                onClick={handleReset}
                title="Tozalash"
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: '#fef2f2', border: '1px solid #fecaca',
                  color: '#ef4444', cursor: 'pointer',
                  fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.15s', flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#ef4444'; e.currentTarget.style.color = 'white' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.color = '#ef4444' }}
              >✕</button>
            )}
          </div>

          {/* Status badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '5px 10px', borderRadius: 20,
            fontSize: 12, fontWeight: 500,
            background: phase === 'error' ? '#fef2f2'
              : phase === 'loading' ? '#eff6ff'
              : phase === 'done' ? '#f0fdf4'
              : '#f8fafc',
            color: phase === 'error' ? '#dc2626'
              : phase === 'loading' ? '#2563eb'
              : phase === 'done' ? '#16a34a'
              : '#64748b',
          }}>
            {phase === 'loading' && (
              <span style={{
                display: 'inline-block', width: 10, height: 10,
                border: '2px solid currentColor', borderTopColor: 'transparent',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
            )}
            {phase === 'idle' && '📍'}
            {phase === 'one' && '📍'}
            {phase === 'done' && '✓'}
            {phase === 'error' && '✗'}
            {statusText()}
          </div>
        </div>

        {/* Yo'l tanlov kartochkalar */}
        {allRoutes.length > 0 && !loading && (
          <div style={{
            background: 'white', borderRadius: 16,
            padding: '12px 14px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
            pointerEvents: 'auto',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Yo'llar
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {allRoutes.map((route, i) => {
                const isActive = i === selectedIdx
                const color = isActive ? ACTIVE_COLOR : ALT_COLORS[i % ALT_COLORS.length]
                const extraMin = i === 0 ? 0 : Math.round((route.duration - fastestDuration) / 60)
                return (
                  <div
                    key={i}
                    onClick={() => handleSelectRoute(i)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px',
                      borderRadius: 12,
                      cursor: 'pointer',
                      border: `1.5px solid ${isActive ? color : '#e2e8f0'}`,
                      background: isActive ? '#eff6ff' : 'transparent',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = '#f8fafc' }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* Rang chizig'i */}
                    <div style={{ width: 4, height: 36, borderRadius: 4, background: color, flexShrink: 0 }} />

                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>
                          {i === 0 ? 'Eng tez' : `${i + 1}-alternativ`}
                        </span>
                        {extraMin > 0 && (
                          <span style={{
                            fontSize: 10, fontWeight: 600,
                            padding: '1px 6px', borderRadius: 10,
                            background: '#fff7ed', color: '#ea580c',
                          }}>+{extraMin} min</span>
                        )}
                        {i === 0 && (
                          <span style={{
                            fontSize: 10, fontWeight: 600,
                            padding: '1px 6px', borderRadius: 10,
                            background: '#f0fdf4', color: '#16a34a',
                          }}>tavsiya</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        <b style={{ color: '#1e293b' }}>{formatDuration(route.duration)}</b>
                        {' · '}{formatDistance(route.distance)}
                      </div>
                    </div>

                    {isActive && (
                      <div style={{
                        width: 20, height: 20, borderRadius: '50%',
                        background: ACTIVE_COLOR,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, color: 'white', fontWeight: 700, flexShrink: 0,
                      }}>✓</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Harakatlanish tartibi — collapsible */}
        {steps.length > 0 && !loading && (
          <div style={{
            background: 'white', borderRadius: 16,
            boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
            pointerEvents: 'auto',
            overflow: 'hidden',
          }}>
            {/* Toggle header */}
            <button
              onClick={() => setStepsOpen((v) => !v)}
              style={{
                width: '100%', padding: '12px 14px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                background: 'transparent', border: 'none', cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14 }}>🧭</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>Harakatlanish tartibi</span>
                <span style={{
                  fontSize: 10, fontWeight: 600,
                  padding: '1px 7px', borderRadius: 10,
                  background: '#f1f5f9', color: '#64748b',
                }}>{steps.length}</span>
              </div>
              <span style={{
                fontSize: 12, color: '#94a3b8',
                transform: stepsOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
                display: 'inline-block',
              }}>▼</span>
            </button>

            {/* Steps list */}
            {stepsOpen && (
              <div style={{
                maxHeight: 320, overflowY: 'auto',
                borderTop: '1px solid #f1f5f9',
                padding: '6px 8px 10px',
              }}>
                {(() => {
                  // Har bir nuqtagacha to'plangan masofa (prefix sum)
                  const cumulative: number[] = []
                  let acc = 0
                  for (const s of steps) {
                    cumulative.push(acc)
                    acc += s.distance
                  }
                  return steps.map((step, i) => {
                  const isActiveStep = activeStep === i
                  return (
                    <div
                      key={i}
                      onClick={() => handleStepClick(step, i)}
                      style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        padding: '7px 8px', borderRadius: 10,
                        marginBottom: 2,
                        cursor: 'pointer',
                        border: `1.5px solid ${isActiveStep ? ACTIVE_COLOR : 'transparent'}`,
                        background: isActiveStep ? '#eff6ff' : i % 2 === 0 ? '#f8fafc' : 'transparent',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={(e) => { if (!isActiveStep) e.currentTarget.style.background = '#f1f5f9' }}
                      onMouseLeave={(e) => { if (!isActiveStep) e.currentTarget.style.background = i % 2 === 0 ? '#f8fafc' : 'transparent' }}
                    >
                      <div style={{
                        width: 28, height: 28, borderRadius: 8, flexShrink: 0,
                        background: isActiveStep ? ACTIVE_COLOR
                          : i === 0 ? '#dcfce7'
                          : i === steps.length - 1 ? '#fee2e2'
                          : '#f1f5f9',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13,
                        transition: 'background 0.15s',
                      }}>
                        {maneuverIcon(step)}
                      </div>
                      <div style={{ flex: 1, paddingTop: 2 }}>
                        <div style={{ fontSize: 12, color: isActiveStep ? ACTIVE_COLOR : '#1e293b', lineHeight: 1.4, fontWeight: 500 }}>
                          {maneuverText(step)}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                          {cumulative[i] > 0 && (
                            <span style={{
                              fontSize: 10, fontWeight: 600,
                              padding: '1px 6px', borderRadius: 8,
                              background: isActiveStep ? '#dbeafe' : '#f1f5f9',
                              color: isActiveStep ? ACTIVE_COLOR : '#64748b',
                            }}>
                              {formatDistance(cumulative[i])}
                            </span>
                          )}
                          {step.distance > 0 && (
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>
                              +{formatDistance(step.distance)}
                            </span>
                          )}
                        </div>
                      </div>
                      {isActiveStep && (
                        <div style={{ fontSize: 10, color: ACTIVE_COLOR, paddingTop: 4, flexShrink: 0 }}>📍</div>
                      )}
                    </div>
                  )
                })
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── O'ng pastki legend ── */}
      <div style={{
        position: 'absolute', bottom: 68, right: 16,
        background: 'white',
        borderRadius: 12,
        padding: '10px 12px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        fontSize: 11, color: '#475569',
        minWidth: 160,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 7 }}>
          Belgilar
        </div>
        {([
          { color: '#22c55e', label: "Boshlang'ich (A)", dot: true },
          { color: '#ef4444', label: 'Oxirgi (B)', dot: true },
          { color: ACTIVE_COLOR, label: "Tanlangan yo'l", dot: false },
          { color: ALT_COLORS[0], label: "Alternativ yo'l", dot: false },
        ] as { color: string; label: string; dot: boolean }[]).map(({ color, label, dot }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <div style={{
              width: dot ? 10 : 18, height: dot ? 10 : 4,
              borderRadius: dot ? '50%' : 3,
              background: color, flexShrink: 0,
            }} />
            <span>{label}</span>
          </div>
        ))}
      </div>

      {/* Spin animatsiya uchun style */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes stepPop {
          0%   { transform: scale(0.4); opacity: 0 }
          70%  { transform: scale(1.2) }
          100% { transform: scale(1);   opacity: 1 }
        }
      `}</style>
    </div>
  )
}
