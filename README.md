# DrawIt

DrawIt is a production-ready starter for a realtime multiplayer drawing-and-guessing game inspired by Skribbl.io, Gartic.io, and Drawize. It uses Node.js, Express, Socket.IO, vanilla JavaScript, and the HTML5 Canvas API.

## Features

- Private room creation and room-code joining
- Server-authoritative rooms, turns, timers, scoring, and word validation
- Smooth realtime whiteboard with mouse, pen, and touch support
- Batched drawing packets using normalized canvas coordinates
- Brush color, brush size, eraser, clear canvas, and undo
- Word choices for the drawer, hidden word hints for guessers
- Realtime chat with correct-guess detection and sanitized messages
- Live player list, host migration, reconnect grace, and final leaderboard
- Responsive dark game UI for desktop, tablet, and mobile

## Folder Structure

```text
drawit/
  client/
    css/
      styles.css
    js/
      home.js
      room.js
    index.html
    room.html
  server/
    data/
      words.json
    game/
      gameEngine.js
      wordService.js
    rooms/
      roomStore.js
    socket/
      socketHandlers.js
    utils/
      ids.js
      sanitize.js
    config.js
    server.js
  .env.example
  package.json
  README.md
```

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env` instead of `cp` if needed.

Open `http://localhost:3000`.

For production:

```bash
npm install --omit=dev
npm start
```

## Environment Variables

- `PORT`: HTTP and Socket.IO port. Default: `3000`.
- `NODE_ENV`: `development` or `production`.
- `CLIENT_ORIGIN`: allowed browser origin for Socket.IO CORS. Use your deployed frontend URL in production.
- `MAX_PLAYERS_PER_ROOM`: active player cap before joins become spectators.
- `DEFAULT_ROUNDS`: number of rounds per game.
- `TURN_SECONDS`: drawing turn length.
- `WORD_CHOICE_SECONDS`: drawer word-pick timer.
- `ROOM_IDLE_DELETE_SECONDS`: reconnect grace and empty-room cleanup window.

## Socket Event Architecture

Client to server:

- `create-room`: creates a private room and assigns host.
- `join-room`: joins or reconnects to an existing room.
- `start-game`: host starts or restarts a game.
- `choose-word`: drawer selects one of the server-provided choices.
- `draw-start`: drawer begins a stroke.
- `drawing`: drawer sends batched normalized points.
- `draw-end`: drawer completes a stroke.
- `clear-canvas`: drawer clears the current board.
- `undo-drawing`: drawer removes their latest stroke.
- `chat-message`: player sends chat or a guess.
- `canvas-resync-request`: client asks for authoritative drawing history.

Server to client:

- `room-state`: personalized room snapshot without leaking the answer to guessers.
- `word-options`: private word choices sent only to the drawer.
- `timer-update`: server-authoritative countdown.
- `word-hint`: masked word updates as letters are revealed.
- `canvas-history`: authoritative stroke history for redraws and reconnects.
- `draw-start`, `drawing`, `draw-end`: realtime drawing relay to other clients.
- `chat-message`, `system-message`: chat stream.
- `correct-guess`: public correct-guess signal without exposing the word.
- `next-turn`, `turn-ended`, `game-over`: gameplay transitions.
- `error-message`: safe user-facing validation errors.

## How Realtime Synchronization Works

The server owns the room state. Browsers send intents: draw this stroke, send this guess, start this game. The server validates the sender, room, turn, and payload before broadcasting updates. Clients render the latest `room-state`, `timer-update`, drawing packets, and chat messages.

For drawing, the client sends normalized points between `0` and `1`, not raw pixels. That means every browser can redraw the same stroke correctly even if its canvas has a different size or device pixel ratio.

## How Socket.IO Rooms Work Here

Each game room uses a Socket.IO room with the same code shown in the UI, such as `AB12CD`. When a socket joins, the server calls `socket.join(room.id)`. Broadcasts like `io.to(room.id).emit(...)` reach only players in that room, which allows many games to run at once in one Node process.

## How Drawing Interpolation Works

The canvas client stores strokes as ordered points. When rendering, it converts normalized points back into canvas coordinates and draws rounded quadratic curves through midpoints. This creates smoother lines than simple point-to-point segments. Local strokes render immediately, while Socket.IO packets are batched about every 35ms to reduce network spam.

## Multiplayer State Management

`server/rooms/roomStore.js` owns room and player containers. `server/game/gameEngine.js` owns gameplay transitions:

- waiting room
- word choosing
- drawing turn
- round end
- game over

The engine also owns timers, scoring, word hints, disconnect handling, drawing history, and personalized room snapshots. Clients never submit scores or the current word.

## Scoring

Correct guesses earn:

- difficulty base points
- speed bonus based on remaining server timer
- scarcity bonus based on how many guessers are still solving

The drawer gets a small bonus when others guess correctly.

## Security Notes

This project includes baseline protections:

- chat and usernames are sanitized
- drawing events are accepted only from the active drawer
- scoring happens only on the server
- guesses are checked only on the server
- room IDs and point payloads are validated
- oversized drawing batches are clipped

For a public deployment, add persistent rate limiting, stronger profanity filtering, abuse reporting, and authentication.

## Deployment

### Render or Railway

Use a Node service:

- Build command: `npm install`
- Start command: `npm start`
- Set `NODE_ENV=production`
- Set `CLIENT_ORIGIN` to your deployed app URL

Both Render and Railway support WebSockets on normal web services.

### VPS

Run with a process manager such as PM2:

```bash
npm install --omit=dev
PORT=3000 NODE_ENV=production npm start
```

Put Nginx or Caddy in front of the app and make sure WebSocket upgrade headers are passed through.

### Vercel Frontend Plus Node Backend

The current app serves the frontend from Express, which is simplest. If you split the frontend to Vercel, deploy the `client/` folder as static files and deploy `server/` to Render, Railway, Fly.io, or a VPS. Then update the Socket.IO connection URL in `client/js/room.js` and set `CLIENT_ORIGIN` on the backend.

## Scaling With Redis and Multiple Servers

Socket.IO rooms are in-memory by default, so one Node process knows only about its own sockets. To scale horizontally:

1. Move room/game state into Redis or a database.
2. Add `@socket.io/redis-adapter` so events can broadcast across Node instances.
3. Use sticky sessions at the load balancer, or ensure all socket operations work through the adapter.
4. Store timers in a shared scheduler or elect one authoritative worker per room.
5. Persist finished games and moderation logs separately from volatile drawing data.

For the next iteration, the cleanest path is to extract `RoomStore` behind an interface, then add a Redis-backed implementation while keeping the socket handlers and game engine mostly unchanged.
