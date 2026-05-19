const PROFANITY = new Set([
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "cunt",
  "dick"
]);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeName(value) {
  const cleaned = String(value || "")
    .replace(/[^\p{L}\p{N}_ -]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18);

  return cleaned || "Player";
}

function sanitizeChat(value) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);

  if (!text) return "";

  return escapeHtml(text)
    .split(" ")
    .map((part) => {
      const plain = normalizeGuess(part);
      return PROFANITY.has(plain) ? "*".repeat(Math.min(part.length, 8)) : part;
    })
    .join(" ");
}

function normalizeGuess(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&[a-z#0-9]+;/gi, "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeRoomId(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

function isValidPoint(point) {
  return (
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1
  );
}

function sanitizeDrawingTool(tool) {
  const color = /^#[0-9a-f]{6}$/i.test(tool?.color || "") ? tool.color : "#111827";
  const size = Math.min(Math.max(Number(tool?.size) || 6, 1), 42);
  const mode = tool?.mode === "eraser" ? "eraser" : "brush";

  return {
    color,
    size,
    mode
  };
}

module.exports = {
  escapeHtml,
  normalizeName,
  sanitizeChat,
  normalizeGuess,
  normalizeRoomId,
  isValidPoint,
  sanitizeDrawingTool
};
