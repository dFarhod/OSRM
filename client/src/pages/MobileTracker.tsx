import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { io, Socket } from 'socket.io-client'

const MAP_STYLE = 'http://10.181.1.65:8080/styles/basic/style.json'
const OSRM_BASE = 'http://10.181.1.65:5000'
const SOCKET_URL = `http://${window.location.hostname}:4000`

export default function MobileTracker() {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const userMarkerRef = useRef<maplibregl.Marker | null>(null)
  const destMarkerRef = useRef<maplibregl.Marker | null>(null)
  const watchIdRef = useRef<number | null>(null)

  const [name, setName] = useState('')
  const [nameSet, setNameSet] = useState(false)
  const [tracking, setTracking] = useState(false)
  const [connected, setConnected] = useState(false)
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [destination, setDestination] = useState<{ lat: number; lng: number } | null>(null)
  const [speed, setSpeed] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Map init
  useEffect(() => {
    if (!nameSet || !mapContainerRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: MAP_STYLE,
      center: [69.2401, 41.2995],
      zoom: 13,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    map.on('click', (e) => {
      const dest = { lat: e.lngLat.lat, lng: e.lngLat.lng }
      setDestination(dest)

      destMarkerRef.current?.remove()
      const el = document.createElement('div')
      el.style.cssText = `
        width: 36px; height: 36px; border-radius: 50%;
        background: #ef4444; border: 3px solid white;
        box-shadow: 0 2px 10px rgba(239,68,68,0.5);
        display: flex; align-items: center; justify-content: center;
        font-size: 16px;
      `
      el.textContent = '🎯'
      destMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([dest.lng, dest.lat])
        .addTo(map)

      socketRef.current?.emit('user:location', {
        lat: location?.lat ?? 0,
        lng: location?.lng ?? 0,
        destination: dest,
      })
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [nameSet])

  // Socket ulanish
  useEffect(() => {
    if (!nameSet) return

    const socket = io(SOCKET_URL, { transports: ['websocket'] })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('user:identify', { name })
    })
    socket.on('disconnect', () => setConnected(false))

    return () => { socket.disconnect() }
  }, [nameSet, name])

  // Tracking boshlash/to'xtatish
  const toggleTracking = () => {
    if (tracking) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
      setTracking(false)
      return
    }

    if (!navigator.geolocation) {
      setError("GPS qurilmangizda mavjud emas")
      return
    }

    setTracking(true)
    setError(null)

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, heading, speed: spd } = pos.coords
        setLocation({ lat, lng })
        setSpeed(spd)
        setError(null)

        const map = mapRef.current
        if (map) {
          if (!userMarkerRef.current) {
            const el = document.createElement('div')
            el.style.cssText = `
              width: 22px; height: 22px; border-radius: 50%;
              background: #2563eb; border: 3px solid white;
              box-shadow: 0 0 0 6px rgba(37,99,235,0.25);
            `
            userMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'center' })
              .setLngLat([lng, lat])
              .addTo(map)
            map.flyTo({ center: [lng, lat], zoom: 16, duration: 1500 })
          } else {
            userMarkerRef.current.setLngLat([lng, lat])
          }
        }

        socketRef.current?.emit('user:location', {
          lat, lng,
          heading: heading ?? undefined,
          speed: spd ?? undefined,
          destination: destination ?? undefined,
        })
      },
      (err) => {
        setError(err.message)
        setTracking(false)
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    )
  }

  // Yo'l chizish
  useEffect(() => {
    const map = mapRef.current
    if (!map || !location || !destination) return

    const draw = async () => {
      try {
        const res = await fetch(
          `${OSRM_BASE}/route/v1/driving/${location.lng},${location.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`
        )
        const data = await res.json()
        if (data.code !== 'Ok') return

        const geom = data.routes[0].geometry

        if (map.getLayer('mobile-route')) map.removeLayer('mobile-route')
        if (map.getSource('mobile-route')) map.removeSource('mobile-route')

        map.addSource('mobile-route', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: geom },
        })
        map.addLayer({
          id: 'mobile-route',
          type: 'line',
          source: 'mobile-route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#2563eb', 'line-width': 4, 'line-opacity': 0.8 },
        })
      } catch { /* silent */ }
    }

    draw()
  }, [destination, location])

  // — Ism kiritish ekrani —
  if (!nameSet) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)',
        padding: 24, fontFamily: "'Inter','Segoe UI',sans-serif",
      }}>
        <div style={{
          background: 'white', borderRadius: 24, padding: '36px 28px',
          boxShadow: '0 8px 40px rgba(0,0,0,0.12)',
          width: '100%', maxWidth: 380, textAlign: 'center',
        }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>📍</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>
            Kuzatuv tizimi
          </h1>
          <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 28px' }}>
            Ismingizni kiriting va kuzatishni boshlang
          </p>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && setNameSet(true)}
            placeholder="Ismingiz..."
            autoFocus
            style={{
              width: '100%', padding: '14px 16px',
              border: '2px solid #e2e8f0', borderRadius: 14,
              fontSize: 16, outline: 'none', boxSizing: 'border-box',
              marginBottom: 14, transition: 'border 0.15s',
            }}
            onFocus={(e) => (e.target.style.borderColor = '#2563eb')}
            onBlur={(e) => (e.target.style.borderColor = '#e2e8f0')}
          />
          <button
            onClick={() => name.trim() && setNameSet(true)}
            style={{
              width: '100%', padding: '14px 0',
              background: name.trim() ? '#2563eb' : '#e2e8f0',
              color: name.trim() ? 'white' : '#94a3b8',
              border: 'none', borderRadius: 14,
              fontSize: 16, fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            Davom etish →
          </button>
        </div>
      </div>
    )
  }

  // — Xarita ekrani —
  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', fontFamily: "'Inter','Segoe UI',sans-serif" }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

      {/* Yuqori status chiziq */}
      <div style={{
        position: 'absolute', top: 12, left: 12,
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'white', borderRadius: 20, padding: '6px 14px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
        fontSize: 13,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: connected ? '#22c55e' : '#ef4444',
        }} />
        <span style={{ fontWeight: 600, color: '#0f172a' }}>{name}</span>
        {speed != null && speed > 0 && (
          <span style={{ color: '#64748b' }}>{(speed * 3.6).toFixed(0)} km/h</span>
        )}
      </div>

      {/* Pastki sheet */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'white',
        borderRadius: '20px 20px 0 0',
        padding: '8px 20px 36px',
        boxShadow: '0 -4px 24px rgba(0,0,0,0.12)',
      }}>
        <div style={{
          width: 44, height: 4, borderRadius: 2,
          background: '#e2e8f0', margin: '0 auto 16px',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          {/* Start/Stop tugma */}
          <button
            onClick={toggleTracking}
            style={{
              flex: 1, padding: '13px 0',
              background: tracking
                ? 'linear-gradient(135deg, #fef2f2, #fee2e2)'
                : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
              color: tracking ? '#ef4444' : 'white',
              border: `2px solid ${tracking ? '#fecaca' : 'transparent'}`,
              borderRadius: 14, fontSize: 15, fontWeight: 700,
              cursor: 'pointer', transition: 'all 0.2s',
            }}
          >
            {tracking ? '⏹ To\'xtatish' : '▶ Kuzatishni boshlash'}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {location && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', background: '#f0fdf4', borderRadius: 10,
            }}>
              <span style={{ fontSize: 16 }}>📡</span>
              <span style={{ fontSize: 12, color: '#166534' }}>
                {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
              </span>
            </div>
          )}

          {destination ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', background: '#fff7ed', borderRadius: 10,
            }}>
              <span style={{ fontSize: 16 }}>🎯</span>
              <span style={{ fontSize: 12, color: '#9a3412' }}>
                Manzil belgilangan — o'zgartirish uchun xaritaga bosing
              </span>
            </div>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', background: '#f8fafc', borderRadius: 10,
            }}>
              <span style={{ fontSize: 16 }}>💡</span>
              <span style={{ fontSize: 12, color: '#64748b' }}>
                Manzil qo'shish uchun xaritaga bosing
              </span>
            </div>
          )}

          {error && (
            <div style={{
              padding: '8px 12px', background: '#fef2f2', borderRadius: 10,
              fontSize: 12, color: '#dc2626',
            }}>
              ⚠️ {error}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
