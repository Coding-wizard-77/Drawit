const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");
const config = require("./config");
const { RoomStore } = require("./rooms/roomStore");
const { createGameEngine } = require("./game/gameEngine");
const { registerSocketHandlers } = require("./socket/socketHandlers");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: config.clientOrigin === "*" ? true : config.clientOrigin,
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e6,
  pingTimeout: 25000,
  pingInterval: 10000
});

const clientPath = path.join(__dirname, "..", "client");
const roomStore = new RoomStore();
const gameEngine = createGameEngine({ io, roomStore });

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(express.static(clientPath));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    rooms: roomStore.count()
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(clientPath, "index.html"));
});

io.on("connection", (socket) => {
  registerSocketHandlers({ io, socket, roomStore, gameEngine });
});

server.listen(config.port, () => {
  console.log(`DrawIt server listening on http://localhost:${config.port}`);
});
