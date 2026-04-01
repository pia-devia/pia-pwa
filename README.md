# PWA

Una ventana a la mente de Kai — visor y editor de archivos markdown de contexto y memoria.

## Arquitectura

```
┌────────────────────────────────────────┐
│            kai-doc-pwa                 │
│  ┌──────────────────────────────────┐  │
│  │     React Frontend (built)       │  │
│  ├──────────────────────────────────┤  │
│  │        Express Backend           │  │
│  │   - REST API (/api/*)            │  │
│  │   - WebSocket (live updates)     │  │
│  │   - Static file serving          │  │
│  └──────────────────────────────────┘  │
│              ↕ volume                   │
│     /home/kai/.openclaw/workspace      │
└─────────────────┬──────────────────────┘
                  │ :80
            ┌─────▼─────┐
            │  Docker   │
            └───────────┘
```

## Stack Tecnológico

### Backend
- **Express** — Servidor HTTP
- **WS** — WebSocket para actualizaciones en tiempo real
- **Chokidar** — Watcher de archivos
- **JWT + bcryptjs** — Autenticación

### Frontend
- **React + Vite** — Framework y bundler
- **react-markdown + remark-gfm** — Renderizado de markdown
- **vite-plugin-pwa** — Manifest y service worker
- **CSS Modules** — Estilos encapsulados

## Requisitos

- Docker & Docker Compose
- Node.js 18+ (solo para desarrollo local)

## Instalación Rápida (Docker)

```bash
# Clonar
git clone git@github.com:kai-devia/kai-doc-pwa.git
cd kai-doc-pwa

# Levantar
docker compose up -d --build

# Acceder
open http://localhost
```

## Credenciales por defecto

- **Usuario:** `guille`
- **Contraseña:** `erythia2026`

## Desarrollo Local (sin Docker)

### Backend
```bash
cd backend
cp .env.example .env  # editar con tus valores
npm install
npm run dev
```

### Frontend (en otra terminal)
```bash
cd frontend
npm install
npm run dev
```

Acceder a http://localhost:5173

## Variables de Entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `JWT_SECRET` | Secreto para firmar tokens JWT | - |
| `AUTH_USER` | Usuario para login | - |
| `AUTH_PASS` | Contraseña para login | - |
| `PORT` | Puerto del servidor | 3001 |
| `WORKSPACE_ROOT` | Ruta al directorio con archivos .md | - |

## Cloudflare Tunnel (acceso externo)

Instalar cloudflared si no está:
```bash
# Ubuntu/Debian
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
```

Abrir tunnel:
```bash
cloudflared tunnel --url http://localhost:80
```

Esto abrirá un túnel temporal con una URL pública tipo `https://xxx.trycloudflare.com`

## Funcionalidades

- 🔐 **Autenticación JWT** con expiración de 7 días
- 📁 **Árbol de archivos** navegable con búsqueda
- 📄 **Dashboard** con cards y preview de cada archivo
- 📝 **Vista markdown** con soporte GFM (tablas, código, etc.)
- ✏️ **Editor** con guardado directo
- 🔴 **Live updates** vía WebSocket cuando cambian archivos
- 📱 **Responsive** — funciona en móvil con sidebar drawer
- 🌐 **PWA** — instalable como app

## Estructura de Carpetas

```
kai-doc-pwa/
├── backend/
│   ├── index.js           # Arranque del servidor
│   ├── config/
│   │   └── env.js         # Variables de entorno
│   ├── middlewares/
│   │   └── auth.js        # Verificación JWT
│   ├── routes/
│   │   ├── auth.js        # POST /api/auth/login
│   │   └── files.js       # API de archivos
│   └── services/
│       ├── fileService.js # Operaciones de archivos
│       └── watcherService.js # File watcher + WS
├── frontend/
│   ├── src/
│   │   ├── api/           # Cliente HTTP
│   │   ├── hooks/         # Hooks de React
│   │   ├── components/    # Componentes UI
│   │   └── styles/        # CSS global
│   ├── public/
│   └── vite.config.js
├── Dockerfile             # Multi-stage build
├── docker-compose.yml     # Configuración Docker
└── README.md
```

## API Endpoints

```
POST /api/auth/login
  body: { user, password }
  res:  { token }

GET /api/files
  header: Authorization: Bearer <token>
  res: árbol de archivos .md como JSON

GET /api/files/content?path=MEMORY.md
  res: { content, mtime }

PUT /api/files/content?path=MEMORY.md
  body: { content }
  res: { ok: true }

WS /ws?token=<jwt>
  → { type: "file_changed", path: "..." }
```

## Licencia

MIT — Kai & Guille, 2026
