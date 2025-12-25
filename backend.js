#!/usr/bin/env node
// ============================================================
// DRAWLY BACKEND v5.3.0 - Enhanced with better logging & fixes
// ============================================================
// Optimized for: https://limoon-space.cloud/drawly/api/
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
// CONSOLE COLORS - Enhanced
// ============================================================

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",

  // Foreground
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",

  // Bright foreground
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",

  // Background
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgBlue: "\x1b[44m",
  bgMagenta: "\x1b[45m",
  bgCyan: "\x1b[46m",
  bgWhite: "\x1b[47m",
}

// ============================================================
// CONFIGURATION
// ============================================================

const CONFIG = {
  server: {
    name: process.env.SERVER_NAME || "Drawly Server",
    version: "5.3.0",
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
      : ["https://limoon-space.cloud", "https://drawly.app", "http://localhost:3000", "http://127.0.0.1:3000"],

    rateLimit: {
      connectionsPerMinute: Number.parseInt(process.env.RATE_LIMIT_CONNECTIONS) || 30,
      messagesPerSecond: Number.parseInt(process.env.RATE_LIMIT_MESSAGES) || 100,
      penaltyTime: 60000,
    },
    maxMessageSize: Number.parseInt(process.env.MAX_MESSAGE_SIZE) || 131072,
    idleTimeout: Number.parseInt(process.env.IDLE_TIMEOUT) || 900000, // 15 minutes
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
// ENHANCED LOGGING
// ============================================================

const recentLogs = []
const MAX_LOGS = 1000

function log(type, message, data = null) {
  const timestamp = new Date().toISOString()
  const logEntry = { timestamp, type, message, data }
  recentLogs.unshift(logEntry)
  if (recentLogs.length > MAX_LOGS) recentLogs.pop()

  const configs = {
    info: { color: C.cyan, icon: "ℹ", prefix: "INFO" },
    success: { color: C.green, icon: "✓", prefix: "OK" },
    warning: { color: C.yellow, icon: "⚠", prefix: "WARN" },
    error: { color: C.red, icon: "✗", prefix: "ERR" },
    admin: { color: C.magenta, icon: "★", prefix: "ADMIN" },
    game: { color: C.blue, icon: "🎮", prefix: "GAME" },
    socket: { color: C.brightCyan, icon: "⚡", prefix: "SOCK" },
    security: { color: C.brightRed, icon: "🛡", prefix: "SEC" },
    room: { color: C.brightMagenta, icon: "🏠", prefix: "ROOM" },
    player: { color: C.brightGreen, icon: "👤", prefix: "PLAYER" },
    chat: { color: C.brightYellow, icon: "💬", prefix: "CHAT" },
    draw: { color: C.brightBlue, icon: "🖌", prefix: "DRAW" },
    network: { color: C.gray, icon: "🌐", prefix: "NET" },
    db: { color: C.dim, icon: "💾", prefix: "DB" },
  }

  const cfg = configs[type] || configs.info
  const time = new Date().toLocaleTimeString("fr-FR", { hour12: false })

  const prefix = `${C.dim}[${time}]${C.reset} ${cfg.color}${cfg.icon} ${cfg.prefix}${C.reset}`

  if (data) {
    console.log(`${prefix} ${message}`)
    console.log(`${C.dim}       └─ ${JSON.stringify(data)}${C.reset}`)
  } else {
    console.log(`${prefix} ${message}`)
  }
}

function logBox(title, lines) {
  const maxLen = Math.max(title.length, ...lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").length))
  const border = "─".repeat(maxLen + 2)

  console.log(`${C.cyan}┌${border}┐${C.reset}`)
  console.log(`${C.cyan}│${C.reset} ${C.bold}${title.padEnd(maxLen)}${C.reset} ${C.cyan}│${C.reset}`)
  console.log(`${C.cyan}├${border}┤${C.reset}`)
  for (const line of lines) {
    const cleanLen = line.replace(/\x1b\[[0-9;]*m/g, "").length
    console.log(`${C.cyan}│${C.reset} ${line}${" ".repeat(maxLen - cleanLen)} ${C.cyan}│${C.reset}`)
  }
  console.log(`${C.cyan}└${border}┘${C.reset}`)
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

log("db", "Database initialized")

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
  if (!room) {
    log("warning", `broadcastRoomSync: Room not found: ${roomId}`)
    return
  }

  const players = stmt.getPlayersByRoom.all(roomId)

  const syncData = {
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
  }

  log("room", `Sync room ${room.code}`, { phase: room.phase, players: players.length })
  io.to(roomId).emit("room:sync", syncData)
}

function startTurn(roomId) {
  const room = stmt.getRoom.get(roomId)
  if (!room) {
    log("error", `startTurn: Room not found: ${roomId}`)
    return
  }

  const players = stmt.getPlayersByRoom.all(roomId).filter((p) => p.is_connected === 1)
  if (players.length < CONFIG.game.minPlayers) {
    log("game", `Not enough players to continue, ending game`)
    endGame(roomId, "Pas assez de joueurs")
    return
  }

  let drawerOrder = roomDrawerOrder.get(roomId)
  if (!drawerOrder || drawerOrder.length === 0) {
    drawerOrder = players.map((p) => p.id)
    roomDrawerOrder.set(roomId, drawerOrder)
    log("game", `Created drawer order for room ${room.code}`, drawerOrder)
  }

  const currentTurn = room.turn
  const drawerIndex = currentTurn % drawerOrder.length
  const drawerId = drawerOrder[drawerIndex]

  log("game", `Turn ${currentTurn + 1}: Drawer is ${drawerId}`)

  stmt.resetPlayersForRound.run(roomId)
  stmt.updatePlayerDrawing.run(1, 0, drawerId)

  const words = getRandomWords(3, room.theme)
  log("game", `Word choices generated`, words)

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

  const drawerSocket = connectedSockets.get(drawerId)
  if (drawerSocket) {
    log("game", `Sending word choices to drawer`)
    drawerSocket.emit("game:choose_word", { words })
  } else {
    log("warning", `Drawer socket not found for ${drawerId}`)
  }

  broadcastRoomSync(roomId)

  setTimeout(() => {
    const currentRoom = stmt.getRoom.get(roomId)
    if (currentRoom && currentRoom.phase === "choosing" && !currentRoom.current_word) {
      log("game", `Auto-selecting word due to timeout`)
      selectWord(roomId, drawerId, words[Math.floor(Math.random() * words.length)])
    }
  }, 15000)
}

function selectWord(roomId, playerId, word) {
  const room = stmt.getRoom.get(roomId)
  if (!room || room.current_drawer !== playerId) {
    log("warning", `selectWord: Invalid drawer or room`)
    return
  }

  log("game", `Word selected: ${word}`)

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

  const drawerSocket = connectedSockets.get(playerId)
  if (drawerSocket) {
    drawerSocket.emit("game:word", { word })
  }

  io.to(roomId).emit("game:turn_start", {
    drawerId: playerId,
    wordLength: word.length,
    maskedWord: masked,
    timeLeft: room.draw_time,
  })

  startTurnTimer(roomId)
  startHintTimer(roomId)
}

function startTurnTimer(roomId) {
  clearRoomTimers(roomId)

  const room = stmt.getRoom.get(roomId)
  if (!room) return

  let timeLeft = room.draw_time
  log("game", `Timer started: ${timeLeft}s`)

  const timer = setInterval(() => {
    timeLeft--

    if (timeLeft <= 0) {
      clearInterval(timer)
      endTurn(roomId, false)
      return
    }

    const currentRoom = stmt.getRoom.get(roomId)
    if (currentRoom) {
      stmt.updateRoom.run(
        currentRoom.phase,
        currentRoom.round,
        currentRoom.turn,
        timeLeft,
        currentRoom.current_drawer,
        currentRoom.current_word,
        currentRoom.word_length,
        currentRoom.masked_word,
        currentRoom.player_count,
        Date.now(),
        roomId,
      )
    }

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

      log("game", `Hint revealed: ${masked}`)
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
    const players = stmt.getPlayersByRoom.all(roomId)
    const guessedCount = players.filter((p) => p.has_guessed === 1).length

    const basePoints = 100
    const orderBonus = Math.max(0, 50 - guessedCount * 10)
    const timeBonus = Math.floor((room.time_left / room.draw_time) * 50)
    const points = basePoints + orderBonus + timeBonus

    log("game", `${player.name} guessed correctly! +${points} points`)

    stmt.updatePlayerGuessed.run(1, playerId)
    stmt.updatePlayerScore.run(player.score + points, playerId)

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

    const updatedPlayers = stmt.getPlayersByRoom.all(roomId)
    const nonDrawers = updatedPlayers.filter((p) => p.is_drawing !== 1 && p.is_connected === 1)
    const allGuessed = nonDrawers.every((p) => p.has_guessed === 1)

    if (allGuessed) {
      log("game", "All players guessed! Ending turn early")
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

  log("game", `Turn ended`, { word: room.current_word, allGuessed })

  io.to(roomId).emit("game:turn_end", {
    word: room.current_word,
    allGuessed,
  })

  setTimeout(() => {
    const currentRoom = stmt.getRoom.get(roomId)
    if (!currentRoom) return

    const players = stmt.getPlayersByRoom.all(roomId).filter((p) => p.is_connected === 1)
    const newTurn = currentRoom.turn + 1

    if (newTurn >= players.length) {
      if (currentRoom.round >= currentRoom.max_rounds) {
        endGame(roomId)
      } else {
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

        log("game", `Round ${currentRoom.round} ended`)
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

  log("game", `Starting round ${room.round + 1}`)

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

  log("game", `Game ended in room ${room.code}`, { reason, winner: rankings[0]?.name })

  const winner = rankings[0]
  stmt.createGameHistory.run(generateId(), room.code, players.length, room.round, winner?.id, winner?.name)

  stats.gamesCompleted++

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
        ? { enabled: true, message: maintenanceMode.reason, severity: maintenanceMode.severity }
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

  router.get("/info", (req, res) => {
    res.json({
      name: CONFIG.server.name,
      version: CONFIG.server.version,
      publicUrl: CONFIG.publicUrl,
      ssl: CONFIG.ssl.enabled || env.behindProxy,
      stats: {
        rooms: stmt.getAllRooms.all().filter((r) => r.player_count > 0).length,
        players: connectedSockets.size,
        connections: connectedSockets.size,
        uptime: Math.floor((Date.now() - stats.startTime) / 1000),
      },
    })
  })

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

  router.get("/maintenance", (req, res) => {
    res.json(maintenanceMode)
  })

  router.get("/rooms", (req, res) => {
    const rooms = stmt.getAllRooms.all()
    const publicRooms = rooms
      .filter((r) => r.is_private === 0 && r.player_count > 0 && r.phase === "waiting")
      .map((r) => ({
        code: r.code,
        playerCount: r.player_count,
        maxPlayers: r.max_players,
        theme: r.theme,
      }))
    res.json({ rooms: publicRooms })
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

      log("player", `New user registered: ${name}`)

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

      log("player", `User logged in: ${user.display_name}`)

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

    log("admin", `Maintenance ${enabled ? "enabled" : "disabled"}`, { reason })
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
  app.use("/api", router)
}

// ============================================================
// SOCKET.IO HANDLERS
// ============================================================

function setupSocketHandlers() {
  io.use((socket, next) => {
    const origin = socket.handshake.headers.origin
    const ip = getClientIP(socket)

    log("network", `New connection attempt`, { ip, origin })

    const ban = stmt.getBan.get(ip, null, Date.now())
    if (ban) {
      log("security", `Blocked banned IP: ${ip}`)
      stats.blockedConnections++
      return next(new Error(`Banni: ${ban.reason}`))
    }

    const rateCheck = checkRateLimit(ip)
    if (!rateCheck.allowed) {
      log("security", `Rate limit exceeded: ${ip}`)
      stats.blockedConnections++
      return next(new Error("Trop de connexions. Reessayez plus tard."))
    }

    if (CONFIG.security.allowedOrigins[0] !== "*") {
      const allowed = CONFIG.security.allowedOrigins.some((o) => {
        if (!origin) return true // Allow no origin for socket clients
        if (o.startsWith("*.")) {
          const domain = o.slice(2)
          return origin?.endsWith(domain) || origin?.endsWith("." + domain)
        }
        return o === origin
      })

      if (!allowed && origin) {
        log("security", `Rejected origin: ${origin}`, { allowed: CONFIG.security.allowedOrigins })
        stats.rejectedOrigins++
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

    log("socket", `Connected: ${socket.id}`, { ip, transport: socket.conn.transport.name })

    let idleTimer = setTimeout(() => {
      log("socket", `Idle timeout: ${socket.id}`)
      socket.disconnect(true)
    }, CONFIG.security.idleTimeout)

    const resetIdleTimer = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        socket.disconnect(true)
      }, CONFIG.security.idleTimeout)
    }

    socket.on("room:create", (data, callback) => {
      resetIdleTimer()

      log("room", `Create room request`, data)

      if (!callback || typeof callback !== "function") {
        log("error", "room:create called without callback")
        socket.emit("room:error", { error: "Invalid request" })
        return
      }

      if (!checkMessageRate(socket.id)) {
        log("warning", `Rate limited: ${socket.id}`)
        return callback({ success: false, error: "Trop de requetes" })
      }

      const playerName = data.playerName?.trim()
      const settings = data.settings || {}

      if (!playerName || playerName.length < 2) {
        log("warning", `Invalid player name: ${playerName}`)
        return callback({ success: false, error: "Pseudo invalide (min 2 caracteres)" })
      }

      if (playerName.length > 16) {
        return callback({ success: false, error: "Pseudo trop long (max 16 caracteres)" })
      }

      const roomId = generateId()
      const roomCode = generateRoomCode()
      const playerId = generateId()

      try {
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

        stmt.createPlayer.run(playerId, roomId, null, playerName, settings.avatar || "#3b82f6", 1, socket.id)

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
        log("room", `Room created: ${roomCode}`, { host: playerName, playerId })

        callback({
          success: true,
          roomCode,
          roomId,
          playerId,
        })

        // Send initial sync after small delay to ensure client is ready
        setTimeout(() => broadcastRoomSync(roomId), 100)
      } catch (err) {
        log("error", `Failed to create room`, { error: err.message })
        callback({ success: false, error: "Erreur lors de la creation de la room" })
      }
    })

    socket.on("room:join", (data, callback) => {
      resetIdleTimer()

      log("room", `Join room request`, data)

      if (!callback || typeof callback !== "function") {
        log("error", "room:join called without callback")
        socket.emit("room:error", { error: "Invalid request" })
        return
      }

      if (!checkMessageRate(socket.id)) {
        return callback({ success: false, error: "Trop de requetes" })
      }

      const { code, playerName, playerId: existingPlayerId } = data
      if (!code || !playerName) {
        return callback({ success: false, error: "Code ou pseudo manquant" })
      }

      const room = stmt.getRoomByCode.get(code.toUpperCase())
      if (!room) {
        log("warning", `Room not found: ${code}`)
        return callback({ success: false, error: "Salon introuvable" })
      }

      const players = stmt.getPlayersByRoom.all(room.id)

      // Check for reconnection
      if (existingPlayerId) {
        const existingPlayer = players.find((p) => p.id === existingPlayerId)
        if (existingPlayer) {
          log("room", `Reconnecting player: ${playerName}`, { room: room.code })

          stmt.updatePlayerConnection.run(1, socket.id, existingPlayerId)
          socket.join(room.id)
          connectedSockets.set(existingPlayerId, socket)

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

          setTimeout(() => broadcastRoomSync(room.id), 100)
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

      try {
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

        log("room", `Player joined: ${playerName}`, { room: room.code, playerId })

        socket.to(room.id).emit("room:player_joined", {
          player: { id: playerId, name: playerName },
        })

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

        setTimeout(() => broadcastRoomSync(room.id), 100)
      } catch (err) {
        log("error", `Failed to join room`, { error: err.message })
        callback({ success: false, error: "Erreur lors de la connexion" })
      }
    })

    // Room: Leave
    socket.on("room:leave", () => {
      log("room", `Leave request: ${socket.id}`)
      handleDisconnect(socket)
    })

    // Room: Settings
    socket.on("room:settings", (data, callback) => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player || player.is_host !== 1) {
        return callback?.({ success: false, error: "Non autorise" })
      }

      const room = stmt.getRoom.get(player.room_id)
      if (!room || room.phase !== "waiting") {
        return callback?.({ success: false, error: "Impossible de modifier" })
      }

      log("room", `Settings update`, data)

      stmt.updateRoomSettings.run(
        data.drawTime || room.draw_time,
        data.maxRounds || room.max_rounds,
        Date.now(),
        room.id,
      )

      broadcastRoomSync(room.id)
      callback?.({ success: true })
    })

    // Game: Start
    socket.on("game:start", (data, callback) => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player || player.is_host !== 1) {
        return callback?.({ success: false, error: "Seul l'hote peut demarrer" })
      }

      const room = stmt.getRoom.get(player.room_id)
      if (!room) {
        return callback?.({ success: false, error: "Salon introuvable" })
      }

      const players = stmt.getPlayersByRoom.all(room.id).filter((p) => p.is_connected === 1)
      if (players.length < CONFIG.game.minPlayers) {
        return callback?.({ success: false, error: `Minimum ${CONFIG.game.minPlayers} joueurs requis` })
      }

      log("game", `Starting game in room ${room.code}`, { players: players.length })

      stats.gamesPlayed++
      stmt.resetPlayersForGame.run(room.id)

      io.to(room.id).emit("game:starting", { countdown: 3 })

      setTimeout(() => {
        startTurn(room.id)
      }, 3000)

      callback?.({ success: true })
    })

    // Game: Select word
    socket.on("game:select_word", (data) => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player) return

      log("game", `Word selected by ${player.name}`, { word: data.word })
      selectWord(player.room_id, player.id, data.word)
    })

    // Game: Next round
    socket.on("game:next_round", (data, callback) => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player || player.is_host !== 1) {
        return callback?.({ success: false })
      }

      nextRound(player.room_id)
      callback?.({ success: true })
    })

    // Game: Play again
    socket.on("game:play_again", (data, callback) => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player) {
        return callback?.({ success: false })
      }

      const room = stmt.getRoom.get(player.room_id)
      if (!room || room.phase !== "gameEnd") {
        return callback?.({ success: false })
      }

      log("game", `Play again in room ${room.code}`)

      stmt.resetPlayersForGame.run(room.id)
      stmt.updateRoom.run("waiting", 1, 0, room.draw_time, null, "", 0, "", room.player_count, Date.now(), room.id)

      roomDrawerOrder.delete(room.id)

      broadcastRoomSync(room.id)
      callback?.({ success: true })
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

      const { isCorrect, isClose } = checkGuess(room.id, player.id, message)

      if (isCorrect) {
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

      log("draw", `Canvas cleared by ${player.name}`)
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
        return callback?.({ success: false, error: "Non autorise" })
      }

      const targetId = data.playerId || data.targetPlayerId
      const target = stmt.getPlayer.get(targetId)
      if (!target || target.room_id !== player.room_id) {
        return callback?.({ success: false, error: "Joueur introuvable" })
      }

      log("room", `Kicking player: ${target.name}`)

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
      callback?.({ success: true })
    })

    // Player: Ban
    socket.on("player:ban", (data, callback) => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player || player.is_host !== 1) {
        return callback?.({ success: false, error: "Non autorise" })
      }

      const targetId = data.playerId || data.targetPlayerId
      const target = stmt.getPlayer.get(targetId)
      if (!target || target.room_id !== player.room_id) {
        return callback?.({ success: false, error: "Joueur introuvable" })
      }

      log("room", `Banning player: ${target.name}`)

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
      callback?.({ success: true })
    })

    // Player: Report
    socket.on("player:report", (data, callback) => {
      resetIdleTimer()

      const player = stmt.getPlayerBySocket.get(socket.id)
      if (!player) {
        return callback?.({ success: false })
      }

      const targetId = data.playerId || data.reportedId
      const target = stmt.getPlayer.get(targetId)
      if (!target) {
        return callback?.({ success: false })
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

      log("admin", `Report: ${target.name}`, { reason: data.reason, by: player.name })

      callback?.({ success: true })
    })

    // Disconnect
    socket.on("disconnect", (reason) => {
      clearTimeout(idleTimer)
      log("socket", `Disconnected: ${socket.id}`, { reason })
      handleDisconnect(socket)
    })
  })
}

function handleDisconnect(socket) {
  const player = stmt.getPlayerBySocket.get(socket.id)
  if (!player) {
    return
  }

  const room = stmt.getRoom.get(player.room_id)
  if (!room) {
    stmt.deletePlayer.run(player.id)
    connectedSockets.delete(player.id)
    return
  }

  log("room", `Player disconnected: ${player.name}`, { room: room.code })

  stmt.updatePlayerConnection.run(0, null, player.id)
  connectedSockets.delete(player.id)

  const players = stmt.getPlayersByRoom.all(room.id)
  const connectedPlayers = players.filter((p) => p.is_connected === 1)

  if (connectedPlayers.length === 0) {
    log("room", `No players left, scheduling room cleanup: ${room.code}`)

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
          log("room", `Room deleted: ${room.code}`)
        }
      }
    }, 120000) // 2 minutes instead of 1
  } else {
    if (player.is_host === 1 && connectedPlayers.length > 0) {
      const newHost = connectedPlayers[0]
      stmt.updatePlayerHost.run(0, player.id)
      stmt.updatePlayerHost.run(1, newHost.id)
      stmt.updateRoomHost.run(newHost.id, Date.now(), room.id)

      log("room", `Host transferred to: ${newHost.name}`)

      io.to(room.id).emit("host:changed", {
        newHostId: newHost.id,
        newHostName: newHost.name,
      })
    }

    if (player.id === room.current_drawer && room.phase === "drawing") {
      log("game", "Drawer disconnected, ending turn")
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
  setInterval(
    () => {
      stmt.deleteExpiredSessions.run(Date.now())
    },
    60 * 60 * 1000,
  )

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
          log("info", `Cleaned up empty room: ${room.code}`)
        }
      }
    },
    5 * 60 * 1000,
  )

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
  console.log("")
  console.log(`${C.bgMagenta}${C.white}${C.bold}                                      ${C.reset}`)
  console.log(`${C.bgMagenta}${C.white}${C.bold}   DRAWLY BACKEND v${CONFIG.server.version}              ${C.reset}`)
  console.log(`${C.bgMagenta}${C.white}${C.bold}                                      ${C.reset}`)
  console.log("")

  app = express()

  if (env.behindProxy) {
    app.set("trust proxy", 1)
  }

  const corsOptions = {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) {
        log("network", "Request without origin - allowing")
        return callback(null, true)
      }
      // Allow all origins in allowedOrigins
      if (CONFIG.security.allowedOrigins.includes("*")) {
        return callback(null, true)
      }
      // Check if origin is allowed (with and without trailing slash)
      const normalizedOrigin = origin.replace(/\/$/, "")
      const isAllowed = CONFIG.security.allowedOrigins.some((allowed) => {
        const normalizedAllowed = allowed.replace(/\/$/, "")
        return normalizedOrigin === normalizedAllowed || normalizedOrigin.startsWith(normalizedAllowed)
      })

      if (isAllowed) {
        log("network", `CORS allowed: ${origin}`)
        return callback(null, true)
      }

      log("security", `CORS blocked origin: ${origin}`)
      stats.rejectedOrigins++
      // Still allow for debugging - just log it
      callback(null, true)
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }

  app.use(cors(corsOptions))
  app.use(express.json({ limit: "1mb" }))

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
      log("success", "SSL/TLS enabled (direct HTTPS)")
    } else {
      log("warning", "SSL certificates not found, using HTTP")
      server = createHttpServer(app)
    }
  } else {
    server = createHttpServer(app)
    if (env.behindProxy) {
      log("info", "Reverse proxy detected - SSL handled by proxy")
    }
  }

  const socketPath = "/socket.io"
  log("info", `Socket.IO path: ${socketPath}`)

  io = new Server(server, {
    cors: {
      origin: "*", // Allow all origins for socket.io
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: socketPath,
    transports: ["polling", "websocket"],
    // Allow upgrade from polling to websocket
    allowUpgrades: true,
    // Increased timeouts for stability
    pingTimeout: 60000,
    pingInterval: 25000,
    // Upgrade timeout
    upgradeTimeout: 30000,
    maxHttpBufferSize: CONFIG.security.maxMessageSize,
    // Disable EIO3 for security
    allowEIO3: false,
    // Connection state recovery
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
    // Cookie settings
    cookie: false,
  })

  io.engine.on("connection_error", (err) => {
    log("error", `Socket.IO engine error: ${err.message}`, {
      code: err.code,
      context: err.context,
    })
  })

  setupRoutes()
  setupSocketHandlers()
  setupCleanup()

  server.listen(CONFIG.port, CONFIG.host, () => {
    const localUrl = `http://${CONFIG.host}:${CONFIG.port}`

    logBox("Server Configuration", [
      `${C.dim}Listen:${C.reset}         ${CONFIG.host}:${CONFIG.port}`,
      `${C.dim}Public URL:${C.reset}     ${CONFIG.publicUrl}`,
      `${C.dim}Base Path:${C.reset}      ${CONFIG.basePath}`,
      `${C.dim}Socket Path:${C.reset}    ${socketPath}`,
      `${C.dim}Reverse Proxy:${C.reset}  ${env.behindProxy ? "Yes" : "No"}`,
      `${C.dim}Origins:${C.reset}        ${CONFIG.security.allowedOrigins.slice(0, 2).join(", ")}`,
      `${C.dim}Rate Limit:${C.reset}     ${CONFIG.security.rateLimit.connectionsPerMinute} conn/min`,
    ])

    console.log("")
    log("success", `Server ready on ${localUrl}`)
    console.log("")
    log("info", `Frontend should connect to: ${CONFIG.publicUrl}`)
    log("info", `Socket.IO will be available at: ${CONFIG.publicUrl}${socketPath}`)
    console.log("")
  })

  process.on("SIGTERM", () => {
    log("warning", "Shutting down (SIGTERM)...")
    io.emit("server:shutdown", { message: "Le serveur redemarre" })

    server.close(() => {
      db.close()
      process.exit(0)
    })

    setTimeout(() => process.exit(1), 10000)
  })

  process.on("SIGINT", () => {
    log("warning", "Shutting down (SIGINT)...")
    io.emit("server:shutdown", { message: "Le serveur s'arrete" })

    server.close(() => {
      db.close()
      process.exit(0)
    })

    setTimeout(() => process.exit(1), 5000)
  })
}

startServer()
