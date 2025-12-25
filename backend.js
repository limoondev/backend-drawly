#!/usr/bin/env node
// ============================================================
// DRAWLY BACKEND v5.2.0 - Auto-configured for VPS
// ============================================================
// Optimized for: https://limoonfn.cloud/drawly/api/
// ============================================================

import express from "express"
import { createServer as createHttpServer } from "http"
import { createServer as createHttpsServer } from "https"
import { Server } from "socket.io"
import cors from "cors"
import Database from "better-sqlite3"
import { existsSync, mkdirSync, readFileSync } from "fs"
import path from "path"
import crypto from "crypto"

// ============================================================
// AUTO-DETECTION & CONFIGURATION
// ============================================================

const detectEnvironment = () => {
  const isProduction = process.env.NODE_ENV === "production"
  const hasReverseProxy =
    process.env.REVERSE_PROXY === "true" || process.env.TRUST_PROXY === "true" || process.env.HOST === "127.0.0.1"

  // Check if running behind common reverse proxies
  const behindProxy =
    hasReverseProxy ||
    existsSync("/etc/nginx") ||
    existsSync("/etc/caddy") ||
    existsSync("/etc/apache2") ||
    process.env.RENDER ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.VERCEL

  return {
    isProduction,
    behindProxy,
    platform: process.env.RENDER
      ? "render"
      : process.env.RAILWAY_ENVIRONMENT
        ? "railway"
        : process.env.VERCEL
          ? "vercel"
          : "vps",
  }
}

const env = detectEnvironment()

// ============================================================
// CONSOLE COLORS
// ============================================================

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
}

// ============================================================
// CONFIGURATION - Auto-configured for VPS deployment
// ============================================================

const CONFIG = {
  server: {
    name: process.env.SERVER_NAME || "Drawly Server",
    version: "5.2.0",
  },

  port: Number.parseInt(process.env.PORT) || 3001,
  host: process.env.HOST || (env.behindProxy ? "127.0.0.1" : "0.0.0.0"),

  publicUrl: process.env.PUBLIC_URL || "https://limoon-space.cloud/drawly/api",
  basePath: process.env.BASE_PATH || "/drawly/api",

  ssl: {
    enabled: env.behindProxy ? false : process.env.SSL !== "false",
    keyPath: process.env.SSL_KEY || "./ssl/key.pem",
    certPath: process.env.SSL_CERT || "./ssl/cert.pem",
  },

  security: {
    allowedOrigins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
      : ["https://limoon-space.cloud", "https://drawly.app", "http://localhost:3000"],

    rateLimit: {
      connectionsPerMinute: Number.parseInt(process.env.RATE_LIMIT_CONNECTIONS) || 15,
      messagesPerSecond: Number.parseInt(process.env.RATE_LIMIT_MESSAGES) || 50,
      penaltyTime: 60000,
    },
    maxMessageSize: Number.parseInt(process.env.MAX_MESSAGE_SIZE) || 131072, // 128KB
    idleTimeout: Number.parseInt(process.env.IDLE_TIMEOUT) || 600000, // 10 minutes
  },

  database: {
    path: process.env.DB_PATH || "./data/drawly.db",
  },

  game: {
    minPlayers: 2,
    maxPlayers: 10,
    defaultDrawTime: 80,
    defaultRounds: 3,
    hintInterval: 20000,
    turnEndDelay: 5000,
  },
}

// ============================================================
// LOGGING
// ============================================================

const recentLogs = []
const MAX_LOGS = 500

function log(type, message, data = null) {
  const timestamp = new Date().toISOString()
  const logEntry = { timestamp, type, message, data }
  recentLogs.unshift(logEntry)
  if (recentLogs.length > MAX_LOGS) recentLogs.pop()

  const colors = {
    info: C.cyan,
    success: C.green,
    warning: C.yellow,
    error: C.red,
    admin: C.magenta,
    game: C.blue,
    socket: C.dim,
    security: C.red,
  }

  const icons = {
    info: "i",
    success: "+",
    warning: "!",
    error: "x",
    admin: "*",
    game: ">",
    socket: "~",
    security: "#",
  }

  const color = colors[type] || C.white
  const icon = icons[type] || "?"
  const time = new Date().toLocaleTimeString("fr-FR")

  console.log(`${C.dim}[${time}]${C.reset} ${color}[${icon}]${C.reset} ${message}`)
  if (data && type !== "socket") {
    console.log(`${C.dim}    ${JSON.stringify(data)}${C.reset}`)
  }
}

// ============================================================
// DATABASE SETUP
// ============================================================

const dbDir = path.dirname(CONFIG.database.path)
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true })
}

const db = new Database(CONFIG.database.path)
db.pragma("journal_mode = WAL")
db.pragma("synchronous = NORMAL")

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    username TEXT UNIQUE,
    password_hash TEXT,
    display_name TEXT NOT NULL,
    avatar_url TEXT,
    is_premium INTEGER DEFAULT 0,
    is_admin INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    updated_at INTEGER DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT UNIQUE NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_profiles (
    user_id TEXT PRIMARY KEY,
    bio TEXT,
    country TEXT,
    games_played INTEGER DEFAULT 0,
    games_won INTEGER DEFAULT 0,
    total_score INTEGER DEFAULT 0,
    best_score INTEGER DEFAULT 0,
    words_guessed INTEGER DEFAULT 0,
    drawings_made INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    host_id TEXT,
    phase TEXT DEFAULT 'waiting',
    round INTEGER DEFAULT 1,
    turn INTEGER DEFAULT 0,
    max_rounds INTEGER DEFAULT 3,
    draw_time INTEGER DEFAULT 80,
    time_left INTEGER DEFAULT 80,
    current_drawer TEXT,
    current_word TEXT,
    word_length INTEGER DEFAULT 0,
    masked_word TEXT DEFAULT '',
    theme TEXT DEFAULT 'general',
    is_private INTEGER DEFAULT 0,
    max_players INTEGER DEFAULT 8,
    player_count INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    updated_at INTEGER DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL,
    user_id TEXT,
    name TEXT NOT NULL,
    avatar TEXT,
    score INTEGER DEFAULT 0,
    is_host INTEGER DEFAULT 0,
    is_drawing INTEGER DEFAULT 0,
    has_guessed INTEGER DEFAULT 0,
    is_connected INTEGER DEFAULT 1,
    socket_id TEXT,
    created_at INTEGER DEFAULT (unixepoch() * 1000),
    FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS game_history (
    id TEXT PRIMARY KEY,
    room_code TEXT NOT NULL,
    player_count INTEGER,
    rounds_played INTEGER,
    winner_id TEXT,
    winner_name TEXT,
    created_at INTEGER DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS bans (
    id TEXT PRIMARY KEY,
    ip TEXT,
    user_id TEXT,
    reason TEXT,
    banned_by TEXT,
    expires_at INTEGER,
    is_active INTEGER DEFAULT 1,
    created_at INTEGER DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT,
    reported_id TEXT,
    reported_name TEXT,
    reason TEXT,
    details TEXT,
    room_code TEXT,
    status TEXT DEFAULT 'pending',
    created_at INTEGER DEFAULT (unixepoch() * 1000)
  );

  CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
  CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);
  CREATE INDEX IF NOT EXISTS idx_players_socket ON players(socket_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
  CREATE INDEX IF NOT EXISTS idx_bans_ip ON bans(ip);
`)

// Prepared statements
const stmt = {
  // Rooms
  createRoom: db.prepare(`
    INSERT INTO rooms (id, code, host_id, draw_time, max_rounds, theme, is_private, max_players)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getRoom: db.prepare("SELECT * FROM rooms WHERE id = ?"),
  getRoomByCode: db.prepare("SELECT * FROM rooms WHERE code = ?"),
  getAllRooms: db.prepare("SELECT * FROM rooms"),
  updateRoom: db.prepare(`
    UPDATE rooms SET phase = ?, round = ?, turn = ?, time_left = ?, current_drawer = ?,
    current_word = ?, word_length = ?, masked_word = ?, player_count = ?, updated_at = ?
    WHERE id = ?
  `),
  updateRoomSettings: db.prepare("UPDATE rooms SET draw_time = ?, max_rounds = ?, updated_at = ? WHERE id = ?"),
  updateRoomHost: db.prepare("UPDATE rooms SET host_id = ?, updated_at = ? WHERE id = ?"),
  deleteRoom: db.prepare("DELETE FROM rooms WHERE id = ?"),

  // Players
  createPlayer: db.prepare(`
    INSERT INTO players (id, room_id, user_id, name, avatar, is_host, socket_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getPlayer: db.prepare("SELECT * FROM players WHERE id = ?"),
  getPlayerBySocket: db.prepare("SELECT * FROM players WHERE socket_id = ?"),
  getPlayersByRoom: db.prepare("SELECT * FROM players WHERE room_id = ? ORDER BY created_at ASC"),
  updatePlayerScore: db.prepare("UPDATE players SET score = ? WHERE id = ?"),
  updatePlayerDrawing: db.prepare("UPDATE players SET is_drawing = ?, has_guessed = ? WHERE id = ?"),
  updatePlayerGuessed: db.prepare("UPDATE players SET has_guessed = ? WHERE id = ?"),
  updatePlayerConnection: db.prepare("UPDATE players SET is_connected = ?, socket_id = ? WHERE id = ?"),
  updatePlayerHost: db.prepare("UPDATE players SET is_host = ? WHERE id = ?"),
  resetPlayersForRound: db.prepare("UPDATE players SET is_drawing = 0, has_guessed = 0 WHERE room_id = ?"),
  resetPlayersForGame: db.prepare("UPDATE players SET score = 0, is_drawing = 0, has_guessed = 0 WHERE room_id = ?"),
  deletePlayer: db.prepare("DELETE FROM players WHERE id = ?"),
  deletePlayersByRoom: db.prepare("DELETE FROM players WHERE room_id = ?"),

  // Users & Auth
  createUser: db.prepare(`
    INSERT INTO users (id, email, username, password_hash, display_name, avatar_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getUserByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
  getUserByUsername: db.prepare("SELECT * FROM users WHERE username = ?"),
  getUserById: db.prepare("SELECT * FROM users WHERE id = ?"),
  updateUser: db.prepare("UPDATE users SET display_name = ?, avatar_url = ?, updated_at = ? WHERE id = ?"),
  updateUserPassword: db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?"),

  // Sessions
  createSession: db.prepare("INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)"),
  getSession: db.prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > ?"),
  deleteSession: db.prepare("DELETE FROM sessions WHERE token = ?"),
  deleteExpiredSessions: db.prepare("DELETE FROM sessions WHERE expires_at < ?"),
  deleteUserSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),

  // Profiles
  createProfile: db.prepare("INSERT INTO user_profiles (user_id) VALUES (?)"),
  getProfile: db.prepare("SELECT * FROM user_profiles WHERE user_id = ?"),
  updateProfile: db.prepare("UPDATE user_profiles SET bio = ?, country = ? WHERE user_id = ?"),
  updateProfileStats: db.prepare(`
    UPDATE user_profiles SET 
    games_played = games_played + ?,
    games_won = games_won + ?,
    total_score = total_score + ?,
    best_score = MAX(best_score, ?),
    words_guessed = words_guessed + ?,
    drawings_made = drawings_made + ?
    WHERE user_id = ?
  `),

  // Game History
  createGameHistory: db.prepare(`
    INSERT INTO game_history (id, room_code, player_count, rounds_played, winner_id, winner_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getGameStats: db.prepare("SELECT * FROM game_history ORDER BY created_at DESC LIMIT 100"),

  // Bans
  createBan: db.prepare("INSERT INTO bans (id, ip, user_id, reason, banned_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)"),
  getBan: db.prepare(
    "SELECT * FROM bans WHERE (ip = ? OR user_id = ?) AND is_active = 1 AND (expires_at IS NULL OR expires_at > ?)",
  ),
  getBans: db.prepare("SELECT * FROM bans WHERE is_active = 1 ORDER BY created_at DESC"),
  deactivateBan: db.prepare("UPDATE bans SET is_active = 0 WHERE id = ?"),

  // Reports
  createReport: db.prepare(`
    INSERT INTO reports (id, reporter_id, reported_id, reported_name, reason, details, room_code)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),
  getReports: db.prepare("SELECT * FROM reports WHERE status = 'pending' ORDER BY created_at DESC"),
  updateReportStatus: db.prepare("UPDATE reports SET status = ? WHERE id = ?"),
}

// ============================================================
// WORD LISTS
// ============================================================

const WORD_LISTS = {
  general: [
    "chat",
    "chien",
    "maison",
    "soleil",
    "lune",
    "arbre",
    "fleur",
    "voiture",
    "avion",
    "bateau",
    "pizza",
    "pomme",
    "banane",
    "orange",
    "citron",
    "fraise",
    "cerise",
    "raisin",
    "peche",
    "poire",
    "elephant",
    "girafe",
    "lion",
    "tigre",
    "zebre",
    "singe",
    "serpent",
    "crocodile",
    "requin",
    "baleine",
    "montagne",
    "plage",
    "foret",
    "desert",
    "ocean",
    "riviere",
    "lac",
    "cascade",
    "volcan",
    "ile",
    "guitare",
    "piano",
    "violon",
    "batterie",
    "trompette",
    "saxophone",
    "flute",
    "harpe",
    "accordeon",
    "tambour",
    "football",
    "basketball",
    "tennis",
    "natation",
    "cyclisme",
    "boxe",
    "ski",
    "surf",
    "escalade",
    "yoga",
    "docteur",
    "pompier",
    "policier",
    "astronaute",
    "pilote",
    "chef",
    "artiste",
    "musicien",
    "acteur",
    "ecrivain",
    "telephone",
    "ordinateur",
    "television",
    "camera",
    "robot",
    "fusee",
    "satellite",
    "drone",
    "microscope",
    "telescope",
    "chateau",
    "pyramide",
    "statue",
    "pont",
    "tour",
    "moulin",
    "phare",
    "temple",
    "cathedrale",
    "palais",
    "arc-en-ciel",
    "nuage",
    "pluie",
    "neige",
    "orage",
    "eclair",
    "tornade",
    "brouillard",
    "aurore",
    "etoile",
    "coeur",
    "etoile",
    "diamant",
    "couronne",
    "trophee",
    "medaille",
    "cadeau",
    "ballon",
    "gateau",
    "bougie",
    "dragon",
    "licorne",
    "fantome",
    "vampire",
    "zombie",
    "sorciere",
    "fee",
    "sirene",
    "lutin",
    "geant",
  ],
}

function getRandomWords(count = 3, theme = "general") {
  const list = WORD_LISTS[theme] || WORD_LISTS.general
  const shuffled = [...list].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

function maskWord(word) {
  return word.replace(/[a-zA-Z]/g, "_")
}

function revealLetter(word, masked, revealed) {
  const unrevealed = []
  for (let i = 0; i < word.length; i++) {
    if (masked[i] === "_" && !revealed.includes(i)) {
      unrevealed.push(i)
    }
  }
  if (unrevealed.length === 0) return { masked, index: -1 }
  const idx = unrevealed[Math.floor(Math.random() * unrevealed.length)]
  const newMasked = masked.split("")
  newMasked[idx] = word[idx]
  return { masked: newMasked.join(""), index: idx }
}

// ============================================================
// UTILITIES
// ============================================================

function generateId() {
  return crypto.randomBytes(16).toString("hex")
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let code = ""
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex")
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex")
  return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":")
  const verify = crypto.pbkdf2Sync(password, salt, 10000, 64, "sha512").toString("hex")
  return hash === verify
}

function generateToken() {
  return crypto.randomBytes(48).toString("hex")
}

function validateSession(token) {
  if (!token) return null
  const session = stmt.getSession.get(token, Date.now())
  if (!session) return null
  const user = stmt.getUserById.get(session.user_id)
  return user ? { session, user } : null
}

function getClientIP(socket) {
  const forwarded = socket.handshake.headers["x-forwarded-for"]
  if (forwarded) {
    return forwarded.split(",")[0].trim()
  }
  return socket.handshake.address || "unknown"
}

function normalizeGuess(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
}

function isCloseGuess(guess, word) {
  const g = normalizeGuess(guess)
  const w = normalizeGuess(word)
  if (g === w) return false
  if (Math.abs(g.length - w.length) > 2) return false

  let diff = 0
  const maxLen = Math.max(g.length, w.length)
  for (let i = 0; i < maxLen; i++) {
    if (g[i] !== w[i]) diff++
    if (diff > 2) return false
  }
  return diff <= 2
}

// ============================================================
// STATISTICS
// ============================================================

const stats = {
  startTime: Date.now(),
  connections: 0,
  peakConnections: 0,
  roomsCreated: 0,
  gamesPlayed: 0,
  gamesCompleted: 0,
  messagesProcessed: 0,
  strokesProcessed: 0,
  blockedConnections: 0,
  rateLimitHits: 0,
  rejectedOrigins: 0,
}

let maintenanceMode = {
  enabled: false,
  reason: "",
  severity: "info",
}

// ============================================================
// RATE LIMITING
// ============================================================

const rateLimitMap = new Map()
const messageRateMap = new Map()

function checkRateLimit(ip) {
  const now = Date.now()
  const data = rateLimitMap.get(ip) || { count: 0, resetAt: now + 60000, blocked: false, blockedUntil: 0 }

  if (data.blocked && now < data.blockedUntil) {
    return { allowed: false, remaining: 0, resetIn: Math.ceil((data.blockedUntil - now) / 1000) }
  }

  if (now > data.resetAt) {
    data.count = 0
    data.resetAt = now + 60000
    data.blocked = false
  }

  data.count++

  if (data.count > CONFIG.security.rateLimit.connectionsPerMinute) {
    data.blocked = true
    data.blockedUntil = now + CONFIG.security.rateLimit.penaltyTime
    rateLimitMap.set(ip, data)
    stats.rateLimitHits++
    return { allowed: false, remaining: 0, resetIn: 60 }
  }

  rateLimitMap.set(ip, data)
  return {
    allowed: true,
    remaining: CONFIG.security.rateLimit.connectionsPerMinute - data.count,
    resetIn: Math.ceil((data.resetAt - now) / 1000),
  }
}

function checkMessageRate(socketId) {
  const now = Date.now()
  const data = messageRateMap.get(socketId) || { count: 0, resetAt: now + 1000 }

  if (now > data.resetAt) {
    data.count = 0
    data.resetAt = now + 1000
  }

  data.count++

  if (data.count > CONFIG.security.rateLimit.messagesPerSecond) {
    return false
  }

  messageRateMap.set(socketId, data)
  return true
}

// ============================================================
// SERVER & SOCKET INSTANCES
// ============================================================

let app, server, io
const connectedSockets = new Map()
const roomTimers = new Map()
const roomHintTimers = new Map()
const roomRevealedLetters = new Map()
const roomChatHistory = new Map()
const roomDrawerOrder = new Map()

// ============================================================
// GAME LOGIC
// ============================================================

function broadcastRoomSync(roomId) {
  const room = stmt.getRoom.get(roomId)
  if (!room) return

  const players = stmt.getPlayersByRoom.all(roomId)

  io.to(roomId).emit("room:sync", {
    room: {
      id: room.id,
      code: room.code,
      phase: room.phase,
      round: room.round,
      turn: room.turn,
      maxRounds: room.max_rounds,
      timeLeft: room.time_left,
      drawTime: room.draw_time,
      currentDrawer: room.current_drawer,
      wordLength: room.word_length,
      maskedWord: room.masked_word,
      theme: room.theme,
      isPrivate: room.is_private,
      maxPlayers: room.max_players,
    },
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      avatar: p.avatar,
      isHost: p.is_host === 1,
      isDrawing: p.is_drawing === 1,
      hasGuessed: p.has_guessed === 1,
      isConnected: p.is_connected === 1,
    })),
  })
}

function startTurn(roomId) {
  const room = stmt.getRoom.get(roomId)
  if (!room) return

  const players = stmt.getPlayersByRoom.all(roomId).filter((p) => p.is_connected === 1)
  if (players.length < CONFIG.game.minPlayers) {
    endGame(roomId, "Pas assez de joueurs")
    return
  }

  // Get or create drawer order
  let drawerOrder = roomDrawerOrder.get(roomId)
  if (!drawerOrder || drawerOrder.length === 0) {
    drawerOrder = players.map((p) => p.id)
    roomDrawerOrder.set(roomId, drawerOrder)
  }

  // Get next drawer
  const currentTurn = room.turn
  const drawerIndex = currentTurn % drawerOrder.length
  const drawerId = drawerOrder[drawerIndex]

  // Reset players
  stmt.resetPlayersForRound.run(roomId)
  stmt.updatePlayerDrawing.run(1, 0, drawerId)

  // Get words for drawer
  const words = getRandomWords(3, room.theme)

  // Update room
  stmt.updateRoom.run(
    "choosing",
    room.round,
    currentTurn,
    room.draw_time,
    drawerId,
    "",
    0,
    "",
    players.length,
    Date.now(),
    roomId,
  )

  // Send word choices to drawer
  const drawerSocket = connectedSockets.get(drawerId)
  if (drawerSocket) {
    drawerSocket.emit("game:choose_word", { words })
  }

  broadcastRoomSync(roomId)

  // Auto-select word after 15 seconds
  setTimeout(() => {
    const currentRoom = stmt.getRoom.get(roomId)
    if (currentRoom && currentRoom.phase === "choosing" && !currentRoom.current_word) {
      selectWord(roomId, drawerId, words[Math.floor(Math.random() * words.length)])
    }
  }, 15000)
}

function selectWord(roomId, playerId, word) {
  const room = stmt.getRoom.get(roomId)
  if (!room || room.current_drawer !== playerId) return

  const masked = maskWord(word)
  roomRevealedLetters.set(roomId, [])

  stmt.updateRoom.run(
    "drawing",
    room.round,
    room.turn,
    room.draw_time,
    room.current_drawer,
    word,
    word.length,
    masked,
    room.player_count,
    Date.now(),
    roomId,
  )

  // Send full word to drawer
  const drawerSocket = connectedSockets.get(playerId)
  if (drawerSocket) {
    drawerSocket.emit("game:word", { word })
  }

  // Broadcast turn start
  io.to(roomId).emit("game:turn_start", {
    drawerId: playerId,
    wordLength: word.length,
    maskedWord: masked,
    timeLeft: room.draw_time,
  })

  // Start timer
  startTurnTimer(roomId)

  // Start hint timer
  startHintTimer(roomId)
}

function startTurnTimer(roomId) {
  clearRoomTimers(roomId)

  const room = stmt.getRoom.get(roomId)
  if (!room) return

  let timeLeft = room.draw_time

  const timer = setInterval(() => {
    timeLeft--

    if (timeLeft <= 0) {
      clearInterval(timer)
      endTurn(roomId, false)
      return
    }

    stmt.updateRoom.run(
      room.phase,
      room.round,
      room.turn,
      timeLeft,
      room.current_drawer,
      room.current_word,
      room.word_length,
      room.masked_word,
      room.player_count,
      Date.now(),
      roomId,
    )

    io.to(roomId).emit("game:time_update", { timeLeft })
  }, 1000)

  roomTimers.set(roomId, timer)
}

function startHintTimer(roomId) {
  const hintTimer = setInterval(() => {
    const room = stmt.getRoom.get(roomId)
    if (!room || room.phase !== "drawing") {
      clearInterval(hintTimer)
      return
    }

    const revealed = roomRevealedLetters.get(roomId) || []
    const { masked, index } = revealLetter(room.current_word, room.masked_word, revealed)

    if (index >= 0) {
      revealed.push(index)
      roomRevealedLetters.set(roomId, revealed)

      stmt.updateRoom.run(
        room.phase,
        room.round,
        room.turn,
        room.time_left,
        room.current_drawer,
        room.current_word,
        room.word_length,
        masked,
        room.player_count,
        Date.now(),
        roomId,
      )

      io.to(roomId).emit("game:hint", { maskedWord: masked })
    }
  }, CONFIG.game.hintInterval)

  roomHintTimers.set(roomId, hintTimer)
}

function clearRoomTimers(roomId) {
  const timer = roomTimers.get(roomId)
  if (timer) {
    clearInterval(timer)
    roomTimers.delete(roomId)
  }

  const hintTimer = roomHintTimers.get(roomId)
  if (hintTimer) {
    clearInterval(hintTimer)
    roomHintTimers.delete(roomId)
  }
}

function checkGuess(roomId, playerId, message) {
  const room = stmt.getRoom.get(roomId)
  if (!room || room.phase !== "drawing") return { isCorrect: false, isClose: false }

  const player = stmt.getPlayer.get(playerId)
  if (!player || player.is_drawing === 1 || player.has_guessed === 1) return { isCorrect: false, isClose: false }

  const guess = normalizeGuess(message)
  const word = normalizeGuess(room.current_word)

  if (guess === word) {
    // Correct guess
    const players = stmt.getPlayersByRoom.all(roomId)
    const guessedCount = players.filter((p) => p.has_guessed === 1).length

    // Points based on order and time
    const basePoints = 100
    const orderBonus = Math.max(0, 50 - guessedCount * 10)
    const timeBonus = Math.floor((room.time_left / room.draw_time) * 50)
    const points = basePoints + orderBonus + timeBonus

    stmt.updatePlayerGuessed.run(1, playerId)
    stmt.updatePlayerScore.run(player.score + points, playerId)

    // Give drawer points
    const drawer = stmt.getPlayer.get(room.current_drawer)
    if (drawer) {
      stmt.updatePlayerScore.run(drawer.score + 25, drawer.id)
    }

    io.to(roomId).emit("game:correct_guess", {
      playerId,
      playerName: player.name,
      points,
    })

    broadcastRoomSync(roomId)

    // Check if all players guessed
    const updatedPlayers = stmt.getPlayersByRoom.all(roomId)
    const nonDrawers = updatedPlayers.filter((p) => p.is_drawing !== 1 && p.is_connected === 1)
    const allGuessed = nonDrawers.every((p) => p.has_guessed === 1)

    if (allGuessed) {
      setTimeout(() => endTurn(roomId, true), 2000)
    }

    return { isCorrect: true, isClose: false }
  }

  if (isCloseGuess(message, room.current_word)) {
    return { isCorrect: false, isClose: true }
  }

  return { isCorrect: false, isClose: false }
}

function endTurn(roomId, allGuessed) {
  clearRoomTimers(roomId)

  const room = stmt.getRoom.get(roomId)
  if (!room) return

  io.to(roomId).emit("game:turn_end", {
    word: room.current_word,
    allGuessed,
  })

  setTimeout(() => {
    const currentRoom = stmt.getRoom.get(roomId)
    if (!currentRoom) return

    const players = stmt.getPlayersByRoom.all(roomId).filter((p) => p.is_connected === 1)
    const newTurn = currentRoom.turn + 1

    // Check if round is over
    if (newTurn >= players.length) {
      // Check if game is over
      if (currentRoom.round >= currentRoom.max_rounds) {
        endGame(roomId)
      } else {
        // Next round
        stmt.updateRoom.run(
          "roundEnd",
          currentRoom.round,
          newTurn,
          currentRoom.draw_time,
          null,
          "",
          0,
          "",
          players.length,
          Date.now(),
          roomId,
        )

        io.to(roomId).emit("game:round_end", { round: currentRoom.round })

        broadcastRoomSync(roomId)
      }
    } else {
      stmt.updateRoom.run(
        "waiting",
        currentRoom.round,
        newTurn,
        currentRoom.draw_time,
        null,
        "",
        0,
        "",
        players.length,
        Date.now(),
        roomId,
      )
      startTurn(roomId)
    }
  }, CONFIG.game.turnEndDelay)
}

function nextRound(roomId) {
  const room = stmt.getRoom.get(roomId)
  if (!room) return

  roomDrawerOrder.set(roomId, [])

  stmt.updateRoom.run(
    "waiting",
    room.round + 1,
    0,
    room.draw_time,
    null,
    "",
    0,
    "",
    room.player_count,
    Date.now(),
    roomId,
  )

  startTurn(roomId)
}

function endGame(roomId, reason = null) {
  clearRoomTimers(roomId)

  const room = stmt.getRoom.get(roomId)
  if (!room) return

  const players = stmt.getPlayersByRoom.all(roomId)
  const rankings = players
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      rank: i + 1,
      id: p.id,
      name: p.name,
      score: p.score,
      userId: p.user_id,
    }))

  // Save game history
  const winner = rankings[0]
  stmt.createGameHistory.run(generateId(), room.code, players.length, room.round, winner?.id, winner?.name)

  stats.gamesCompleted++

  // Update player profiles
  for (const player of players) {
    if (player.user_id) {
      stmt.updateProfileStats.run(
        1,
        player.id === winner?.id ? 1 : 0,
        player.score,
        player.score,
        player.has_guessed === 1 ? 1 : 0,
        player.is_drawing === 1 ? 1 : 0,
        player.user_id,
      )
    }
  }

  stmt.updateRoom.run("gameEnd", room.round, room.turn, 0, null, "", 0, "", room.player_count, Date.now(), roomId)

  io.to(roomId).emit("game:ended", { rankings, reason })

  broadcastRoomSync(roomId)
}

// ============================================================
// ROUTE SETUP
// ============================================================

function setupRoutes() {
  const router = express.Router()

  // Health check
  router.get("/health", (req, res) => {
    res.json({ status: "ok", timestamp: Date.now() })
  })

  router.get("/status", (req, res) => {
    const rooms = stmt.getAllRooms.all()
    const activeRooms = rooms.filter((r) => r.player_count > 0)

    res.json({
      status: maintenanceMode.enabled ? "maintenance" : "ok",
      version: CONFIG.server.version,
      name: CONFIG.server.name,
      uptime: Math.floor((Date.now() - stats.startTime) / 1000),
      maintenance: maintenanceMode.enabled
        ? {
            enabled: true,
            message: maintenanceMode.reason,
            severity: maintenanceMode.severity,
          }
        : { enabled: false },
      stats: {
        connections: connectedSockets.size,
        peakConnections: stats.peakConnections,
        activeRooms: activeRooms.length,
        totalRooms: rooms.length,
        players: activeRooms.reduce((sum, r) => sum + r.player_count, 0),
        gamesPlayed: stats.gamesPlayed,
        gamesCompleted: stats.gamesCompleted,
        messagesProcessed: stats.messagesProcessed,
      },
      rooms: activeRooms.length,
      players: activeRooms.reduce((sum, r) => sum + r.player_count, 0),
    })
  })

  // Server info
  router.get("/info", (req, res) => {
    res.json({
      name: CONFIG.server.name,
      version: CONFIG.server.version,
      publicUrl: CONFIG.publicUrl,
      ssl: CONFIG.ssl.enabled || env.behindProxy,
      uptime: Math.floor((Date.now() - stats.startTime) / 1000),
    })
  })

  // Root endpoint
  router.get("/", (req, res) => {
    res.json({
      name: CONFIG.server.name,
      version: CONFIG.server.version,
      status: maintenanceMode.enabled ? "maintenance" : "online",
      uptime: Math.floor((Date.now() - stats.startTime) / 1000),
      connections: connectedSockets.size,
      documentation: `${CONFIG.publicUrl}/docs`,
    })
  })

  // Maintenance status
  router.get("/maintenance", (req, res) => {
    res.json(maintenanceMode)
  })

  // Auth routes
  router.post("/auth/register", express.json(), async (req, res) => {
    try {
      const { email, password, username, displayName } = req.body

      if (!email || !password) {
        return res.status(400).json({ success: false, error: "Email et mot de passe requis" })
      }

      const existing = stmt.getUserByEmail.get(email)
      if (existing) {
        return res.status(400).json({ success: false, error: "Email deja utilise" })
      }

      if (username) {
        const existingUsername = stmt.getUserByUsername.get(username)
        if (existingUsername) {
          return res.status(400).json({ success: false, error: "Pseudo deja utilise" })
        }
      }

      const userId = generateId()
      const passwordHash = hashPassword(password)
      const name = displayName || username || email.split("@")[0]

      stmt.createUser.run(userId, email, username || null, passwordHash, name, null)
      stmt.createProfile.run(userId)

      const token = generateToken()
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000

      stmt.createSession.run(generateId(), userId, token, expiresAt)

      const user = stmt.getUserById.get(userId)

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.display_name,
          isPremium: user.is_premium === 1,
          isAdmin: user.is_admin === 1,
        },
        session: { token, expiresAt },
      })
    } catch (err) {
      log("error", "Register error", { error: err.message })
      res.status(500).json({ success: false, error: "Erreur serveur" })
    }
  })

  router.post("/auth/login", express.json(), async (req, res) => {
    try {
      const { email, password } = req.body

      if (!email || !password) {
        return res.status(400).json({ success: false, error: "Email et mot de passe requis" })
      }

      const user = stmt.getUserByEmail.get(email)
      if (!user || !verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ success: false, error: "Identifiants incorrects" })
      }

      const token = generateToken()
      const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000

      stmt.createSession.run(generateId(), user.id, token, expiresAt)

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
          isPremium: user.is_premium === 1,
          isAdmin: user.is_admin === 1,
        },
        session: { token, expiresAt },
      })
    } catch (err) {
      log("error", "Login error", { error: err.message })
      res.status(500).json({ success: false, error: "Erreur serveur" })
    }
  })

  router.post("/auth/logout", (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "")
    if (token) {
      stmt.deleteSession.run(token)
    }
    res.json({ success: true })
  })

  router.get("/auth/me", (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "")
    const auth = validateSession(token)

    if (!auth) {
      return res.status(401).json({ error: "Non authentifie" })
    }

    const profile = stmt.getProfile.get(auth.user.id)

    res.json({
      user: {
        id: auth.user.id,
        email: auth.user.email,
        username: auth.user.username,
        displayName: auth.user.display_name,
        avatarUrl: auth.user.avatar_url,
        isPremium: auth.user.is_premium === 1,
        isAdmin: auth.user.is_admin === 1,
      },
      profile,
    })
  })

  // Admin routes
  router.get("/admin/stats", (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "")
    const auth = validateSession(token)

    if (!auth || auth.user.is_admin !== 1) {
      return res.status(401).json({ error: "Non autorise" })
    }

    const rooms = stmt.getAllRooms.all()
    const gameStats = stmt.getGameStats.all()

    res.json({
      server: {
        ...stats,
        uptime: Math.floor((Date.now() - stats.startTime) / 1000),
        currentConnections: connectedSockets.size,
      },
      rooms: rooms.map((r) => ({
        code: r.code,
        phase: r.phase,
        playerCount: r.player_count,
        round: r.round,
        maxRounds: r.max_rounds,
      })),
      recentGames: gameStats,
    })
  })

  router.post("/admin/maintenance", express.json(), (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "")
    const auth = validateSession(token)

    if (!auth || auth.user.is_admin !== 1) {
      return res.status(401).json({ error: "Non autorise" })
    }

    const { enabled, reason, severity } = req.body
    maintenanceMode = {
      enabled: !!enabled,
      reason: reason || "",
      severity: severity || "info",
    }

    if (enabled) {
      io.emit("maintenance:active", maintenanceMode)
    }

    log("admin", `Maintenance ${enabled ? "activee" : "desactivee"}`, { reason })
    res.json({ success: true, maintenance: maintenanceMode })
  })

  router.get("/admin/bans", (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "")
    const auth = validateSession(token)

    if (!auth || auth.user.is_admin !== 1) {
      return res.status(401).json({ error: "Non autorise" })
    }

    const bans = stmt.getBans.all()
    res.json({ bans })
  })

  router.get("/admin/reports", (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "")
    const auth = validateSession(token)

    if (!auth || auth.user.is_admin !== 1) {
      return res.status(401).json({ error: "Non autorise" })
    }

    const reports = stmt.getReports.all()
    res.json({ reports })
  })

  app.use(CONFIG.basePath, router)

  // Also mount at root for backwards compatibility
  app.use("/api", router)
}

// ============================================================
// SOCKET.IO HANDLERS
// ============================================================

function setupSocketHandlers() {
  io.use((socket, next) => {
    const origin = socket.handshake.headers.origin
    const ip = getClientIP(socket)

    // Check ban
    const ban = stmt.getBan.get(ip, null, Date.now())
    if (ban) {
      stats.blockedConnections++
      return next(new Error(`Banni: ${ban.reason}`))
    }

    // Rate limit
    const rateCheck = checkRateLimit(ip)
    if (!rateCheck.allowed) {
      stats.blockedConnections++
      return next(new Error("Trop de connexions. Reessayez plus tard."))
    }

    // Origin check
    if (CONFIG.security.allowedOrigins[0] !== "*") {
      const allowed = CONFIG.security.allowedOrigins.some((o) => {
        if (o.startsWith("*.")) {
          const domain = o.slice(2)
          return origin?.endsWith(domain) || origin?.endsWith("." + domain)
        }
        return o === origin
      })

      if (!allowed && origin) {
        stats.rejectedOrigins++
        log("security", `Origine rejetee: ${origin}`, { ip })
        return next(new Error("Origine non autorisee"))
      }
    }

    next()
  })

  io.on("connection", (socket) => {
    const ip = getClientIP(socket)
    stats.connections++

    if (connectedSockets.size + 1 > stats.peakConnections) {
      stats.peakConnections = connectedSockets.size + 1
    }

    log("socket", `Connexion: ${socket.id}`, { ip })

    // Idle timeout
    let idleTimer = setTimeout(() => {
      socket.disconnect(true)
    }, CONFIG.security.idleTimeout)

    const resetIdleTimer = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        socket.disconnect(true)
      }, CONFIG.security.idleTimeout)
    }

    // Room: Create
    socket.on("room:create", (data, callback) => {
      resetIdleTimer()

      if (!checkMessageRate(socket.id)) {
        return callback({ success: false, error: "Trop de requetes" })
      }

      const { playerName, settings = {} } = data
      if (!playerName || playerName.trim().length < 2) {
        return callback({ success: false, error: "Pseudo invalide" })
      }

      const roomId = generateId()
      const roomCode = generateRoomCode()
      const playerId = generateId()

      stmt.createRoom.run(
        roomId,
        roomCode,
        playerId,
        settings.drawTime || CONFIG.game.defaultDrawTime,
        settings.rounds || CONFIG.game.defaultRounds,
        settings.theme || "general",
        settings.isPrivate ? 1 : 0,
        settings.maxPlayers || CONFIG.game.maxPlayers,
      )

      stmt.createPlayer.run(playerId, roomId, null, playerName.trim(), settings.avatar || "#3b82f6", 1, socket.id)

      stmt.updateRoom.run(
        "waiting",
        1,
        0,
        settings.drawTime || CONFIG.game.defaultDrawTime,
        null,
        "",
        0,
        "",
        1,
        Date.now(),
        roomId,
      )

      socket.join(roomId)
      connectedSockets.set(playerId, socket)

      stats.roomsCreated++
      log("game", `Room creee: ${roomCode}`, { host: playerName })

      callback({
        success: true,
        roomCode,
        roomId,
        playerId,
      })

      broadcastRoomSync(roomId)
    })

    // Room: Join
    socket.on("room:join", (data, callback) => {
      resetIdleTimer()

      if (!checkMessageRate(socket.id)) {
        return callback({ success: false, error: "Trop de requetes" })
      }

      const { roomCode, playerName, playerId: existingPlayerId } = data
      if (!roomCode || !playerName) {
        return callback({ success: false, error: "Code ou pseudo manquant" })
      }

      const room = stmt.getRoomByCode.get(roomCode.toUpperCase())
      if (!room) {
        return callback({ success: false, error: "Salon introuvable" })
      }

      const players = stmt.getPlayersByRoom.all(room.id)

      // Check for reconnection
      if (existingPlayerId) {
        const existingPlayer = players.find((p) => p.id === existingPlayerId)
        if (existingPlayer) {
          stmt.updatePlayerConnection.run(1, socket.id, existingPlayerId)
          socket.join(room.id)
          connectedSockets.set(existingPlayerId, socket)

          log("game", `Reconnexion: ${playerName}`, { room: roomCode })

          callback({
            success: true,
            roomCode: room.code,
            roomId: room.id,
            playerId: existingPlayerId,
            room: {
              phase: room.phase,
              drawTime: room.draw_time,
              maxRounds: room.max_rounds,
            },
            messages: roomChatHistory.get(room.id) || [],
          })

          broadcastRoomSync(room.id)
          return
        }
      }

      if (players.length >= room.max_players) {
        return callback({ success: false, error: "Salon plein" })
      }

      if (room.phase !== "waiting") {
        return callback({ success: false, error: "Partie en cours" })
      }

      const playerId = generateId()
      stmt.createPlayer.run(playerId, room.id, null, playerName.trim(), "#3b82f6", 0, socket.id)

      stmt.updateRoom.run(
        room.phase,
        room.round,
        room.turn,
        room.time_left,
        room.current_drawer,
        room.current_word,
        room.word_length,
        room.masked_word,
        players.length + 1,
        Date.now(),
        room.id,
      )

      socket.join(room.id)
      connectedSockets.set(playerId, socket)

      log("game", `Joueur rejoint: ${playerName}`, { room: roomCode })

      // Notify others
      socket.to(room.id).emit("player:joined", { id: playerId, name: playerName })

      callback({
        success: true,
        roomCode: room.code,
        roomId: room.id,
        playerId,
        room: {
          phase: room.phase,
          drawTime: room.draw_time,
          maxRounds: room.max_rounds,
        },
        messages: roomChatHistory.get(room.id) || [],
      })

      broadcastRoomSync(room.id)
    })

    // Room: Leave
    socket.on("room:leave", () => {
      handleDisconnect(socket)
    })

    // Room: Settings
    socket.on("room:settings", (data, callback) => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player || player.is_host !== 1) {
        return callback({ success: false, error: "Non autorise" })
      }

      const room = stmt.getRoom.get(player.room_id)
      if (!room || room.phase !== "waiting") {
        return callback({ success: false, error: "Impossible de modifier" })
      }

      stmt.updateRoomSettings.run(
        data.drawTime || room.draw_time,
        data.maxRounds || room.max_rounds,
        Date.now(),
        room.id,
      )

      broadcastRoomSync(room.id)
      callback({ success: true })
    })

    // Game: Start
    socket.on("game:start", (data, callback) => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player || player.is_host !== 1) {
        return callback({ success: false, error: "Seul l'hote peut demarrer" })
      }

      const room = stmt.getRoom.get(player.room_id)
      if (!room) {
        return callback({ success: false, error: "Salon introuvable" })
      }

      const players = stmt.getPlayersByRoom.all(room.id).filter((p) => p.is_connected === 1)
      if (players.length < CONFIG.game.minPlayers) {
        return callback({ success: false, error: `Minimum ${CONFIG.game.minPlayers} joueurs requis` })
      }

      stats.gamesPlayed++
      stmt.resetPlayersForGame.run(room.id)

      io.to(room.id).emit("game:starting", { countdown: 3 })

      setTimeout(() => {
        startTurn(room.id)
      }, 3000)

      callback({ success: true })
    })

    // Game: Select word
    socket.on("game:select_word", (data) => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player) return

      selectWord(player.room_id, player.id, data.word)
    })

    // Game: Next round
    socket.on("game:next_round", (data, callback) => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player || player.is_host !== 1) {
        return callback({ success: false })
      }

      nextRound(player.room_id)
      callback({ success: true })
    })

    // Game: Play again
    socket.on("game:play_again", (data, callback) => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player) {
        return callback({ success: false })
      }

      const room = stmt.getRoom.get(player.room_id)
      if (!room || room.phase !== "gameEnd") {
        return callback({ success: false })
      }

      stmt.resetPlayersForGame.run(room.id)
      stmt.updateRoom.run("waiting", 1, 0, room.draw_time, null, "", 0, "", room.player_count, Date.now(), room.id)

      roomDrawerOrder.delete(room.id)

      broadcastRoomSync(room.id)
      callback({ success: true })
    })

    // Chat: Message
    socket.on("chat:message", (data) => {
      resetIdleTimer()
      stats.messagesProcessed++

      if (!checkMessageRate(socket.id)) return

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player) return

      const room = stmt.getRoom.get(player.room_id)
      if (!room) return

      const message = data.message?.trim()
      if (!message || message.length > 200) return

      // Check for guess
      const { isCorrect, isClose } = checkGuess(room.id, player.id, message)

      if (isCorrect) {
        // Don't broadcast the correct word
        return
      }

      const chatMsg = {
        id: generateId(),
        playerId: player.id,
        playerName: player.name,
        message,
        timestamp: Date.now(),
        isClose,
        isGuess: room.phase === "drawing" && player.is_drawing !== 1,
      }

      // Store in history
      const history = roomChatHistory.get(room.id) || []
      history.push(chatMsg)
      if (history.length > 100) history.shift()
      roomChatHistory.set(room.id, history)

      io.to(room.id).emit("chat:message", chatMsg)
    })

    // Draw: Stroke
    socket.on("draw:stroke", (stroke) => {
      resetIdleTimer()
      stats.strokesProcessed++

      if (!checkMessageRate(socket.id)) return

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player || player.is_drawing !== 1) return

      socket.to(player.room_id).emit("draw:stroke", stroke)
    })

    // Draw: Clear
    socket.on("draw:clear", () => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player || player.is_drawing !== 1) return

      socket.to(player.room_id).emit("draw:clear")
    })

    // Draw: Undo
    socket.on("draw:undo", () => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player || player.is_drawing !== 1) return

      socket.to(player.room_id).emit("draw:undo")
    })

    // Player: Kick
    socket.on("player:kick", (data, callback) => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player || player.is_host !== 1) {
        return callback({ success: false, error: "Non autorise" })
      }

      const target = stmt.getPlayer.get(data.playerId)
      if (!target || target.room_id !== player.room_id) {
        return callback({ success: false, error: "Joueur introuvable" })
      }

      const targetSocket = connectedSockets.get(target.id)
      if (targetSocket) {
        targetSocket.emit("player:kicked", { reason: "Expulse par l'hote" })
        targetSocket.leave(player.room_id)
        targetSocket.disconnect(true)
      }

      stmt.deletePlayer.run(target.id)
      connectedSockets.delete(target.id)

      const room = stmt.getRoom.get(player.room_id)
      if (room) {
        stmt.updateRoom.run(
          room.phase,
          room.round,
          room.turn,
          room.time_left,
          room.current_drawer,
          room.current_word,
          room.word_length,
          room.masked_word,
          Math.max(0, room.player_count - 1),
          Date.now(),
          room.id,
        )
      }

      broadcastRoomSync(player.room_id)
      callback({ success: true })
    })

    // Player: Ban
    socket.on("player:ban", (data, callback) => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player || player.is_host !== 1) {
        return callback({ success: false, error: "Non autorise" })
      }

      const target = stmt.getPlayer.get(data.playerId)
      if (!target || target.room_id !== player.room_id) {
        return callback({ success: false, error: "Joueur introuvable" })
      }

      const targetSocket = connectedSockets.get(target.id)
      const targetIp = targetSocket ? getClientIP(targetSocket) : null

      stmt.createBan.run(generateId(), targetIp, target.user_id, data.reason || "Banni par l'hote", player.id, null)

      if (targetSocket) {
        targetSocket.emit("player:banned", { reason: data.reason || "Banni par l'hote" })
        targetSocket.leave(player.room_id)
        targetSocket.disconnect(true)
      }

      stmt.deletePlayer.run(target.id)
      connectedSockets.delete(target.id)

      const room = stmt.getRoom.get(player.room_id)
      if (room) {
        stmt.updateRoom.run(
          room.phase,
          room.round,
          room.turn,
          room.time_left,
          room.current_drawer,
          room.current_word,
          room.word_length,
          room.masked_word,
          Math.max(0, room.player_count - 1),
          Date.now(),
          room.id,
        )
      }

      broadcastRoomSync(player.room_id)
      callback({ success: true })
    })

    // Player: Report
    socket.on("player:report", (data, callback) => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player) {
        return callback({ success: false })
      }

      const target = stmt.getPlayer.get(data.playerId)
      if (!target) {
        return callback({ success: false })
      }

      const room = stmt.getRoom.get(player.room_id)

      stmt.createReport.run(
        generateId(),
        player.id,
        target.id,
        target.name,
        data.reason,
        data.details || null,
        room?.code || "",
      )

      log("admin", `Signalement: ${target.name}`, { reason: data.reason, by: player.name })

      callback({ success: true })
    })

    // Disconnect
    socket.on("disconnect", () => {
      clearTimeout(idleTimer)
      handleDisconnect(socket)
    })
  })
}

function handleDisconnect(socket) {
  const player = stmt.getPlayerBySocket.get(socket.id)
  if (!player) {
    log("socket", `Deconnexion: ${socket.id}`)
    return
  }

  const room = stmt.getRoom.get(player.room_id)
  if (!room) {
    stmt.deletePlayer.run(player.id)
    connectedSockets.delete(player.id)
    return
  }

  log("game", `Joueur deconnecte: ${player.name}`, { room: room.code })

  // Mark as disconnected instead of deleting
  stmt.updatePlayerConnection.run(0, null, player.id)
  connectedSockets.delete(player.id)

  const players = stmt.getPlayersByRoom.all(room.id)
  const connectedPlayers = players.filter((p) => p.is_connected === 1)

  // If no connected players, delete room after delay
  if (connectedPlayers.length === 0) {
    setTimeout(() => {
      const currentRoom = stmt.getRoom.get(room.id)
      if (currentRoom) {
        const currentPlayers = stmt.getPlayersByRoom.all(room.id)
        const stillConnected = currentPlayers.filter((p) => p.is_connected === 1)
        if (stillConnected.length === 0) {
          clearRoomTimers(room.id)
          stmt.deletePlayersByRoom.run(room.id)
          stmt.deleteRoom.run(room.id)
          roomChatHistory.delete(room.id)
          roomDrawerOrder.delete(room.id)
          log("game", `Salon supprime: ${room.code}`)
        }
      }
    }, 60000)
  } else {
    // Transfer host if needed
    if (player.is_host === 1 && connectedPlayers.length > 0) {
      const newHost = connectedPlayers[0]
      stmt.updatePlayerHost.run(0, player.id)
      stmt.updatePlayerHost.run(1, newHost.id)
      stmt.updateRoomHost.run(newHost.id, Date.now(), room.id)

      io.to(room.id).emit("host:changed", {
        newHostId: newHost.id,
        newHostName: newHost.name,
      })
    }

    // Handle if current drawer disconnected
    if (player.id === room.current_drawer && room.phase === "drawing") {
      endTurn(room.id, false)
    }

    stmt.updateRoom.run(
      room.phase,
      room.round,
      room.turn,
      room.time_left,
      room.current_drawer,
      room.current_word,
      room.word_length,
      room.masked_word,
      connectedPlayers.length,
      Date.now(),
      room.id,
    )

    socket.to(room.id).emit("player:disconnected", {
      playerId: player.id,
      reason: "Deconnexion",
    })

    broadcastRoomSync(room.id)
  }
}

// ============================================================
// CLEANUP
// ============================================================

function setupCleanup() {
  // Clean expired sessions every hour
  setInterval(
    () => {
      stmt.deleteExpiredSessions.run(Date.now())
    },
    60 * 60 * 1000,
  )

  // Clean empty rooms every 5 minutes
  setInterval(
    () => {
      const rooms = stmt.getAllRooms.all()
      for (const room of rooms) {
        const players = stmt.getPlayersByRoom.all(room.id)
        const connected = players.filter((p) => p.is_connected === 1)
        if (connected.length === 0 && Date.now() - room.updated_at > 300000) {
          clearRoomTimers(room.id)
          stmt.deletePlayersByRoom.run(room.id)
          stmt.deleteRoom.run(room.id)
          roomChatHistory.delete(room.id)
          roomDrawerOrder.delete(room.id)
          log("info", `Salon nettoye: ${room.code}`)
        }
      }
    },
    5 * 60 * 1000,
  )

  // Clean rate limit maps every minute
  setInterval(() => {
    const now = Date.now()
    for (const [ip, data] of rateLimitMap) {
      if (now > data.resetAt + 60000) {
        rateLimitMap.delete(ip)
      }
    }
    for (const [socketId, data] of messageRateMap) {
      if (now > data.resetAt + 10000) {
        messageRateMap.delete(socketId)
      }
    }
  }, 60000)
}

// ============================================================
// SERVER STARTUP
// ============================================================

function startServer() {
  console.log(`\n${C.bgMagenta}${C.white} DRAWLY BACKEND v${CONFIG.server.version} ${C.reset}\n`)

  app = express()

  if (env.behindProxy) {
    app.set("trust proxy", 1)
  }

  const corsOptions = {
    origin: CONFIG.security.allowedOrigins.includes("*") ? true : CONFIG.security.allowedOrigins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  }

  app.use(cors(corsOptions))
  app.use(express.json({ limit: "1mb" }))

  // Security headers
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("X-Frame-Options", "DENY")
    res.setHeader("X-XSS-Protection", "1; mode=block")
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
    next()
  })

  if (CONFIG.ssl.enabled && !env.behindProxy) {
    if (existsSync(CONFIG.ssl.keyPath) && existsSync(CONFIG.ssl.certPath)) {
      server = createHttpsServer(
        {
          key: readFileSync(CONFIG.ssl.keyPath),
          cert: readFileSync(CONFIG.ssl.certPath),
        },
        app,
      )
      log("success", "SSL/TLS actif (HTTPS direct)")
    } else {
      console.log(`\n${C.yellow}[!] Certificats SSL non trouves${C.reset}`)
      console.log(`${C.dim}    Utilisation du mode HTTP${C.reset}\n`)
      server = createHttpServer(app)
    }
  } else {
    server = createHttpServer(app)
    if (env.behindProxy) {
      log("info", "Mode reverse proxy detecte - SSL gere par le proxy")
    }
  }

  io = new Server(server, {
    cors: corsOptions,
    path: `${CONFIG.basePath}/socket.io`,
    transports: ["websocket", "polling"],
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: CONFIG.security.maxMessageSize,
    allowEIO3: false,
  })

  setupRoutes()
  setupSocketHandlers()
  setupCleanup()

  server.listen(CONFIG.port, CONFIG.host, () => {
    const localUrl = `http://${CONFIG.host}:${CONFIG.port}`

    console.log(`${C.bold}Configuration:${C.reset}`)
    console.log(`  ${C.dim}Ecoute:${C.reset}        ${CONFIG.host}:${CONFIG.port}`)
    console.log(`  ${C.dim}URL publique:${C.reset}  ${CONFIG.publicUrl}`)
    console.log(`  ${C.dim}Base path:${C.reset}     ${CONFIG.basePath}`)
    console.log(`  ${C.dim}Reverse proxy:${C.reset} ${env.behindProxy ? "Oui" : "Non"}`)
    console.log(`  ${C.dim}Origines:${C.reset}      ${CONFIG.security.allowedOrigins.join(", ")}`)
    console.log(`  ${C.dim}Rate limit:${C.reset}    ${CONFIG.security.rateLimit.connectionsPerMinute} conn/min`)
    console.log(``)
    log("success", `Serveur pret sur ${localUrl}`)
    console.log(``)

    // Auto-configuration info
    console.log(`${C.cyan}[i] Configuration auto-detectee pour VPS${C.reset}`)
    console.log(`${C.dim}    Nginx/Caddy doit proxyfier vers ${localUrl}${C.reset}`)
    console.log(`${C.dim}    Le frontend doit utiliser: ${CONFIG.publicUrl}${C.reset}`)
    console.log(``)
  })

  // Graceful shutdown
  process.on("SIGTERM", () => {
    log("warning", "Arret du serveur...")
    io.emit("server:shutdown", { message: "Le serveur redemarre" })

    server.close(() => {
      db.close()
      process.exit(0)
    })

    setTimeout(() => process.exit(1), 10000)
  })

  process.on("SIGINT", () => {
    log("warning", "Arret du serveur (SIGINT)...")
    io.emit("server:shutdown", { message: "Le serveur s'arrete" })

    server.close(() => {
      db.close()
      process.exit(0)
    })

    setTimeout(() => process.exit(1), 5000)
  })
}

startServer()
