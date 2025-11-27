# Watch Party Monorepo

A synchronized video watching experience built with Turborepo, TypeScript, React, and Socket.io.

## Tech Stack

- **Monorepo**: Turborepo
- **Package Manager**: pnpm
- **Client**: React + Vite + TypeScript + Tailwind CSS
- **Server**: Node.js + Express + Socket.io + TypeScript
- **Shared**: TypeScript package for common types and utilities

## Prerequisites

- Node.js (v18+)
- pnpm (`npm i -g pnpm`)

## Getting Started

1. **Install dependencies**:
   ```bash
   pnpm install
   ```

2. **Set up environment variables** (optional):
   ```bash
   # Client: Set VITE_SOCKET_URL if server is not on localhost:4000
   echo "VITE_SOCKET_URL=http://localhost:4000" > apps/client/.env
   ```

3. **Run development servers**:
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

### Core Synchronization
- **Synchronized video playback** across multiple clients with sub-second accuracy
- **Real-time play/pause/seek** synchronization with sequence numbers to prevent out-of-order events
- **Video URL change** broadcasting with server-side validation
- **Latency compensation** - measures RTT and adjusts playback time for network delays
- **Drift correction** - periodic sync heartbeat (1s interval) ensures clients stay aligned
- **Smart sync thresholds** - different tolerances for self (1.0s) vs. other users (0.3s)

### User Experience
- **Auto-rejoin on reconnect** - seamless recovery from network interruptions
- **Participant list** - real-time display of connected users
- **Last action indicator** - shows who played/paused/seeked
- **Sync delta display** - visual feedback of synchronization accuracy
- **New joiner aggressive sync** - fresh joins get stricter synchronization for first 5 seconds
- **Responsive UI** - mobile-first design with Tailwind CSS

### Security & Validation
- **Username sanitization** - prevents XSS attacks and enforces length limits (max 50 chars)
- **Video ID validation** - server validates YouTube IDs (11 chars, alphanumeric + hyphens/underscores)
- **Rate limiting** - throttles seek events to prevent spam (max 3 per second)
- **Input validation** - comprehensive validation for all user inputs

### Robustness
- **Race condition prevention** - initialization guards prevent duplicate session:init handlers
- **Memory leak prevention** - proper cleanup of event handlers on reconnect
- **Smart seek detection** - ignores buffering/stuttering to prevent false positives (2.0s threshold)
- **Error handling** - YouTube player errors are logged and state is synced back to server

## Deployment

### Client (Vercel/Netlify/Cloudflare Pages)
- Deploy `apps/client` as a static site
- Build command: `pnpm build --filter=@watchparty/client`
- Output directory: `apps/client/dist`
- Set `VITE_SOCKET_URL` environment variable to your server URL

### Server (Render/Railway/Fly.io)
- Deploy `apps/server`
- Build command: `pnpm build --filter=@watchparty/server`
- Start command: `node apps/server/dist/server.js`
- Set `PORT` environment variable (usually auto-set by platform)
- Enable WebSocket support in platform settings

### Notes
- Current implementation uses in-memory state (single instance)
- For multi-instance deployments, consider adding Redis for state synchronization
- Ensure CORS is properly configured for your client domain

## Development

The shared package (`@watchparty/shared`) contains:
- `extractVideoId()` - YouTube URL parser
- `SocketEvents` - Event name constants
- `SessionState` - TypeScript interface

Both client and server import from this shared package to ensure type safety and consistency.

