## Watch Party – Knowledge Transfer Document

This document explains the Watch Party project end-to-end: goals, requirements, architecture, implementation details, limitations, and scaling path.

---

## 1. Problem & Goals

### 1.1 What we are building

**Watch Party** is a small web app that lets multiple people watch a YouTube video in sync across:

- Multiple tabs on the same machine
- Different browsers on the same network (e.g. phone + laptop)
- Eventually, users over the internet (once deployed)

One user can paste a YouTube link, and all connected clients:

- Load the same video
- Start/stop around the same time
- Seek to the same position

The backend acts as an **authoritative source of truth** for playback state.

### 1.2 Functional requirements

- **Single shared “room”** for now:
  - Everyone connected joins the same global session.
  - All users see the same video and playback state.
- **Video selection**:
  - A user can paste any standard YouTube URL or direct video ID.
  - All clients switch to that video.
- **Playback control**:
  - Play, pause, and seek actions on any client are propagated to all others.
  - New joiners catch up to current state.
- **Cross-device support**:
  - Desktop and mobile browsers supported.
  - Works over LAN using IP-based URLs during local development.

### 1.3 Non-functional requirements

- **Consistency first**: prioritize everyone being roughly in sync (within a few hundred ms) over absolute low latency.
- **Simplicity**: single Node process with in-memory state is acceptable for now.
- **Type safety**: full TypeScript across client, server, and shared utilities.
- **Developer experience**:
  - Monorepo with Turborepo + pnpm for easy dev.
  - Tailwind for rapid UI iteration.

---

## 2. High-level Architecture

### 2.1 Monorepo layout

- `apps/client`: React + Vite + TypeScript + Tailwind
- `apps/server`: Express + Socket.io + TypeScript
- `packages/shared`: Shared TypeScript library for:
  - Socket event names
  - Session state types
  - YouTube URL parsing (`extractVideoId`)

Tooling:

- **Package manager**: pnpm (workspaces)
- **Task runner**: Turborepo (`turbo.json`)
- **Build**:
  - Client: Vite
  - Server: `tsc` + `tsx` for dev
- **Styling**: Tailwind CSS v3

### 2.2 Data model (Session State)

The system currently supports **one global shared session**:

- In server memory, we track:

```ts
interface SessionState {
  videoId: string                // YouTube video ID
  playbackTime: number           // last authoritative time (seconds)
  isPlaying: boolean             // whether the canonical session is playing
  lastAction: string             // 'play' | 'pause' | 'seek' | 'changeVideo' | 'init'
  lastActionBy: string           // short client identifier
  seq: number                    // monotonic sequence number, increments on every update
  lastUpdatedAt: number          // timestamp (ms) when state was last updated on the server
}
```

There is no per-user or per-room segmentation yet. All sockets share this one `sessionState`.

### 2.3 Communication pattern

- **Transport**: WebSockets via Socket.io.
- **Pattern**:
  - Clients emit *intent* events (play, pause, seek, changeVideo).
  - Server updates authoritative state and then broadcasts the resulting state/time.
  - Clients **snap** their players toward the authoritative state with tolerances to avoid jitter.

This is deliberately **server-authoritative**:

- Prevents clients drifting independently.
- Makes adding Redis / multi-instance later more straightforward.

---

## 3. Shared Package (`packages/shared`)

Purpose: Keep client and server strictly in sync on **types and event names**.

### 3.1 YouTube URL helper

`extractVideoId(url: string): string | null`

- Accepts:
  - Direct video ID (11-char ID)
  - Standard `youtube.com/watch?v=...`
  - `youtu.be/ID`
  - Embedded URLs
- Returns:
  - Normalized 11-character video ID, or `null` if parsing fails.

This runs **only on the server** when processing `session:changeVideo` to sanitize the input.

### 3.2 Socket events

Shared event names (string literals):

```ts
export const SocketEvents = {
  // Client -> Server
  PLAY: 'session:play',
  PAUSE: 'session:pause',
  SEEK: 'session:seek',
  CHANGE_VIDEO: 'session:changeVideo',

  // Server -> Client (broadcasts)
  INIT: 'session:init',
  PLAY_BROADCAST: 'session:play',
  PAUSE_BROADCAST: 'session:pause',
  SEEK_BROADCAST: 'session:seek',
  VIDEO_CHANGE: 'session:videoChange',
} as const
```

This avoids typos and keeps the event naming consistent across the whole codebase.

### 3.3 SessionState type

Clients and server both import `SessionState` from `@watchparty/shared`, ensuring:

- Consistent shape across boundaries.
- Type-safe access to session properties.

---

## 4. Server (`apps/server`)

### 4.1 Stack & setup

- **Express** for HTTP server wrapper.
- **Socket.io** for real-time events.
- **TypeScript** build via `tsc`.

Key entry file: `apps/server/src/server.ts`.

Setup (simplified):

```ts
const app = express()

// Simple request logger
app.use((req, _res, next) => {
  // logs method, url, origin, host
  next()
})

const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
  },
})

const PORT = process.env.PORT || 4000
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})
```

### 4.2 Authoritative timeline

We maintain a **single session** with:

1. `playbackTime` (seconds) — last known canonical time.
2. `lastUpdatedAt` (ms) — when the server last updated that time.
3. `isPlaying` — whether the timeline is advancing.

Authoritative time is derived as:

```ts
const getAuthoritativeTime = (): number => {
  if (!sessionState.isPlaying) return sessionState.playbackTime

  const now = Date.now()
  const deltaSeconds = (now - sessionState.lastUpdatedAt) / 1000
  return sessionState.playbackTime + deltaSeconds
}
```

Every client event calls `updateSessionState`, which:

- Uses `getAuthoritativeTime()` as baseline.
- Applies the incoming update.
- Increments `seq`.
- Sets `lastUpdatedAt` to `Date.now()`.
- Logs the resulting state.

### 4.3 Socket lifecycle & events

On connection:

- Log connection with origin/referrer.
- Emit `session:init` with full state and up-to-date playback time:

```ts
socket.emit('session:init', {
  ...sessionState,
  playbackTime: getAuthoritativeTime(),
})
```

Event handlers:

#### 4.3.1 `session:play`

Client sends:

```ts
socket.emit('session:play', { time: currentTime })
```

Server:

```ts
socket.on('session:play', (data: { time: number }) => {
  const clientId = socket.id.substring(0, 8)

  updateSessionState({
    isPlaying: true,
    playbackTime: data.time,      // hint
    lastAction: 'play',
    lastActionBy: clientId,
  })

  const time = getAuthoritativeTime()
  io.emit('session:play', {
    time,
    seq: sessionState.seq,
    lastUpdatedAt: sessionState.lastUpdatedAt,
  })
})
```

#### 4.3.2 `session:pause`

Same idea as `play` but sets `isPlaying` to false.

#### 4.3.3 `session:seek`

Client sends a new target time; server updates `playbackTime` and re-broadcasts with derived authoritative time.

#### 4.3.4 `session:changeVideo`

Client sends a YouTube URL/ID:

```ts
socket.emit('session:changeVideo', { videoId })
```

Server:

```ts
socket.on('session:changeVideo', (data: { videoId: string }) => {
  const videoId = extractVideoId(data.videoId) || data.videoId
  if (!videoId) return

  updateSessionState({
    videoId,
    playbackTime: 0,
    isPlaying: false,
    lastAction: 'changeVideo',
    lastActionBy: clientId,
  })

  io.emit('session:videoChange', {
    videoId,
    seq: sessionState.seq,
    lastUpdatedAt: sessionState.lastUpdatedAt,
  })
})
```

### 4.4 Logging & debugging

Server logs:

- HTTP requests (method, URL, origin, host).
- Socket connects/disconnects.
- Each event:
  - `[EVENT] play|pause|seek|changeVideo` with clientId and input time.
- Each broadcast:
  - `[BROADCAST] play|pause|seek|videoChange` with authoritative time/videoId and `seq`.
- Each state update:
  - `[STATE]` with full session state and derived playback time.

This makes it easy to:

- Reconstruct what happened.
- See if clients are sending weird times.
- Validate that `seq` is monotonic.

---

## 5. Client (`apps/client`)

### 5.1 Stack

- **React 18** with TypeScript.
- **Vite** bundler.
- **Tailwind CSS** for UI.
- **React YouTube** for embedding YouTube IFrame Player.
- **Socket.io client** for real-time connection.

### 5.2 Socket connection & state

Key local state:

```ts
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000'

const [socket, setSocket] = useState<Socket | null>(null)
const [sessionState, setSessionState] = useState<SessionState | null>(null)
const [videoUrl, setVideoUrl] = useState('')
const [isSettingVideo, setIsSettingVideo] = useState(false)
const [connectionStatus, setConnectionStatus] =
  useState<'connecting' | 'connected' | 'error'>('connecting')
const [connectionError, setConnectionError] = useState<string | null>(null)

const playerRef = useRef<YT.Player | null>(null)
const lastSeqRef = useRef<number>(0)
```

We track:

- Current `SessionState` (from server).
- Connection health.
- Last seen `seq` to avoid handling stale events.
- The YouTube `Player` instance via `playerRef`.

### 5.3 Socket lifecycle

On mount:

```ts
useEffect(() => {
  const newSocket = io(SOCKET_URL)
  setSocket(newSocket)

  newSocket.on('connect', () => {
    setConnectionStatus('connected')
    setConnectionError(null)
  })

  newSocket.on('connect_error', (err) => {
    setConnectionStatus('error')
    setConnectionError(err.message ?? 'Unable to connect')
  })

  // ...session:init, play, pause, seek, videoChange handlers...

  return () => {
    newSocket.close()
  }
}, [])
```

### 5.4 Handling `session:init`

On first connection or reconnect:

```ts
newSocket.on('session:init', (state: SessionState) => {
  if (typeof state.seq === 'number') {
    lastSeqRef.current = state.seq
  }
  setSessionState(state)

  const player = playerRef.current
  if (state.videoId && player) {
    if (state.isPlaying) player.playVideo()
    else player.pauseVideo()
    player.seekTo(state.playbackTime, true)
  }
})
```

This ensures:

- New joiners get the current video.
- They seek to the current playback time.
- They match play/pause state.

### 5.5 Handling broadcasts with seq + tolerance

For play:

```ts
newSocket.on('session:play', (data: { time: number; seq: number }) => {
  if (data.seq <= lastSeqRef.current) return
  lastSeqRef.current = data.seq

  const player = playerRef.current
  if (player) {
    const localTime = player.getCurrentTime()
    const delta = data.time - localTime
    if (Math.abs(delta) > 0.3) {
      player.seekTo(data.time, true)
    }
    player.playVideo()
  }

  setSessionState(prev => (prev ? { ...prev, isPlaying: true } : null))
})
```

Similar patterns for `pause` and `seek`:

- **Ignore** stale or duplicate events (`seq <= lastSeqRef.current`).
- Apply a **tolerance window** before seeking:
  - Play/Pause: only snap if `|delta| > 0.3s`.
  - Seek: snap if `|delta| > 0.2s`.

This gives:

- Stable playback with minimal jitter.
- Corrections only when clients have meaningfully diverged.

### 5.6 YouTube player integration

We use `react-youtube`:

- `onReady` captures the `YT.Player` instance:

```ts
const onReady = (event: { target: YT.Player }) => {
  playerRef.current = event.target
  if (sessionState) {
    event.target.seekTo(sessionState.playbackTime, true)
    if (sessionState.isPlaying) {
      event.target.playVideo()
    }
  }
}
```

- `onStateChange` interprets YouTube states:

```tsx
onStateChange={(event: YT.PlayerEvent) => {
  // 1 = PLAYING, 2 = PAUSED
  if (event.data === 1) {
    handlePlay()
  } else if (event.data === 2) {
    handlePause()
  }
}}
onSeek={handleSeek}
```

### 5.7 Outgoing client actions

When the user interacts with the local player:

- **Play**:

```ts
const handlePlay = () => {
  const player = playerRef.current
  if (socket && player) {
    const currentTime = player.getCurrentTime()
    socket.emit('session:play', { time: currentTime })
  }
}
```

- **Pause**: similar, emits `session:pause`.
- **Seek**: `onSeek` event from YouTube sends `session:seek`.
- **Change video**:

```ts
const handleVideoChange = () => {
  const videoId = extractVideoId(videoUrl)
  if (videoId && socket) {
    setIsSettingVideo(true)
    socket.emit('session:changeVideo', { videoId })
    setVideoUrl('')
    setTimeout(() => setIsSettingVideo(false), 400)
  }
}
```

---

## 6. UI / UX Considerations

### 6.1 Layout

- Centered layout with:
  - Header: title + description + connection status.
  - Control panel: URL input + “Set video” button + session info chip.
  - Player area: 16:9 video or empty state message.

### 6.2 Connection feedback

- Status pill shows:
  - **Connecting…** (amber)
  - **Connected** (green)
  - **Connection error** (red + message)
- Socket URL is displayed in tiny monospace text (debug-friendly).

### 6.3 Session info

- Shows:
  - Last action (`play`, `pause`, `seek`, `changeVideo`).
  - Who triggered it (short client id).
  - Current `seq` number (for debugging ordering).

### 6.4 Interaction details

- “Set video” button:
  - Disabled if:
    - No URL,
    - Socket not connected,
    - Or video is already being set.
  - Shows subtle “Setting…” state while emitting the event.

---

## 7. Limitations

### 7.1 Single session, single instance

- Only one global session (no rooms/room codes).
- Only one Node.js server process:
  - If it restarts, state is lost.
  - No horizontal scaling.

### 7.2 Approximate sync

- Sync is good enough for casual viewing (~200–400ms).
- We do not:
  - Hard-sync on every frame.
  - Implement advanced clock-sync protocols (e.g. NTP-like).

### 7.3 Network conditions

- High latency or mobile networks can:
  - Cause more aggressive snapping.
  - Introduce buffering that we don’t currently surface as UI warnings.

### 7.4 Browser autoplay policies

- If a browser blocks autoplay:
  - A new joiner might need to click the player before video starts.
  - We don’t yet show a special “Click to join playback” overlay.

---

## 8. Scaling & Future Enhancements

### 8.1 Multi-room support

Introduce a `roomId`:

- Add `roomId` to `sessionState` and separate state per room.
- Map: `roomId -> SessionState`.
- Clients:
  - Join via a URL like `/room/:id`.
  - `socket.join(roomId)` on connect.
- All `io.emit(...)` calls become `io.to(roomId).emit(...)`.

### 8.2 Persistence & multi-instance

To support multiple server instances and persistence:

- Use **Redis**:
  - Store session state in Redis keyed by `roomId`.
  - Use Redis Pub/Sub or the official `socket.io-redis` adapter to fan-out events across instances.
- On each event:
  - One instance becomes the “writer” for a room.
  - It updates Redis and broadcasts.
  - Others receive via Pub/Sub and forward to their local sockets.

### 8.3 Better clock sync

Client-server offset estimation:

- On connect, do several `ping/pong` exchanges:
  - Client sends local timestamp.
  - Server responds with its own timestamp.
  - Client estimates offset = `serverTime - (clientSend + RTT/2)`.
- Use offset to compute a more accurate “expected time” on the client side.

### 8.4 Heartbeats

- Periodic `session:update` broadcast (e.g., every 8–12 seconds) with full state:
  - Allows clients to correct slow drift even without user actions.

### 8.5 Role-based control

Introduce a concept of “host”:

- Only host can change video or seek.
- Others can request changes or just watch.

### 8.6 Observability

- Add structured logs or metrics:
  - Distribution of `delta` between authoritative time and client time.
  - Number of connections per room.
  - Frequency of snapping corrections.

---

## 9. How to Run Locally

From repo root:

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Client env (`apps/client/.env`):

   ```env
   VITE_SOCKET_URL=http://localhost:4000
   ```

3. Server env (`apps/server/.env`):

   ```env
   PORT=4000
   CLIENT_URL=http://localhost:5173
   ```

4. Run dev:

   ```bash
   pnpm dev
   ```

   - Client: `http://localhost:5173`
   - Server: `http://localhost:4000` (Socket.io only, `GET /` shows “Cannot GET /”)

For LAN testing, use your machine’s LAN IP instead of `localhost` in both `VITE_SOCKET_URL` and `CLIENT_URL`.

---

## 10. Summary

- Server holds a **single authoritative timeline** in memory with `playbackTime`, `isPlaying`, `seq`, and `lastUpdatedAt`.
- Clients send **intent** events (`session:play|pause|seek|changeVideo`), server **derives** state and broadcasts updates with seq + time.
- Clients apply **tolerant snapping** and ignore stale events, keeping everyone roughly in sync.
- The monorepo + shared package enforce consistent types and event names across client and server.
- Current design is ideal for a **demo or small room** usage, with a straightforward path to:
  - Multiple rooms,
  - Redis-based state sharing,
  - More precise clock sync, and
  - Richer moderation / UX features.


