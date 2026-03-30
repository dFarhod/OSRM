# OSRM Router

## Ishga tushirish

### Client (React)
```bash
cd client
npm install
npm run dev
# http://localhost:3000
```

### Server (faqat CORS muammo bo'lsa)
```bash
cd server
npm install
npm run dev
# http://localhost:4000
```

Agar server ishlatilsa, `client/src/App.tsx` ichida:
```ts
const OSRM_BASE = 'http://localhost:4000'  // server orqali
// yoki
const OSRM_BASE = '/osrm'  // vite proxy orqali (default)
```
# OSRM
