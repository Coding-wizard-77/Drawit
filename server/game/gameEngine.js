const config = require("../config");
const {
  getWordChoices,
  getRandomChoice,
  maskWord,
  revealNextLetter
} = require("./wordService");
const {
  sanitizeChat,
  normalizeGuess,
  isValidPoint,
  sanitizeDrawingTool
} = require("../utils/sanitize");
const { createEntityId } = require("../utils/ids");

const ROUND_END_DELAY_MS = 4500;
const MAX_STROKES_PER_TURN = 700;
const MAX_POINTS_PER_PACKET = 24;

function createGameEngine({ io, roomStore }) {
  function getRemaining(room) {
    if (!room.timer?.endsAt) return 0;
    return Math.max(0, Math.ceil((room.timer.endsAt - Date.now()) / 1000));
  }

  function clearTimer(room) {
    if (room.timer?.intervalId) clearInterval(room.timer.intervalId);
    if (room.timer?.timeoutId) clearTimeout(room.timer.timeoutId);
    room.timer = null;
  }

  function clearTransition(room) {
    if (room.transitionTimeoutId) clearTimeout(room.transitionTimeoutId);
    room.transitionTimeoutId = null;
  }

  function emitSystem(room, message, tone = "info") {
    const payload = {
      id: createEntityId("sys"),
      type: "system",
      message,
      tone,
      createdAt: Date.now()
    };

    room.chatHistory.push(payload);
    room.chatHistory = room.chatHistory.slice(-80);
    io.to(room.id).emit("system-message", payload);
  }

  function sortedPlayers(room) {
    return Array.from(room.players.values())
      .map((player) => ({
        id: player.id,
        name: player.name,
        score: player.score,
        isHost: player.id === room.hostId,
        isDrawer: player.id === room.currentDrawerId,
        isSpectator: player.isSpectator,
        connected: player.connected,
        hasGuessed: room.guessed.has(player.id),
        avatarHue: player.avatarHue
      }))
      .sort((a, b) => {
        if (a.isSpectator !== b.isSpectator) return a.isSpectator ? 1 : -1;
        return b.score - a.score || a.name.localeCompare(b.name);
      });
  }

  function buildRoomView(room, viewerId) {
    const viewer = room.players.get(viewerId);
    const isDrawer = room.currentDrawerId === viewerId;
    const activePlayers = roomStore.getActivePlayers(room);
    const currentDrawer = room.players.get(room.currentDrawerId);
    const revealWord = ["round-end", "game-over"].includes(room.state);

    return {
      id: room.id,
      state: room.state,
      hostId: room.hostId,
      round: Math.min(room.round, room.settings.rounds),
      maxRounds: room.settings.rounds,
      maxPlayers: room.settings.maxPlayers,
      minPlayers: room.settings.minPlayers,
      playerCount: activePlayers.length,
      players: sortedPlayers(room),
      currentDrawerId: room.currentDrawerId,
      currentDrawerName: currentDrawer?.name || "",
      wordHint: room.currentWord ? maskWord(room.currentWord, room.revealedIndices) : "",
      wordLength: room.currentWord ? room.currentWord.replace(/\s/g, "").length : 0,
      currentWord: room.currentWord && (isDrawer || revealWord) ? room.currentWord : "",
      currentWordMeta:
        room.currentWord && (isDrawer || revealWord) ? room.currentWordMeta : null,
      timer: {
        phase: room.timer?.phase || null,
        remaining: getRemaining(room),
        duration: room.timer?.duration || 0
      },
      canStart:
        viewer?.id === room.hostId &&
        ["waiting", "game-over"].includes(room.state) &&
        activePlayers.length >= room.settings.minPlayers,
      self: {
        id: viewerId,
        name: viewer?.name || "",
        isHost: viewer?.id === room.hostId,
        isDrawer,
        isSpectator: Boolean(viewer?.isSpectator),
        hasGuessed: room.guessed.has(viewerId)
      }
    };
  }

  function emitRoomState(room) {
    for (const player of room.players.values()) {
      if (player.connected) {
        io.to(player.id).emit("room-state", buildRoomView(room, player.id));
      }
    }
  }

  function sendCanvasHistory(room, socketId = null) {
    const payload = {
      roomId: room.id,
      history: room.drawingHistory
    };

    if (socketId) {
      io.to(socketId).emit("canvas-history", payload);
    } else {
      io.to(room.id).emit("canvas-history", payload);
    }
  }

  function emitTimer(room) {
    io.to(room.id).emit("timer-update", {
      phase: room.timer?.phase || null,
      remaining: getRemaining(room),
      duration: room.timer?.duration || 0
    });
  }

  function maybeRevealHint(room) {
    if (room.state !== "drawing" || !room.currentWord || !room.timer?.duration) return;

    const remaining = getRemaining(room);
    const elapsed = room.timer.duration - remaining;
    const ratio = elapsed / room.timer.duration;
    const targetHints = ratio > 0.72 ? 3 : ratio > 0.5 ? 2 : ratio > 0.28 ? 1 : 0;
    let changed = false;

    while (room.hintsRevealed < targetHints) {
      room.hintsRevealed += 1;
      changed = revealNextLetter(room.currentWord, room.revealedIndices) || changed;
    }

    if (changed) {
      io.to(room.id).emit("word-hint", {
        hint: maskWord(room.currentWord, room.revealedIndices)
      });
      emitRoomState(room);
    }
  }

  function startTimer(room, seconds, phase, onExpire) {
    clearTimer(room);

    room.timer = {
      phase,
      duration: seconds,
      endsAt: Date.now() + seconds * 1000,
      intervalId: null,
      timeoutId: null
    };

    emitTimer(room);

    room.timer.intervalId = setInterval(() => {
      maybeRevealHint(room);
      emitTimer(room);
    }, 1000);

    room.timer.timeoutId = setTimeout(() => {
      clearTimer(room);
      onExpire();
    }, seconds * 1000 + 100);
  }

  function startGame(room, socketId) {
    const player = room.players.get(socketId);
    const activePlayers = roomStore.getActivePlayers(room);

    if (!player || player.id !== room.hostId) {
      io.to(socketId).emit("error-message", "Only the host can start the game.");
      return;
    }

    if (!["waiting", "game-over"].includes(room.state)) {
      io.to(socketId).emit("error-message", "A game is already running.");
      return;
    }

    if (activePlayers.length < room.settings.minPlayers) {
      io.to(socketId).emit("error-message", "At least two players are needed to start.");
      return;
    }

    clearTimer(room);
    clearTransition(room);

    for (const activePlayer of activePlayers) {
      activePlayer.score = 0;
      activePlayer.guessedAt = null;
    }

    room.round = 1;
    room.currentDrawerId = null;
    room.currentWord = null;
    room.currentWordMeta = null;
    room.wordChoices = [];
    room.guessed.clear();
    room.drawingHistory = [];
    room.playerOrder = activePlayers.map((activePlayer) => activePlayer.id);

    emitSystem(room, `${player.name} started the game.`, "success");
    beginNextTurn(room);
  }

  function beginNextTurn(room) {
    clearTimer(room);
    clearTransition(room);

    const activePlayers = roomStore.getActivePlayers(room);
    if (activePlayers.length < room.settings.minPlayers) {
      endGame(room, "Game ended because there are not enough players.");
      return;
    }

    const activeOrder = room.playerOrder.filter((id) =>
      activePlayers.some((player) => player.id === id)
    );

    if (!activeOrder.length) {
      endGame(room, "No active players remain.");
      return;
    }

    let nextIndex = 0;
    if (room.currentDrawerId) {
      const previousIndex = activeOrder.indexOf(room.currentDrawerId);
      nextIndex = previousIndex >= 0 ? previousIndex + 1 : 0;
    }

    if (nextIndex >= activeOrder.length) {
      nextIndex = 0;
      room.round += 1;
    }

    if (room.round > room.settings.rounds) {
      room.round = room.settings.rounds;
      endGame(room, "Final leaderboard");
      return;
    }

    room.state = "choosing";
    room.currentDrawerId = activeOrder[nextIndex];
    room.currentWord = null;
    room.currentWordMeta = null;
    room.wordChoices = getWordChoices(room.settings.wordChoiceCount);
    room.guessed.clear();
    room.revealedIndices = new Set();
    room.hintsRevealed = 0;
    room.drawingHistory = [];

    const drawer = room.players.get(room.currentDrawerId);
    emitSystem(room, `${drawer.name} is choosing a word.`, "info");
    io.to(room.id).emit("next-turn", {
      drawerId: drawer.id,
      drawerName: drawer.name,
      round: room.round
    });
    sendCanvasHistory(room);
    emitRoomState(room);

    io.to(drawer.id).emit("word-options", {
      options: room.wordChoices.map((choice) => ({
        id: choice.id,
        word: choice.word,
        category: choice.category,
        difficulty: choice.difficulty,
        basePoints: choice.basePoints
      }))
    });

    startTimer(room, room.settings.wordChoiceSeconds, "choosing", () => {
      const automaticChoice = getRandomChoice(room.wordChoices);
      beginDrawingTurn(room, automaticChoice);
    });
  }

  function chooseWord(room, socketId, wordId) {
    if (room.state !== "choosing" || room.currentDrawerId !== socketId) {
      io.to(socketId).emit("error-message", "It is not your word choice turn.");
      return;
    }

    const choice = room.wordChoices.find((word) => word.id === wordId);
    if (!choice) {
      io.to(socketId).emit("error-message", "That word option is no longer available.");
      return;
    }

    beginDrawingTurn(room, choice);
  }

  function beginDrawingTurn(room, choice) {
    clearTimer(room);

    room.state = "drawing";
    room.currentWord = choice.word;
    room.currentWordMeta = {
      category: choice.category,
      difficulty: choice.difficulty,
      basePoints: choice.basePoints
    };
    room.guessed.clear();
    room.revealedIndices = new Set();
    room.hintsRevealed = 0;
    room.drawingHistory = [];

    const drawer = room.players.get(room.currentDrawerId);
    emitSystem(room, `${drawer.name} is drawing now.`, "success");
    sendCanvasHistory(room);
    emitRoomState(room);

    startTimer(room, room.settings.turnSeconds, "drawing", () => {
      finishTurn(room, "Time is up.");
    });
  }

  function finishTurn(room, reason) {
    if (!["drawing", "choosing"].includes(room.state)) return;

    clearTimer(room);
    clearTransition(room);

    room.state = "round-end";
    const word = room.currentWord || "unknown";

    io.to(room.id).emit("turn-ended", {
      reason,
      word,
      drawerId: room.currentDrawerId
    });
    emitSystem(room, `${reason} The word was "${word}".`, "warning");
    emitRoomState(room);

    room.transitionTimeoutId = setTimeout(() => {
      beginNextTurn(room);
    }, ROUND_END_DELAY_MS);
  }

  function endGame(room, reason) {
    clearTimer(room);
    clearTransition(room);

    room.state = "game-over";
    room.currentDrawerId = null;
    room.guessed.clear();

    const leaderboard = sortedPlayers(room);
    io.to(room.id).emit("game-over", {
      reason,
      leaderboard
    });
    emitSystem(room, reason, "success");
    emitRoomState(room);
  }

  function handleChat(room, socketId, rawMessage) {
    const player = room.players.get(socketId);
    if (!player || !player.connected) return;

    const now = Date.now();
    const cooldown = room.guessed.has(socketId) ? 1500 : 650;
    if (now - player.lastChatAt < cooldown) {
      io.to(socketId).emit("error-message", "Slow down a touch before sending another message.");
      return;
    }

    const message = sanitizeChat(rawMessage);
    if (!message) return;

    player.lastChatAt = now;

    if (room.state === "drawing") {
      if (socketId === room.currentDrawerId) {
        io.to(socketId).emit("error-message", "Drawers cannot chat while drawing.");
        return;
      }

      if (!player.isSpectator && normalizeGuess(message) === normalizeGuess(room.currentWord)) {
        handleCorrectGuess(room, player);
        return;
      }
    }

    const payload = {
      id: createEntityId("msg"),
      type: "chat",
      playerId: player.id,
      playerName: player.name,
      message,
      createdAt: Date.now()
    };

    room.chatHistory.push(payload);
    room.chatHistory = room.chatHistory.slice(-80);
    io.to(room.id).emit("chat-message", payload);
  }

  function handleCorrectGuess(room, player) {
    if (room.guessed.has(player.id) || player.id === room.currentDrawerId) return;

    const activeGuessers = roomStore
      .getActivePlayers(room)
      .filter((activePlayer) => activePlayer.id !== room.currentDrawerId);

    const remaining = getRemaining(room);
    const base = room.currentWordMeta?.basePoints || 80;
    const speedBonus = Math.round((remaining / room.settings.turnSeconds) * base);
    const scarcityBonus = Math.max(8, (activeGuessers.length - room.guessed.size) * 8);
    const points = base + speedBonus + scarcityBonus;

    room.guessed.add(player.id);
    player.guessedAt = Date.now();
    player.score += points;

    const drawer = room.players.get(room.currentDrawerId);
    const drawerBonus = drawer ? Math.ceil(points * 0.15) : 0;
    if (drawer) drawer.score += drawerBonus;

    io.to(player.id).emit("chat-message", {
      id: createEntityId("msg"),
      type: "private-correct",
      playerId: player.id,
      playerName: player.name,
      message: `Correct! You earned ${points} points.`,
      createdAt: Date.now()
    });

    io.to(room.id).emit("correct-guess", {
      playerId: player.id,
      playerName: player.name,
      points,
      drawerBonus
    });

    emitSystem(room, `${player.name} guessed correctly.`, "success");
    emitRoomState(room);

    if (room.guessed.size >= activeGuessers.length) {
      clearTimer(room);
      room.transitionTimeoutId = setTimeout(() => {
        finishTurn(room, "Everyone guessed the word.");
      }, 1200);
    }
  }

  function handleDrawStart(room, socketId, payload) {
    if (room.state !== "drawing" || room.currentDrawerId !== socketId) return;
    if (!isValidPoint(payload?.point)) return;

    const stroke = {
      id: String(payload.strokeId || createEntityId("stroke")).slice(0, 80),
      drawerId: socketId,
      tool: sanitizeDrawingTool(payload.tool),
      points: [payload.point],
      createdAt: Date.now()
    };

    room.drawingHistory.push(stroke);
    if (room.drawingHistory.length > MAX_STROKES_PER_TURN) room.drawingHistory.shift();

    io.to(room.id).except(socketId).emit("draw-start", {
      stroke
    });
  }

  function handleDrawing(room, socketId, payload) {
    if (room.state !== "drawing" || room.currentDrawerId !== socketId) return;

    const strokeId = String(payload?.strokeId || "");
    const stroke = room.drawingHistory.find(
      (item) => item.id === strokeId && item.drawerId === socketId
    );
    if (!stroke) return;

    const points = Array.isArray(payload.points)
      ? payload.points.filter(isValidPoint).slice(0, MAX_POINTS_PER_PACKET)
      : [];

    if (!points.length) return;

    stroke.points.push(...points);

    io.to(room.id).except(socketId).emit("drawing", {
      strokeId,
      points
    });
  }

  function handleDrawEnd(room, socketId, payload) {
    if (room.state !== "drawing" || room.currentDrawerId !== socketId) return;
    io.to(room.id).except(socketId).emit("draw-end", {
      strokeId: String(payload?.strokeId || "")
    });
  }

  function clearCanvas(room, socketId) {
    const canClear =
      socketId === room.currentDrawerId ||
      (room.players.get(socketId)?.id === room.hostId && room.state === "waiting");

    if (!canClear) return;

    room.drawingHistory = [];
    io.to(room.id).emit("clear-canvas");
    sendCanvasHistory(room);
  }

  function undoStroke(room, socketId) {
    if (room.state !== "drawing" || room.currentDrawerId !== socketId) return;

    for (let index = room.drawingHistory.length - 1; index >= 0; index -= 1) {
      if (room.drawingHistory[index].drawerId === socketId) {
        room.drawingHistory.splice(index, 1);
        sendCanvasHistory(room);
        return;
      }
    }
  }

  function handleDisconnect(room, socketId) {
    const player = roomStore.markDisconnected(room, socketId);
    if (!player) return;

    if (socketId === room.hostId) {
      roomStore.assignNextHost(room);
    }

    const connected = roomStore.getConnectedPlayers(room);
    if (!connected.length) {
      room.emptyTimeoutId = setTimeout(() => {
        roomStore.deleteRoom(room.id);
      }, config.roomIdleDeleteSeconds * 1000);
      return;
    }

    player.cleanupTimeoutId = setTimeout(() => {
      roomStore.removePlayer(room, socketId);
      if (!roomStore.getConnectedPlayers(room).length) {
        roomStore.deleteRoom(room.id);
        return;
      }
      emitRoomState(room);
    }, config.roomIdleDeleteSeconds * 1000);

    emitSystem(room, `${player.name} disconnected.`, "warning");

    if (socketId === room.currentDrawerId && ["choosing", "drawing"].includes(room.state)) {
      emitSystem(room, "The drawer left, so the turn is moving on.", "warning");
      beginNextTurn(room);
      return;
    }

    emitRoomState(room);
  }

  function handleLeave(room, socketId) {
    const player = room.players.get(socketId);
    if (!player) return;

    const wasDrawer = socketId === room.currentDrawerId;
    const playerName = player.name;
    roomStore.removePlayer(room, socketId);

    if (!roomStore.getConnectedPlayers(room).length) {
      roomStore.deleteRoom(room.id);
      return;
    }

    emitSystem(room, `${playerName} left the room.`, "warning");

    if (wasDrawer && ["choosing", "drawing"].includes(room.state)) {
      beginNextTurn(room);
      return;
    }

    if (
      ["choosing", "drawing", "round-end"].includes(room.state) &&
      roomStore.getActivePlayers(room).length < room.settings.minPlayers
    ) {
      endGame(room, "Game ended because there are not enough players.");
      return;
    }

    emitRoomState(room);
  }

  function handleReconnect(room, socketId) {
    if (room.emptyTimeoutId) {
      clearTimeout(room.emptyTimeoutId);
      room.emptyTimeoutId = null;
    }

    const player = room.players.get(socketId);
    if (player) {
      emitSystem(room, `${player.name} reconnected.`, "success");
      sendCanvasHistory(room, socketId);
      io.to(socketId).emit("chat-history", {
        messages: room.chatHistory
      });
      emitRoomState(room);
    }
  }

  function handleJoin(room, socketId) {
    if (room.emptyTimeoutId) {
      clearTimeout(room.emptyTimeoutId);
      room.emptyTimeoutId = null;
    }

    const player = room.players.get(socketId);
    if (!player) return;

    emitSystem(
      room,
      player.isSpectator ? `${player.name} joined as a spectator.` : `${player.name} joined the room.`,
      "info"
    );
    sendCanvasHistory(room, socketId);
    io.to(socketId).emit("chat-history", {
      messages: room.chatHistory
    });
    emitRoomState(room);
  }

  return {
    startGame,
    chooseWord,
    handleChat,
    handleDrawStart,
    handleDrawing,
    handleDrawEnd,
    clearCanvas,
    undoStroke,
    handleJoin,
    handleLeave,
    handleDisconnect,
    handleReconnect,
    emitRoomState,
    sendCanvasHistory,
    buildRoomView
  };
}

module.exports = {
  createGameEngine
};
