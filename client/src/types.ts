export interface LngLat {
  lng: number
  lat: number
}

export interface UserInfo {
  id: string
  name: string
  lat: number
  lng: number
  heading?: number
  speed?: number
  destination?: { lat: number; lng: number }
  updatedAt: number
}

export interface RouteInfo {
  distance: number  // metr
  duration: number  // sekund
  index: number
}

export interface OsrmManeuver {
  type: string
  modifier?: string
  bearing_after?: number
  location: [number, number]   // [lng, lat]
}

export interface OsrmStep {
  name: string
  distance: number
  duration: number
  maneuver: OsrmManeuver
  geometry: {
    type: 'LineString'
    coordinates: [number, number][]
  }
}

export interface OsrmLeg {
  steps: OsrmStep[]
  distance: number
  duration: number
}

export interface OsrmRoute {
  distance: number
  duration: number
  geometry: {
    type: 'LineString'
    coordinates: [number, number][]
  }
  legs: OsrmLeg[]
}

export interface OsrmResponse {
  code: string
  routes: OsrmRoute[]
  waypoints: Array<{ name: string; location: [number, number] }>
}

export type PointRole = 'start' | 'end'
