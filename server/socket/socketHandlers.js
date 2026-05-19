const { normalizeRoomId, normalizeName } = require("../utils/sanitize");

function registerSocketHandlers({ io, socket, roomStore, gameEngine }) {
  function getSocketRoom() {
    const roomId = socket.data.roomId;
    return roomId ? roomStore.getRoom(roomId) : null;
  }

  function joinSocketRoom(room) {
    socket.join(room.id);
    socket.data.roomId = room.id;
  }

  socket.on("create-room", (payload = {}, ack) => {
    const username = normalizeName(payload.username);
    const clientId = String(payload.clientId || "").slice(0, 80);

    if (!clientId) {
      socket.emit("error-message", "A client id is required.");
      return;
    }

    const { room, player } = roomStore.createRoom({
      socketId: socket.id,
      username,
      clientId
    });

    joinSocketRoom(room);
    socket.emit("room-created", {
      roomId: room.id,
      selfId: player.id
    });
    socket.emit("chat-history", {
      messages: room.chatHistory
    });
    gameEngine.emitRoomState(room);
    gameEngine.sendCanvasHistory(room, socket.id);
    ack?.({ ok: true, roomId: room.id });
  });

  socket.on("join-room", (payload = {}, ack) => {
    const roomId = normalizeRoomId(payload.roomId);
    const username = normalizeName(payload.username);
    const clientId = String(payload.clientId || "").slice(0, 80);
    const room = roomStore.getRoom(roomId);

    if (!room) {
      socket.emit("error-message", "Room not found. Check the room code and try again.");
      ack?.({ ok: false, error: "Room not found" });
      return;
    }

    if (!clientId) {
      socket.emit("error-message", "A client id is required.");
      return;
    }

    const { player, reconnected, oldId } = roomStore.addOrReconnectPlayer(room, {
      socketId: socket.id,
      username,
      clientId
    });

    if (oldId && oldId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(oldId);
      oldSocket?.disconnect(true);
    }

    joinSocketRoom(room);
    socket.emit("room-joined", {
      roomId: room.id,
      selfId: player.id,
      reconnected,
      isSpectator: player.isSpectator
    });

    if (reconnected) {
      gameEngine.handleReconnect(room, socket.id);
    } else {
      gameEngine.handleJoin(room, socket.id);
    }

    ack?.({ ok: true, roomId: room.id });
  });

  socket.on("start-game", () => {
    const room = getSocketRoom();
    if (!room) return;
    gameEngine.startGame(room, socket.id);
  });

  socket.on("choose-word", (payload = {}) => {
    const room = getSocketRoom();
    if (!room) return;
    gameEngine.chooseWord(room, socket.id, payload.wordId);
  });

  socket.on("chat-message", (payload = {}) => {
    const room = getSocketRoom();
    if (!room) return;
    gameEngine.handleChat(room, socket.id, payload.message);
  });

  socket.on("draw-start", (payload = {}) => {
    const room = getSocketRoom();
    if (!room) return;
    gameEngine.handleDrawStart(room, socket.id, payload);
  });

  socket.on("drawing", (payload = {}) => {
    const room = getSocketRoom();
    if (!room) return;
    gameEngine.handleDrawing(room, socket.id, payload);
  });

  socket.on("draw-end", (payload = {}) => {
    const room = getSocketRoom();
    if (!room) return;
    gameEngine.handleDrawEnd(room, socket.id, payload);
  });

  socket.on("clear-canvas", () => {
    const room = getSocketRoom();
    if (!room) return;
    gameEngine.clearCanvas(room, socket.id);
  });

  socket.on("undo-drawing", () => {
    const room = getSocketRoom();
    if (!room) return;
    gameEngine.undoStroke(room, socket.id);
  });

  socket.on("canvas-resync-request", () => {
    const room = getSocketRoom();
    if (!room) return;
    gameEngine.sendCanvasHistory(room, socket.id);
  });

  socket.on("leave-room", (_payload = {}, ack) => {
    const room = getSocketRoom();
    if (!room) {
      ack?.({ ok: true });
      return;
    }

    gameEngine.handleLeave(room, socket.id);
    socket.leave(room.id);
    socket.data.roomId = null;
    ack?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const room = getSocketRoom();
    if (!room) return;
    gameEngine.handleDisconnect(room, socket.id);
  });
}

module.exports = {
  registerSocketHandlers
};
