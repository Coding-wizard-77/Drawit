require("dotenv").config();

const toInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

module.exports = {
  port: toInt(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || "development",
  clientOrigin: process.env.CLIENT_ORIGIN || "*",
  maxPlayersPerRoom: toInt(process.env.MAX_PLAYERS_PER_ROOM, 8),
  defaultRounds: toInt(process.env.DEFAULT_ROUNDS, 3),
  turnSeconds: toInt(process.env.TURN_SECONDS, 80),
  wordChoiceSeconds: toInt(process.env.WORD_CHOICE_SECONDS, 18),
  roomIdleDeleteSeconds: toInt(process.env.ROOM_IDLE_DELETE_SECONDS, 30)
};
