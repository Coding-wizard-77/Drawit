const $ = (selector) => document.querySelector(selector);

const elements = {
  roomCodeLabel: $("#roomCodeLabel"),
  copyRoomBtn: $("#copyRoomBtn"),
  wordLabel: $("#wordLabel"),
  roundLabel: $("#roundLabel"),
  timerWidget: $("#timerWidget"),
  timerText: $("#timerText"),
  roomStatus: $("#roomStatus"),
  playerCount: $("#playerCount"),
  playerList: $("#playerList"),
  startGameBtn: $("#startGameBtn"),
  leaveRoomBtn: $("#leaveRoomBtn"),
  canvas: $("#drawingCanvas"),
  canvasOverlay: $("#canvasOverlay"),
  overlayTitle: $("#overlayTitle"),
  overlayText: $("#overlayText"),
  colorPicker: $("#colorPicker"),
  brushSize: $("#brushSize"),
  brushSizeLabel: $("#brushSizeLabel"),
  eraserBtn: $("#eraserBtn"),
  undoBtn: $("#undoBtn"),
  clearBtn: $("#clearBtn"),
  chatMessages: $("#chatMessages"),
  chatForm: $("#chatForm"),
  chatInput: $("#chatInput"),
  wordModal: $("#wordModal"),
  wordOptions: $("#wordOptions"),
  scoreModal: $("#scoreModal"),
  finalScores: $("#finalScores"),
  closeScoreBtn: $("#closeScoreBtn"),
  turnBanner: $("#turnBanner"),
  toastStack: $("#toastStack")
};

const params = new URLSearchParams(window.location.search);
const BACKEND_URL = "https://drawit-6s0s.onrender.com";
const joinMode = params.get("mode") || "join";
const initialRoomId = (params.get("room") || "").toUpperCase();
const username = (params.get("name") || localStorage.getItem("drawit:username") || "Player").slice(
  0,
  18
);

const state = {
  socket: null,
  selfId: null,
  roomId: initialRoomId,
  room: null,
  history: [],
  strokes: new Map(),
  isDrawing: false,
  activeStrokeId: null,
  pendingPoints: [],
  flushTimer: null,
  canvasOverlayTimer: null,
  canvasOverlayPromptKey: null,
  canvasOverlayAutoHidden: false,
  currentMode: "brush",
  drawingEnabled: false
};

function getClientId() {
  const key = "drawit:client-id";
  let clientId = localStorage.getItem(key);
  if (!clientId) {
    clientId =
      crypto.randomUUID?.() || `client_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(key, clientId);
  }
  return clientId;
}

function showToast(message, tone = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${tone}`;
  toast.textContent = message;
  elements.toastStack.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function showTurnBanner(message) {
  elements.turnBanner.textContent = message;
  elements.turnBanner.classList.remove("hidden");
  setTimeout(() => elements.turnBanner.classList.add("hidden"), 2500);
}

function updateUrl(roomId) {
  const nextParams = new URLSearchParams({
    mode: "join",
    room: roomId,
    name: username
  });
  window.history.replaceState({}, "", `/room.html?${nextParams.toString()}`);
}

function connect() {
  state.socket = io(BACKEND_URL, {
    transports: ["websocket"]
  });

  state.socket.on("connect", () => {
    const payload = {
      username,
      roomId: state.roomId,
      clientId: getClientId()
    };

    if (joinMode === "create" && !state.roomId) {
      state.socket.emit("create-room", payload);
    } else {
      state.socket.emit("join-room", payload);
    }
  });

  state.socket.on("room-created", ({ roomId, selfId }) => {
    state.roomId = roomId;
    state.selfId = selfId;
    updateUrl(roomId);
    showToast(`Room ${roomId} created`, "success");
  });

  state.socket.on("room-joined", ({ roomId, selfId, reconnected, isSpectator }) => {
    state.roomId = roomId;
    state.selfId = selfId;
    updateUrl(roomId);
    showToast(reconnected ? "Reconnected to room" : "Joined room", "success");
    if (isSpectator) showToast("You joined as a spectator for this game.", "info");
  });

  state.socket.on("room-state", renderRoom);
  state.socket.on("timer-update", renderTimer);
  state.socket.on("word-hint", ({ hint }) => {
    if (state.room && !state.room.self.isDrawer) elements.wordLabel.textContent = hint;
  });
  state.socket.on("word-options", showWordOptions);
  state.socket.on("chat-history", ({ messages }) => {
    elements.chatMessages.innerHTML = "";
    messages.forEach(appendChatMessage);
  });
  state.socket.on("chat-message", appendChatMessage);
  state.socket.on("system-message", appendChatMessage);
  state.socket.on("correct-guess", handleCorrectGuess);
  state.socket.on("next-turn", ({ drawerName, round }) => {
    showTurnBanner(`Round ${round}: ${drawerName} is up`);
  });
  state.socket.on("turn-ended", ({ word }) => {
    showToast(`The word was ${word}`, "warning");
  });
  state.socket.on("game-over", showGameOver);
  state.socket.on("canvas-history", ({ history }) => loadCanvasHistory(history || []));
  state.socket.on("draw-start", ({ stroke }) => addRemoteStroke(stroke));
  state.socket.on("drawing", ({ strokeId, points }) => appendRemotePoints(strokeId, points));
  state.socket.on("draw-end", () => {});
  state.socket.on("clear-canvas", () => {
    state.history = [];
    state.strokes.clear();
    redrawCanvas();
  });
  state.socket.on("error-message", (message) => showToast(message, "danger"));
  state.socket.on("disconnect", () => showToast("Connection lost. Reconnecting...", "warning"));
}

function renderRoom(room) {
  state.room = room;
  state.selfId = room.self.id;
  state.roomId = room.id;

  elements.roomCodeLabel.textContent = room.id;
  const visibleRound = Math.min(room.round || 0, room.maxRounds || 0);
  elements.roundLabel.textContent = `${visibleRound}/${room.maxRounds || 0}`;
  elements.playerCount.textContent = `${room.playerCount}/${room.maxPlayers}`;
  elements.startGameBtn.disabled = !room.canStart;
  elements.startGameBtn.textContent = room.state === "game-over" ? "Restart Game" : "Start Game";

  const statusMap = {
    waiting: "Waiting room",
    choosing: `${room.currentDrawerName} choosing`,
    drawing: `${room.currentDrawerName} drawing`,
    "round-end": "Turn results",
    "game-over": "Game over"
  };
  elements.roomStatus.textContent = statusMap[room.state] || "Room";

  renderWord(room);
  renderTimer(room.timer);
  renderPlayers(room.players);
  updateCanvasAccess(room);
  updateChatAccess(room);

  if (!(room.state === "choosing" && room.self.isDrawer)) {
    hideWordOptions();
  }
}

function renderWord(room) {
  if (room.currentWord) {
    elements.wordLabel.textContent = room.currentWord.toUpperCase();
    return;
  }

  if (room.wordHint) {
    elements.wordLabel.textContent = room.wordHint;
    return;
  }

  if (room.state === "choosing") {
    elements.wordLabel.textContent = room.self.isDrawer ? "Pick a word" : "Word incoming";
    return;
  }

  elements.wordLabel.textContent = "Waiting for players";
}

function renderTimer(timer = {}) {
  const remaining = timer.remaining || 0;
  const duration = timer.duration || 0;
  const progress = duration ? Math.max(0, Math.min(1, remaining / duration)) : 0;
  elements.timerWidget.style.setProperty("--progress", `${progress * 360}deg`);
  elements.timerText.textContent = duration ? String(remaining).padStart(2, "0") : "--";
}

function renderPlayers(players) {
  elements.playerList.innerHTML = "";

  players.forEach((player, index) => {
    const item = document.createElement("article");
    item.className = `player-card ${player.id === state.selfId ? "self" : ""} ${
      player.connected ? "" : "offline"
    }`;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.style.setProperty("--hue", player.avatarHue);
    avatar.textContent = player.name.slice(0, 1).toUpperCase();

    const meta = document.createElement("div");
    meta.className = "player-meta";

    const name = document.createElement("strong");
    name.textContent = player.name;

    const badges = document.createElement("span");
    badges.className = "player-badges";
    badges.textContent = [
      player.isHost ? "Host" : "",
      player.isDrawer ? "Drawing" : "",
      player.hasGuessed ? "Guessed" : "",
      player.isSpectator ? "Spectator" : "",
      !player.connected ? "Offline" : ""
    ]
      .filter(Boolean)
      .join(" - ");

    meta.append(name, badges);

    const score = document.createElement("div");
    score.className = "score";
    score.innerHTML = `<span>#${index + 1}</span><strong>${player.score}</strong>`;

    item.append(avatar, meta, score);
    elements.playerList.appendChild(item);
  });
}

function updateCanvasAccess(room) {
  state.drawingEnabled = room.self.isDrawer && room.state === "drawing";

  elements.colorPicker.disabled = !state.drawingEnabled;
  elements.brushSize.disabled = !state.drawingEnabled;
  elements.eraserBtn.disabled = !state.drawingEnabled;
  elements.undoBtn.disabled = !state.drawingEnabled;
  elements.clearBtn.disabled = !state.drawingEnabled;

  if (state.drawingEnabled) {
    clearCanvasOverlayAutoHide();
    elements.canvasOverlay.classList.add("hidden");
    elements.overlayTitle.textContent = "";
    elements.overlayText.textContent = "";
    return;
  }

  if (room.state === "drawing") {
    elements.overlayTitle.textContent = room.self.hasGuessed ? "Correct guess" : "Guess the word";
    elements.overlayText.textContent = room.self.hasGuessed
      ? "Nice work. Watch the rest of the turn play out."
      : "Use the chat to submit your guess.";
    showTemporaryCanvasOverlay(
      `${room.id}:${room.round}:${room.currentDrawerId}:${room.self.hasGuessed ? "guessed" : "guessing"}`
    );
  } else if (room.state === "choosing") {
    clearCanvasOverlayAutoHide();
    elements.canvasOverlay.classList.remove("hidden");
    elements.overlayTitle.textContent = `${room.currentDrawerName} is choosing`;
    elements.overlayText.textContent = "The timer starts when a word is selected.";
  } else if (room.state === "game-over") {
    clearCanvasOverlayAutoHide();
    elements.canvasOverlay.classList.remove("hidden");
    elements.overlayTitle.textContent = "Game over";
    elements.overlayText.textContent = "The host can restart from the lobby.";
  } else {
    clearCanvasOverlayAutoHide();
    elements.canvasOverlay.classList.remove("hidden");
    elements.overlayTitle.textContent = "Waiting room";
    elements.overlayText.textContent = "The host can start once two players join.";
  }
}

function clearCanvasOverlayAutoHide() {
  if (state.canvasOverlayTimer) {
    clearTimeout(state.canvasOverlayTimer);
    state.canvasOverlayTimer = null;
  }

  state.canvasOverlayPromptKey = null;
  state.canvasOverlayAutoHidden = false;
}

function showTemporaryCanvasOverlay(promptKey) {
  if (state.canvasOverlayPromptKey !== promptKey) {
    if (state.canvasOverlayTimer) clearTimeout(state.canvasOverlayTimer);
    state.canvasOverlayPromptKey = promptKey;
    state.canvasOverlayAutoHidden = false;
    elements.canvasOverlay.classList.remove("hidden");
    state.canvasOverlayTimer = setTimeout(() => {
      if (state.canvasOverlayPromptKey !== promptKey) return;
      state.canvasOverlayTimer = null;
      state.canvasOverlayAutoHidden = true;
      elements.canvasOverlay.classList.add("hidden");
    }, 3000);
    return;
  }

  elements.canvasOverlay.classList.toggle("hidden", state.canvasOverlayAutoHidden);
}

function updateChatAccess(room) {
  const isDrawingDrawer = room.self.isDrawer && room.state === "drawing";
  elements.chatInput.disabled = isDrawingDrawer;
  elements.chatInput.placeholder = isDrawingDrawer
    ? "Drawers cannot chat this turn"
    : room.state === "drawing"
      ? "Type a guess..."
      : "Send a message...";
}

function appendChatMessage(payload) {
  const message = document.createElement("div");
  message.className = `chat-line ${payload.type || "chat"} ${payload.tone || ""}`;

  if (payload.type === "chat") {
    const name = document.createElement("strong");
    name.textContent = payload.playerName;
    const text = document.createElement("span");
    text.innerHTML = payload.message;
    message.append(name, text);
  } else {
    message.textContent = payload.message;
  }

  elements.chatMessages.appendChild(message);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function handleCorrectGuess(payload) {
  appendChatMessage({
    type: "system",
    tone: "success",
    message: `${payload.playerName} guessed correctly (+${payload.points})`
  });
  showToast(`${payload.playerName} scored ${payload.points}`, "success");
}

function showWordOptions({ options }) {
  elements.wordOptions.innerHTML = "";
  options.forEach((option) => {
    const button = document.createElement("button");
    button.className = "word-option";
    button.type = "button";
    button.innerHTML = `
      <strong>${option.word}</strong>
      <span>${option.category} - ${option.difficulty} - ${option.basePoints} base</span>
    `;
    button.addEventListener("click", () => {
      state.socket.emit("choose-word", { wordId: option.id });
      hideWordOptions();
    });
    elements.wordOptions.appendChild(button);
  });
  elements.wordModal.classList.remove("hidden");
}

function hideWordOptions() {
  elements.wordModal.classList.add("hidden");
}

function showGameOver({ leaderboard }) {
  elements.finalScores.innerHTML = "";
  leaderboard.forEach((player, index) => {
    const row = document.createElement("div");
    row.className = "final-score-row";
    row.innerHTML = `<span>#${index + 1}</span><strong></strong><em>${player.score}</em>`;
    row.querySelector("strong").textContent = player.name;
    elements.finalScores.appendChild(row);
  });
  elements.scoreModal.classList.remove("hidden");
}

function setupCanvas() {
  const ctx = elements.canvas.getContext("2d", { alpha: true });

  function canvasSize() {
    const rect = elements.canvas.getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height
    };
  }

  function resizeCanvas() {
    const { width, height } = canvasSize();
    const dpr = window.devicePixelRatio || 1;
    elements.canvas.width = Math.max(1, Math.floor(width * dpr));
    elements.canvas.height = Math.max(1, Math.floor(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawCanvas();
  }

  function toPoint(event) {
    const rect = elements.canvas.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
    };
  }

  function distance(a, b) {
    if (!a || !b) return 1;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function flushDrawing() {
    if (!state.activeStrokeId || !state.pendingPoints.length) return;
    const points = state.pendingPoints.splice(0, state.pendingPoints.length);
    state.socket.emit("drawing", {
      strokeId: state.activeStrokeId,
      points
    });
  }

  function scheduleFlush() {
    if (state.flushTimer) return;
    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;
      flushDrawing();
    }, 35);
  }

  elements.canvas.addEventListener("pointerdown", (event) => {
    if (!state.drawingEnabled) return;

    event.preventDefault();
    elements.canvas.setPointerCapture(event.pointerId);
    const point = toPoint(event);
    const strokeId = crypto.randomUUID?.() || `stroke_${Date.now()}`;
    const stroke = {
      id: strokeId,
      drawerId: state.selfId,
      tool: getTool(),
      points: [point],
      createdAt: Date.now()
    };

    state.isDrawing = true;
    state.activeStrokeId = strokeId;
    state.pendingPoints = [];
    state.history.push(stroke);
    state.strokes.set(strokeId, stroke);
    drawStrokeSegment(stroke, 0);

    state.socket.emit("draw-start", {
      strokeId,
      point,
      tool: stroke.tool
    });
  });

  elements.canvas.addEventListener("pointermove", (event) => {
    if (!state.isDrawing || !state.drawingEnabled) return;

    event.preventDefault();
    const stroke = state.strokes.get(state.activeStrokeId);
    const point = toPoint(event);
    const last = stroke.points[stroke.points.length - 1];
    if (distance(last, point) < 0.0018) return;

    const startIndex = stroke.points.length;
    stroke.points.push(point);
    state.pendingPoints.push(point);
    drawStrokeSegment(stroke, startIndex);
    scheduleFlush();
  });

  function stopDrawing(event) {
    if (!state.isDrawing) return;
    event?.preventDefault();
    flushDrawing();
    state.socket.emit("draw-end", {
      strokeId: state.activeStrokeId
    });
    state.isDrawing = false;
    state.activeStrokeId = null;
    state.pendingPoints = [];
  }

  elements.canvas.addEventListener("pointerup", stopDrawing);
  elements.canvas.addEventListener("pointercancel", stopDrawing);
  window.addEventListener("resize", resizeCanvas);
  window.visualViewport?.addEventListener("resize", resizeCanvas);

  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(elements.canvas.parentElement);
  }

  resizeCanvas();
}

function getTool() {
  return {
    color: elements.colorPicker.value,
    size: Number(elements.brushSize.value),
    mode: state.currentMode
  };
}

function drawStrokeSegment(stroke, startIndex = 0) {
  const ctx = elements.canvas.getContext("2d");
  const rect = elements.canvas.getBoundingClientRect();
  const points = stroke.points.slice(Math.max(0, startIndex - 1));

  if (!points.length) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke.tool.size;
  ctx.strokeStyle = stroke.tool.color;
  ctx.fillStyle = stroke.tool.color;
  ctx.globalCompositeOperation = stroke.tool.mode === "eraser" ? "destination-out" : "source-over";

  const first = points[0];
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(first.x * rect.width, first.y * rect.height, stroke.tool.size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(first.x * rect.width, first.y * rect.height);

  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = ((current.x + next.x) / 2) * rect.width;
    const midY = ((current.y + next.y) / 2) * rect.height;
    ctx.quadraticCurveTo(current.x * rect.width, current.y * rect.height, midX, midY);
  }

  const last = points[points.length - 1];
  ctx.lineTo(last.x * rect.width, last.y * rect.height);
  ctx.stroke();
  ctx.restore();
}

function redrawCanvas() {
  const ctx = elements.canvas.getContext("2d");
  const rect = elements.canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
  state.history.forEach((stroke) => drawStrokeSegment(stroke, 0));
}

function loadCanvasHistory(history) {
  state.history = history;
  state.strokes = new Map(history.map((stroke) => [stroke.id, stroke]));
  redrawCanvas();
}

function addRemoteStroke(stroke) {
  state.history.push(stroke);
  state.strokes.set(stroke.id, stroke);
  drawStrokeSegment(stroke, 0);
}

function appendRemotePoints(strokeId, points) {
  const stroke = state.strokes.get(strokeId);
  if (!stroke) {
    state.socket.emit("canvas-resync-request");
    return;
  }

  const startIndex = stroke.points.length;
  stroke.points.push(...points);
  drawStrokeSegment(stroke, startIndex);
}

elements.startGameBtn.addEventListener("click", () => {
  state.socket.emit("start-game");
});

function leaveRoom() {
  const goHome = () => {
    window.location.href = "/";
  };

  if (!state.socket?.connected) {
    goHome();
    return;
  }

  let navigated = false;
  const finish = () => {
    if (navigated) return;
    navigated = true;
    state.socket.disconnect();
    goHome();
  };

  state.socket.emit("leave-room", {}, finish);
  setTimeout(finish, 450);
}

elements.leaveRoomBtn.addEventListener("click", leaveRoom);

elements.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = elements.chatInput.value.trim();
  if (!message) return;
  state.socket.emit("chat-message", { message });
  elements.chatInput.value = "";
});

elements.copyRoomBtn.addEventListener("click", async () => {
  if (!state.roomId) return;
  await navigator.clipboard?.writeText(state.roomId);
  showToast("Room code copied", "success");
});

elements.brushSize.addEventListener("input", () => {
  elements.brushSizeLabel.textContent = elements.brushSize.value;
});

elements.eraserBtn.addEventListener("click", () => {
  state.currentMode = state.currentMode === "eraser" ? "brush" : "eraser";
  elements.eraserBtn.classList.toggle("active", state.currentMode === "eraser");
});

elements.undoBtn.addEventListener("click", () => {
  state.socket.emit("undo-drawing");
});

elements.clearBtn.addEventListener("click", () => {
  state.socket.emit("clear-canvas");
});

elements.closeScoreBtn.addEventListener("click", () => {
  elements.scoreModal.classList.add("hidden");
});

if (!username || (joinMode !== "create" && !initialRoomId)) {
  window.location.href = "/";
} else {
  localStorage.setItem("drawit:username", username);
  setupCanvas();
  connect();
}
