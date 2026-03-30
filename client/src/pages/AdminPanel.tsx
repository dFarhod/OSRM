import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import { io, Socket } from 'socket.io-client'
import type { UserInfo } from '../types'

const MAP_STYLE = 'http://10.181.1.65:8080/styles/basic/style.json'
const SOCKET_URL = `http://${window.location.hostname}:4000`

const COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6']

function userColor(id: string) {
  let h = 0
  for (const c of id) h = (h << 5) - h + c.charCodeAt(0)
  return COLORS[Math.abs(h) % COLORS.length]
}

function timeAgo(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 5) return 'Hozir'
  if (s < 60) return `${s}s oldin`
  return `${Math.round(s / 60)}m oldin`
}

export default function AdminPanel() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const markersRef = useRef<Map<string, {
    user: maplibregl.Marker
    dest?: maplibregl.Marker
    label: HTMLDivElement
  }>>(new Map())

  const [users, setUsers] = useState<Map<string, UserInfo>>(new Map())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)

  // Map init
  useEffect(() => {
    if (!mapContainerRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [69.2401, 41.2995],
      zoom: 12,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(new maplibregl.ScaleControl(), 'bottom-right')
    mapRef.current = map

    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Marker yaratish/yangilash
  const upsertMarker = useCallback((user: UserInfo) => {
    const map = mapRef.current
    if (!map || user.lat === 0) return

    const color = userColor(user.id)
    const existing = markersRef.current.get(user.id)

    if (existing) {
      // Faqat pozitsiyani yangilash
      existing.user.setLngLat([user.lng, user.lat])
      existing.label.title = `${user.name}${user.speed ? ` · ${(user.speed * 3.6).toFixed(0)} km/h` : ''}`

      if (user.destination) {
        if (existing.dest) {
          existing.dest.setLngLat([user.destination.lng, user.destination.lat])
        } else {
          existing.dest = createDestMarker(map, user.destination, color)
        }
        drawLine(map, user)
      }
    } else {
      // Yangi marker
      const label = document.createElement('div')
      label.style.cssText = `
        width: 40px; height: 40px; border-radius: 50%;
        background: ${color}; border: 3px solid white;
        box-shadow: 0 3px 12px rgba(0,0,0,0.3);
        display: flex; align-items: center; justify-content: center;
        font-size: 15px; color: white; font-weight: 700;
        cursor: pointer; user-select: none;
        animation: markerPop 0.3s ease;
      `
      label.textContent = user.name.charAt(0).toUpperCase()
      label.title = user.name

      // Ism belgisi
      const nameTag = document.createElement('div')
      nameTag.style.cssText = `
        position: absolute; bottom: -20px; left: 50%; transform: translateX(-50%);
        background: rgba(0,0,0,0.7); color: white;
        font-size: 10px; font-weight: 600; white-space: nowrap;
        padding: 2px 6px; border-radius: 6px; pointer-events: none;
      `
      nameTag.textContent = user.name
      label.appendChild(nameTag)

      const marker = new maplibregl.Marker({ element: label, anchor: 'center' })
        .setLngLat([user.lng, user.lat])
        .addTo(map)

      const entry: typeof markersRef.current extends Map<string, infer V> ? V : never = {
        user: marker,
        label,
      }

      if (user.destination) {
        entry.dest = createDestMarker(map, user.destination, color)
        drawLine(map, user)
      }

      markersRef.current.set(user.id, entry)
    }
  }, [])

  const removeMarker = useCallback((id: string) => {
    const map = mapRef.current
    const entry = markersRef.current.get(id)
    if (!entry) return
    entry.user.remove()
    entry.dest?.remove()
    if (map) {
      if (map.getLayer(`line-${id}`)) map.removeLayer(`line-${id}`)
      if (map.getSource(`line-${id}`)) map.removeSource(`line-${id}`)
    }
    markersRef.current.delete(id)
  }, [])

  // Socket
  useEffect(() => {
    const socket = io(SOCKET_URL, { transports: ['websocket'] })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('admin:join')
    })
    socket.on('disconnect', () => setConnected(false))

    socket.on('users:all', (list: UserInfo[]) => {
      const map = new Map<string, UserInfo>()
      list.forEach((u) => { map.set(u.id, u); upsertMarker(u) })
      setUsers(map)
    })

    socket.on('user:joined', (u: UserInfo) => {
      setUsers((prev) => new Map(prev).set(u.id, u))
    })

    socket.on('user:updated', (u: UserInfo) => {
      setUsers((prev) => new Map(prev).set(u.id, u))
      upsertMarker(u)
    })

    socket.on('user:left', (id: string) => {
      setUsers((prev) => { const m = new Map(prev); m.delete(id); return m })
      removeMarker(id)
      setSelectedId((prev) => (prev === id ? null : prev))
    })

    return () => { socket.disconnect() }
  }, [upsertMarker, removeMarker])

  const zoomTo = (user: UserInfo) => {
    setSelectedId(user.id)
    mapRef.current?.flyTo({
      center: [user.lng, user.lat],
      zoom: 16,
      duration: 1400,
      easing: (t) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
    })
  }

  const userList = [...users.values()]
  const activeCount = userList.filter((u) => u.lat !== 0).length

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', fontFamily: "'Inter','Segoe UI',sans-serif" }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Chap panel */}
      <div style={{
        position: 'absolute', top: 16, left: 16,
        width: 290,
        maxHeight: 'calc(100vh - 32px)',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>

        {/* Header */}
        <div style={{
          background: 'white', borderRadius: 16, padding: '14px 16px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
            }}>👁</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Admin Panel</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Real vaqt kuzatuv</div>
            </div>
            <div style={{
              marginLeft: 'auto',
              width: 10, height: 10, borderRadius: '50%',
              background: connected ? '#22c55e' : '#ef4444',
              boxShadow: connected ? '0 0 0 3px rgba(34,197,94,0.25)' : 'none',
            }} />
          </div>

          {/* Statistika */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{
              flex: 1, padding: '8px 0', borderRadius: 10,
              background: '#f8fafc', textAlign: 'center',
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#0f172a' }}>{userList.length}</div>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>Jami</div>
            </div>
            <div style={{
              flex: 1, padding: '8px 0', borderRadius: 10,
              background: '#f0fdf4', textAlign: 'center',
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#16a34a' }}>{activeCount}</div>
              <div style={{ fontSize: 10, color: '#86efac' }}>Aktiv</div>
            </div>
            <div style={{
              flex: 1, padding: '8px 0', borderRadius: 10,
              background: '#faf5ff', textAlign: 'center',
            }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#7c3aed' }}>
                {userList.filter((u) => u.destination).length}
              </div>
              <div style={{ fontSize: 10, color: '#c4b5fd' }}>Manzilli</div>
            </div>
          </div>
        </div>

        {/* Foydalanuvchilar ro'yxati */}
        <div style={{
          background: 'white', borderRadius: 16,
          boxShadow: '0 4px 20px rgba(0,0,0,0.10)',
          overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ padding: '12px 14px 6px', fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Foydalanuvchilar
          </div>

          {userList.length === 0 ? (
            <div style={{ padding: '28px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📡</div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>Hech kim ulanmagan</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                Mobile: <b>{window.location.host}/?page=mobile</b>
              </div>
            </div>
          ) : (
            <div style={{ overflowY: 'auto', padding: '0 8px 12px' }}>
              {userList.map((user) => {
                const color = userColor(user.id)
                const isSelected = selectedId === user.id
                const hasLocation = user.lat !== 0
                return (
                  <div
                    key={user.id}
                    onClick={() => hasLocation && zoomTo(user)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 10px', borderRadius: 12, marginBottom: 2,
                      cursor: hasLocation ? 'pointer' : 'default',
                      border: `1.5px solid ${isSelected ? color : 'transparent'}`,
                      background: isSelected ? `${color}18` : 'transparent',
                      transition: 'all 0.15s',
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#f8fafc' }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                  >
                    {/* Avatar */}
                    <div style={{
                      width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                      background: color,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 15, color: 'white', fontWeight: 700,
                    }}>
                      {user.name.charAt(0).toUpperCase()}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{user.name}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
                        {hasLocation
                          ? `${user.lat.toFixed(4)}, ${user.lng.toFixed(4)}`
                          : 'Joylashuv kutilmoqda...'}
                      </div>
                      {user.speed != null && user.speed > 0.5 && (
                        <div style={{ fontSize: 11, color: '#64748b' }}>
                          🚗 {(user.speed * 3.6).toFixed(0)} km/h
                        </div>
                      )}
                    </div>

                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: '#94a3b8' }}>{timeAgo(user.updatedAt)}</div>
                      {user.destination && (
                        <div style={{ fontSize: 12, marginTop: 2 }}>🎯</div>
                      )}
                      {hasLocation && (
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: '#22c55e', marginTop: 4, marginLeft: 'auto',
                        }} />
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes markerPop {
          0%   { transform: scale(0.3); opacity: 0 }
          70%  { transform: scale(1.2) }
          100% { transform: scale(1);   opacity: 1 }
        }
      `}</style>
    </div>
  )
}

// Helpers
function createDestMarker(
  map: maplibregl.Map,
  dest: { lat: number; lng: number },
  color: string
) {
  const el = document.createElement('div')
  el.style.cssText = `
    width: 14px; height: 14px; border-radius: 50%;
    background: ${color}; border: 3px solid white;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  `
  return new maplibregl.Marker({ element: el, anchor: 'center' })
    .setLngLat([dest.lng, dest.lat])
    .addTo(map)
}

function drawLine(map: maplibregl.Map, user: UserInfo) {
  if (!user.destination || user.lat === 0) return
  const id = `line-${user.id}`
  const coords: [number, number][] = [
    [user.lng, user.lat],
    [user.destination.lng, user.destination.lat],
  ]
  const data: GeoJSON.Feature<GeoJSON.LineString> = {
    type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: coords },
  }

  if (map.getSource(id)) {
    ;(map.getSource(id) as maplibregl.GeoJSONSource).setData(data)
  } else {
    map.addSource(id, { type: 'geojson', data })
    map.addLayer({
      id, type: 'line', source: id,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': userColor(user.id),
        'line-width': 2,
        'line-opacity': 0.5,
        'line-dasharray': [3, 3],
      },
    })
  }
}
