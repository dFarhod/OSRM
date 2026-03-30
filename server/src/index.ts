import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'

const app = express()
const httpServer = createServer(app)
const PORT = 4000

app.use(cors())
app.use(express.json())

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
})

interface UserInfo {
  id: string
  name: string
  lat: number
  lng: number
  heading?: number
  speed?: number
  destination?: { lat: number; lng: number }
  updatedAt: number
}

const users = new Map<string, UserInfo>()

io.on('connection', (socket) => {
  console.log('Ulandi:', socket.id)

  socket.on('user:identify', ({ name }: { name: string }) => {
    users.set(socket.id, {
      id: socket.id,
      name,
      lat: 0,
      lng: 0,
      updatedAt: Date.now(),
    })
    io.to('admins').emit('user:joined', users.get(socket.id))
    console.log('Yangi foydalanuvchi:', name)
  })

  socket.on('user:location', (data: {
    lat: number
    lng: number
    heading?: number
    speed?: number
    destination?: { lat: number; lng: number }
  }) => {
    const user = users.get(socket.id)
    if (!user) return
    user.lat = data.lat
    user.lng = data.lng
    user.heading = data.heading
    user.speed = data.speed
    if (data.destination) user.destination = data.destination
    user.updatedAt = Date.now()
    io.to('admins').emit('user:updated', user)
  })

  socket.on('admin:join', () => {
    socket.join('admins')
    socket.emit('users:all', [...users.values()])
    console.log('Admin ulandi:', socket.id)
  })

  socket.on('disconnect', () => {
    if (users.delete(socket.id)) {
      io.to('admins').emit('user:left', socket.id)
    }
    console.log('Uzildi:', socket.id)
  })
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', users: users.size })
})

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server: http://0.0.0.0:${PORT}`)
})
