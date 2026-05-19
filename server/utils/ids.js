const crypto = require("crypto");

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createRoomId(existingIds = new Set()) {
  let id = "";

  do {
    id = Array.from({ length: 6 }, () => {
      const index = crypto.randomInt(0, ALPHABET.length);
      return ALPHABET[index];
    }).join("");
  } while (existingIds.has(id));

  return id;
}

function createEntityId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

module.exports = {
  createRoomId,
  createEntityId
};
