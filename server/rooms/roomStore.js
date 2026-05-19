const config = require("../config");
const { createRoomId } = require("../utils/ids");
const { normalizeName } = require("../utils/sanitize");

function createRoomSettings() {
  return {
    maxPlayers: config.maxPlayersPerRoom,
    minPlayers: 2,
    rounds: config.defaultRounds,
    turnSeconds: config.turnSeconds,
    wordChoiceSeconds: config.wordChoiceSeconds,
    wordChoiceCount: 3
  };
}

function createPlayer({ socketId, username, clientId, isHost = false, isSpectator = false }) {
  return {
    id: socketId,
    clientId,
    name: normalizeName(username),
    score: 0,
    isHost,
    isSpectator,
    connected: true,
    joinedAt: Date.now(),
    disconnectedAt: null,
    guessedAt: null,
    lastChatAt: 0,
    cleanupTimeoutId: null,
    avatarHue: Math.floor(Math.random() * 360)
  };
}

class RoomStore {
  constructor() {
    this.rooms = new Map();
  }

  count() {
    return this.rooms.size;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  createRoom({ socketId, username, clientId }) {
    const roomId = createRoomId(new Set(this.rooms.keys()));
    const room = {
      id: roomId,
      hostId: socketId,
      players: new Map(),
      playerOrder: [],
      state: "waiting",
      settings: createRoomSettings(),
      round: 0,
      currentDrawerId: null,
      currentWord: null,
      currentWordMeta: null,
      wordChoices: [],
      guessed: new Set(),
      drawingHistory: [],
      chatHistory: [],
      revealedIndices: new Set(),
      hintsRevealed: 0,
      timer: null,
      transitionTimeoutId: null,
      emptyTimeoutId: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    const host = createPlayer({
      socketId,
      username,
      clientId,
      isHost: true,
      isSpectator: false
    });

    room.players.set(socketId, host);
    room.playerOrder.push(socketId);
    this.rooms.set(roomId, room);
    return { room, player: host };
  }

  addOrReconnectPlayer(room, { socketId, username, clientId }) {
    const existing = this.findPlayerByClientId(room, clientId);

    if (existing) {
      const oldId = existing.id;
      const oldCleanup = existing.cleanupTimeoutId;
      if (oldCleanup) clearTimeout(oldCleanup);

      room.players.delete(oldId);
      existing.id = socketId;
      existing.name = normalizeName(username || existing.name);
      existing.connected = true;
      existing.disconnectedAt = null;
      existing.cleanupTimeoutId = null;

      room.players.set(socketId, existing);
      room.playerOrder = room.playerOrder.map((id) => (id === oldId ? socketId : id));

      if (room.hostId === oldId) room.hostId = socketId;
      if (room.currentDrawerId === oldId) room.currentDrawerId = socketId;
      if (room.guessed.has(oldId)) {
        room.guessed.delete(oldId);
        room.guessed.add(socketId);
      }

      for (const stroke of room.drawingHistory) {
        if (stroke.drawerId === oldId) stroke.drawerId = socketId;
      }

      this.touch(room);
      return { player: existing, reconnected: true, oldId };
    }

    const connectedPlayers = this.getConnectedPlayers(room).filter((player) => !player.isSpectator);
    const isSpectator =
      connectedPlayers.length >= room.settings.maxPlayers || room.state !== "waiting";

    const player = createPlayer({
      socketId,
      username,
      clientId,
      isHost: false,
      isSpectator
    });

    room.players.set(socketId, player);
    if (!isSpectator) {
      room.playerOrder.push(socketId);
    }

    this.touch(room);
    return { player, reconnected: false, oldId: null };
  }

  markDisconnected(room, socketId) {
    const player = room.players.get(socketId);
    if (!player) return null;

    player.connected = false;
    player.disconnectedAt = Date.now();
    this.touch(room);
    return player;
  }

  removePlayer(room, socketId) {
    const player = room.players.get(socketId);
    if (!player) return null;

    if (player.cleanupTimeoutId) clearTimeout(player.cleanupTimeoutId);
    room.players.delete(socketId);
    room.playerOrder = room.playerOrder.filter((id) => id !== socketId);
    room.guessed.delete(socketId);

    if (room.hostId === socketId) {
      this.assignNextHost(room);
    }

    this.touch(room);
    return player;
  }

  assignNextHost(room) {
    const nextHost =
      this.getConnectedPlayers(room).find((player) => !player.isSpectator) ||
      this.getConnectedPlayers(room)[0] ||
      null;

    room.hostId = nextHost?.id || null;
    for (const player of room.players.values()) {
      player.isHost = player.id === room.hostId;
    }
  }

  getConnectedPlayers(room) {
    return Array.from(room.players.values()).filter((player) => player.connected);
  }

  getActivePlayers(room) {
    return this.getConnectedPlayers(room).filter((player) => !player.isSpectator);
  }

  findPlayerByClientId(room, clientId) {
    if (!clientId) return null;
    return Array.from(room.players.values()).find((player) => player.clientId === clientId) || null;
  }

  deleteRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    if (room.timer?.intervalId) clearInterval(room.timer.intervalId);
    if (room.timer?.timeoutId) clearTimeout(room.timer.timeoutId);
    if (room.transitionTimeoutId) clearTimeout(room.transitionTimeoutId);
    if (room.emptyTimeoutId) clearTimeout(room.emptyTimeoutId);

    for (const player of room.players.values()) {
      if (player.cleanupTimeoutId) clearTimeout(player.cleanupTimeoutId);
    }

    return this.rooms.delete(roomId);
  }

  touch(room) {
    room.updatedAt = Date.now();
  }
}

module.exports = {
  RoomStore
};
