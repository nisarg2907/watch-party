# Watch Party Monorepo

A synchronized video watching experience built with Turborepo, TypeScript, React, and Socket.io.

## Tech Stack

- **Monorepo**: Turborepo
- **Package Manager**: pnpm
- **Client**: React + Vite + TypeScript
- **Server**: Node.js + Express + Socket.io + TypeScript
- **Shared**: TypeScript package for common utilities
- **Cache**: Redis (optional, for multi-instance support)

## Prerequisites

- Node.js (v18+)
- pnpm (`npm i -g pnpm`)
- Docker (optional, for local Redis)

## Getting Started

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Set up environment variables**:
   ```bash
   cp apps/client/.env.example apps/client/.env
   cp apps/server/.env.example apps/server/.env
   ```

3. **Start Redis (optional)**:
   ```bash
   docker-compose up -d
   ```

4. **Run development servers**:
   ```bash
   pnpm dev
   ```

   This will start:
   - Client: http://localhost:5173
   - Server: http://localhost:4000

## Project Structure

```
watch-party-monorepo/
├── apps/
│   ├── client/        # React (Vite) app
│   └── server/        # Node + Socket.io
├── packages/
│   └── shared/        # Shared types & utilities
├── turbo.json
├── package.json
└── pnpm-workspace.yaml
```

## Scripts

- `pnpm dev` - Run all apps in development mode
- `pnpm build` - Build all apps and packages
- `pnpm start` - Start all apps in production mode
- `pnpm lint` - Lint all packages
- `pnpm test` - Run tests (when added)

## Features

- Synchronized video playback across multiple clients
- Real-time play/pause/seek synchronization
- Video URL change broadcasting
- Redis-backed session persistence (optional)
- Multi-instance server support via Redis pub/sub

## Deployment

### Client (Vercel/Netlify)
- Deploy `apps/client` as a static site
- Set `VITE_SOCKET_URL` environment variable to your server URL

### Server (Render/Railway/Fly)
- Deploy `apps/server`
- Set `REDIS_URL` to a managed Redis instance (Upstash, Redis Cloud, etc.)
- Set `CLIENT_URL` to your client URL
- Set `PORT` (usually auto-set by platform)

## Development

The shared package (`@watchparty/shared`) contains:
- `extractVideoId()` - YouTube URL parser
- `SocketEvents` - Event name constants
- `SessionState` - TypeScript interface

Both client and server import from this shared package to ensure type safety and consistency.

