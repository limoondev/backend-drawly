#!/usr/bin/env node
// ============================================================
// DRAWLY BACKEND v5.4.0 - Multi-path Socket.IO for Coolify
// ============================================================
// Optimized for: https://limoon-space.cloud/drawly/api/
// ============================================================

import express from "express"
import { createServer as createHttpServer } from "http"
import { Server } from "socket.io"
import cors from "cors"
import Database from "better-sqlite3"
import { existsSync, mkdirSync } from "fs"
import path from "path"
import crypto from "crypto"

// ============================================================
// AUTO-DETECTION & CONFIGURATION
// ============================================================

const detectEnvironment = () => {
  const isProduction = process.env.NODE_ENV === "production"
  const hasReverseProxy =
    process.env.REVERSE_PROXY === "true" || process.env.TRUST_PROXY === "true" || process.env.HOST === "127.0.0.1"

  const isCoolify = process.env.COOLIFY_FQDN || process.env.COOLIFY_URL || process.env.COOLIFY_CONTAINER_NAME

  const behindProxy =
    hasReverseProxy ||
    isCoolify ||
    existsSync("/etc/nginx") ||
    existsSync("/etc/caddy") ||
    existsSync("/etc/traefik") ||
    process.env.RENDER ||
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.VERCEL

  return {
    isProduction,
    behindProxy,
    isCoolify,
    platform: isCoolify
      ? "coolify"
      : process.env.RENDER
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
    version: "5.4.0",
  },

  port: Number.parseInt(process.env.PORT) || 3001,
  host: process.env.HOST || "0.0.0.0", // Listen on all interfaces for Coolify

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
      : [
          "https://limoon-space.cloud",
          "http://limoon-space.cloud",
          "https://drawly.app",
          "http://localhost:3000",
          "http://127.0.0.1:3000",
          "*", // Allow all for debugging
        ],

    rateLimit: {
      connectionsPerMinute: Number.parseInt(process.env.RATE_LIMIT_CONNECTIONS) || 60,
      messagesPerSecond: Number.parseInt(process.env.RATE_LIMIT_MESSAGES) || 100,
      penaltyTime: 60000,
    },
    maxMessageSize: Number.parseInt(process.env.MAX_MESSAGE_SIZE) || 131072,
    idleTimeout: Number.parseInt(process.env.IDLE_TIMEOUT) || 900000,
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

  const icons = {
    info: `${C.blue}ℹ${C.reset}`,
    success: `${C.green}✓${C.reset}`,
    warning: `${C.yellow}⚠${C.reset}`,
    error: `${C.red}✖${C.reset}`,
    socket: `${C.magenta}⚡${C.reset}`,
    room: `${C.cyan}🏠${C.reset}`,
    game: `${C.brightMagenta}🎮${C.reset}`,
    player: `${C.brightCyan}👤${C.reset}`,
    network: `${C.brightBlue}🌐${C.reset}`,
    db: `${C.brightYellow}💾${C.reset}`,
    security: `${C.brightRed}🔒${C.reset}`,
    debug: `${C.gray}🔍${C.reset}`,
  }

  const icon = icons[type] || icons.info
  const time = new Date().toLocaleTimeString("fr-FR", { hour12: false })
  const typeColor =
    {
      error: C.red,
      warning: C.yellow,
      success: C.green,
      info: C.blue,
      socket: C.magenta,
      room: C.cyan,
      game: C.brightMagenta,
      player: C.brightCyan,
      network: C.brightBlue,
      db: C.brightYellow,
      security: C.brightRed,
      debug: C.gray,
    }[type] || C.white

  console.log(`${C.dim}${time}${C.reset} ${icon} ${typeColor}${message}${C.reset}`)
  if (data) {
    console.log(`       ${C.dim}└─${C.reset}`, data)
  }
}

function logBox(title, lines) {
  const width = 60
  console.log("")
  console.log(`${C.cyan}┌${"─".repeat(width - 2)}┐${C.reset}`)
  console.log(`${C.cyan}│${C.reset} ${C.bold}${title.padEnd(width - 4)}${C.reset} ${C.cyan}│${C.reset}`)
  console.log(`${C.cyan}├${"─".repeat(width - 2)}┤${C.reset}`)
  lines.forEach((line) => {
    const cleanLine = line.replace(/\x1b\[[0-9;]*m/g, "")
    const padding = width - 4 - cleanLine.length
    console.log(`${C.cyan}│${C.reset} ${line}${" ".repeat(Math.max(0, padding))} ${C.cyan}│${C.reset}`)
  })
  console.log(`${C.cyan}└${"─".repeat(width - 2)}┘${C.reset}`)
  console.log("")
}

// ============================================================
// DATABASE
// ============================================================

let db

function initDatabase() {
  const dbDir = path.dirname(CONFIG.database.path)
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true })
    log("db", `Created database directory: ${dbDir}`)
  }

  db = new Database(CONFIG.database.path)
  db.pragma("journal_mode = WAL")
  db.pragma("synchronous = NORMAL")
  db.pragma("foreign_keys = ON")

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_url TEXT,
      is_premium INTEGER DEFAULT 0,
      is_admin INTEGER DEFAULT 0,
      is_banned INTEGER DEFAULT 0,
      ban_reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      bio TEXT,
      country TEXT,
      games_played INTEGER DEFAULT 0,
      games_won INTEGER DEFAULT 0,
      total_score INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      host_id TEXT,
      is_private INTEGER DEFAULT 0,
      max_players INTEGER DEFAULT 8,
      draw_time INTEGER DEFAULT 80,
      max_rounds INTEGER DEFAULT 3,
      theme TEXT DEFAULT 'general',
      phase TEXT DEFAULT 'lobby',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      room_id TEXT REFERENCES rooms(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      name TEXT NOT NULL,
      avatar TEXT,
      score INTEGER DEFAULT 0,
      is_host INTEGER DEFAULT 0,
      socket_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS bans (
      id TEXT PRIMARY KEY,
      ip_address TEXT,
      user_id TEXT REFERENCES users(id),
      reason TEXT,
      banned_by TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_id);
    CREATE INDEX IF NOT EXISTS idx_players_socket ON players(socket_id);
    CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
  `)

  log("db", "Database initialized", { path: CONFIG.database.path })
}

// Prepared statements
let stmt = {}

function prepareStatements() {
  stmt = {
    // Users
    getUserById: db.prepare("SELECT * FROM users WHERE id = ?"),
    getUserByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    getUserByUsername: db.prepare("SELECT * FROM users WHERE username = ?"),
    createUser: db.prepare(`
      INSERT INTO users (id, email, username, display_name, password_hash, avatar_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
    updateUser: db.prepare(`
      UPDATE users SET display_name = ?, avatar_url = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `),
    updatePassword: db.prepare(`
      UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `),

    // Sessions
    createSession: db.prepare(`
      INSERT INTO sessions (id, user_id, token, expires_at)
      VALUES (?, ?, ?, ?)
    `),
    getSessionByToken: db.prepare(`
      SELECT s.*, u.* FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ? AND s.expires_at > datetime('now')
    `),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token = ?"),
    deleteUserSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
    cleanExpiredSessions: db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')"),

    // Profiles
    getProfile: db.prepare("SELECT * FROM profiles WHERE user_id = ?"),
    createProfile: db.prepare("INSERT OR IGNORE INTO profiles (user_id) VALUES (?)"),
    updateProfile: db.prepare(`
      UPDATE profiles SET bio = ?, country = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `),
    updateStats: db.prepare(`
      UPDATE profiles SET 
        games_played = games_played + 1,
        games_won = games_won + ?,
        total_score = total_score + ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `),

    // Rooms
    createRoom: db.prepare(`
      INSERT INTO rooms (id, code, host_id, is_private, max_players, draw_time, max_rounds, theme)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    getRoomByCode: db.prepare("SELECT * FROM rooms WHERE code = ?"),
    getRoomById: db.prepare("SELECT * FROM rooms WHERE id = ?"),
    updateRoomPhase: db.prepare("UPDATE rooms SET phase = ? WHERE id = ?"),
    updateRoomSettings: db.prepare("UPDATE rooms SET draw_time = ?, max_rounds = ? WHERE id = ?"),
    deleteRoom: db.prepare("DELETE FROM rooms WHERE id = ?"),
    getPublicRooms: db.prepare(`
      SELECT r.*, COUNT(p.id) as player_count 
      FROM rooms r 
      LEFT JOIN players p ON r.id = p.room_id
      WHERE r.is_private = 0
      GROUP BY r.id
      HAVING player_count < r.max_players
      ORDER BY player_count DESC
      LIMIT 20
    `),

    // Players
    createPlayer: db.prepare(`
      INSERT INTO players (id, room_id, user_id, name, avatar, is_host, socket_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    getPlayerById: db.prepare("SELECT * FROM players WHERE id = ?"),
    getPlayerBySocket: db.prepare("SELECT * FROM players WHERE socket_id = ?"),
    getPlayersByRoom: db.prepare("SELECT * FROM players WHERE room_id = ?"),
    updatePlayerSocket: db.prepare("UPDATE players SET socket_id = ? WHERE id = ?"),
    updatePlayerScore: db.prepare("UPDATE players SET score = score + ? WHERE id = ?"),
    setPlayerHost: db.prepare("UPDATE players SET is_host = ? WHERE id = ?"),
    deletePlayer: db.prepare("DELETE FROM players WHERE id = ?"),
    deletePlayersByRoom: db.prepare("DELETE FROM players WHERE room_id = ?"),

    // Bans
    getBanByIp: db.prepare(`
      SELECT * FROM bans WHERE ip_address = ? 
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    `),
    getBanByUser: db.prepare(`
      SELECT * FROM bans WHERE user_id = ?
      AND (expires_at IS NULL OR expires_at > datetime('now'))
    `),
    createBan: db.prepare(`
      INSERT INTO bans (id, ip_address, user_id, reason, banned_by, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `),
  }

  log("db", "Prepared statements ready")
}

// ============================================================
// CRYPTO UTILS
// ============================================================

function generateId() {
  return crypto.randomBytes(16).toString("hex")
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  let code = ""
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex")
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex")
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 64, "sha512", (err, key) => {
      if (err) reject(err)
      resolve(`${salt}:${key.toString("hex")}`)
    })
  })
}

async function verifyPassword(password, hash) {
  const [salt, key] = hash.split(":")
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, 100000, 64, "sha512", (err, derivedKey) => {
      if (err) reject(err)
      resolve(key === derivedKey.toString("hex"))
    })
  })
}

// ============================================================
// GAME STATE
// ============================================================

const rooms = new Map()
const socketToPlayer = new Map()
const roomTimers = new Map()
const roomChatHistory = new Map()
const roomDrawerOrder = new Map()

// Rate limiting
const rateLimitMap = new Map()
const messageRateMap = new Map()

// Stats
const stats = {
  totalConnections: 0,
  totalRoomsCreated: 0,
  totalGamesPlayed: 0,
  peakPlayers: 0,
  rejectedOrigins: 0,
  startTime: Date.now(),
}

// ============================================================
// WORD LISTS
// ============================================================

const WORD_LISTS = {
  general: [
    "chat",
    "chien",
    "soleil",
    "maison",
    "voiture",
    "arbre",
    "fleur",
    "montagne",
    "plage",
    "livre",
    "table",
    "chaise",
    "téléphone",
    "ordinateur",
    "pizza",
    "guitare",
    "ballon",
    "avion",
    "bateau",
    "vélo",
    "pomme",
    "banane",
    "orange",
    "fraise",
    "gâteau",
    "chocolat",
    "café",
    "thé",
    "eau",
    "lait",
    "pain",
    "fromage",
    "oeuf",
    "poulet",
    "poisson",
    "salade",
    "soupe",
    "riz",
    "pâtes",
    "hamburger",
    "frites",
    "glace",
    "bonbon",
    "biscuit",
    "croissant",
    "baguette",
    "vin",
    "bière",
    "jus",
    "soda",
    "étoile",
    "lune",
    "nuage",
    "pluie",
    "neige",
    "vent",
    "orage",
    "arc-en-ciel",
    "papillon",
    "oiseau",
    "lapin",
    "souris",
    "éléphant",
    "lion",
    "tigre",
    "girafe",
    "singe",
    "serpent",
    "tortue",
    "grenouille",
    "poule",
    "cochon",
    "vache",
    "mouton",
    "cheval",
    "âne",
    "canard",
    "oie",
    "coq",
    "hibou",
    "chouette",
    "aigle",
    "pigeon",
    "moineau",
    "perroquet",
    "requin",
    "baleine",
    "dauphin",
    "méduse",
    "crabe",
    "homard",
    "crevette",
    "pieuvre",
    "étoile de mer",
    "hippocampe",
    "football",
    "basketball",
    "tennis",
    "rugby",
  ],
  animals: [
    "chat",
    "chien",
    "lion",
    "tigre",
    "éléphant",
    "girafe",
    "singe",
    "serpent",
    "crocodile",
    "hippopotame",
    "rhinocéros",
    "zèbre",
    "kangourou",
    "koala",
    "panda",
    "ours",
    "loup",
    "renard",
    "lapin",
    "souris",
    "hamster",
    "cochon d'inde",
    "perroquet",
    "aigle",
    "hibou",
    "pingouin",
    "flamant rose",
    "autruche",
    "paon",
    "cygne",
  ],
  food: [
    "pizza",
    "hamburger",
    "sushi",
    "tacos",
    "pâtes",
    "salade",
    "soupe",
    "sandwich",
    "crêpe",
    "gaufre",
    "croissant",
    "pain au chocolat",
    "macaron",
    "éclair",
    "tarte",
    "gâteau",
    "glace",
    "chocolat",
    "bonbon",
    "biscuit",
    "pomme",
    "banane",
    "orange",
    "fraise",
    "raisin",
    "pastèque",
    "ananas",
    "mangue",
    "kiwi",
    "cerise",
  ],
  objects: [
    "téléphone",
    "ordinateur",
    "télévision",
    "caméra",
    "montre",
    "lunettes",
    "parapluie",
    "valise",
    "sac à dos",
    "portefeuille",
    "clé",
    "lampe",
    "miroir",
    "horloge",
    "réveil",
    "radio",
    "guitare",
    "piano",
    "violon",
    "tambour",
    "ballon",
    "raquette",
    "skateboard",
    "trottinette",
    "vélo",
    "voiture",
    "avion",
    "bateau",
    "train",
    "fusée",
  ],
  places: [
    "maison",
    "école",
    "hôpital",
    "restaurant",
    "supermarché",
    "bibliothèque",
    "musée",
    "cinéma",
    "théâtre",
    "stade",
    "parc",
    "plage",
    "montagne",
    "forêt",
    "désert",
    "île",
    "lac",
    "rivière",
    "cascade",
    "volcan",
    "château",
    "tour Eiffel",
    "pyramide",
    "statue de la liberté",
    "Big Ben",
    "Colisée",
    "muraille de Chine",
    "Taj Mahal",
    "opéra de Sydney",
    "pont",
  ],
}

function getRandomWords(theme = "general", count = 3) {
  const list = WORD_LISTS[theme] || WORD_LISTS.general
  const words = []
  const used = new Set()

  while (words.length < count && words.length < list.length) {
    const word = list[Math.floor(Math.random() * list.length)]
    if (!used.has(word)) {
      used.add(word)
      words.push(word)
    }
  }

  return words
}

function maskWord(word) {
  return word
    .split("")
    .map((c) => (c === " " ? "  " : "_"))
    .join(" ")
}

function revealHint(word, masked) {
  const chars = word.split("")
  const maskedChars = masked.split(" ")

  const hiddenIndices = []
  chars.forEach((c, i) => {
    if (c !== " " && maskedChars[i] === "_") {
      hiddenIndices.push(i)
    }
  })

  if (hiddenIndices.length === 0) return masked

  const revealIndex = hiddenIndices[Math.floor(Math.random() * hiddenIndices.length)]
  maskedChars[revealIndex] = chars[revealIndex]

  return maskedChars.join(" ")
}

// ============================================================
// ROOM MANAGEMENT
// ============================================================

function createRoom(hostPlayer, settings = {}) {
  const id = generateId()
  let code = generateCode()

  // Ensure unique code
  while (stmt.getRoomByCode.get(code)) {
    code = generateCode()
  }

  const room = {
    id,
    code,
    hostId: hostPlayer.id,
    isPrivate: settings.isPrivate || false,
    maxPlayers: Math.min(settings.maxPlayers || 8, CONFIG.game.maxPlayers),
    drawTime: settings.drawTime || CONFIG.game.defaultDrawTime,
    maxRounds: settings.rounds || CONFIG.game.defaultRounds,
    theme: settings.theme || "general",
    phase: "lobby",
    round: 0,
    turn: 0,
    currentDrawer: null,
    currentWord: null,
    maskedWord: "",
    wordLength: 0,
    timeLeft: 0,
    players: new Map(),
    guessedPlayers: new Set(),
    createdAt: Date.now(),
  }

  // Save to database
  stmt.createRoom.run(
    id,
    code,
    hostPlayer.id,
    room.isPrivate ? 1 : 0,
    room.maxPlayers,
    room.drawTime,
    room.maxRounds,
    room.theme,
  )

  rooms.set(id, room)
  roomChatHistory.set(id, [])
  roomDrawerOrder.set(id, [])
  stats.totalRoomsCreated++

  log("room", `Room created: ${code}`, { id, host: hostPlayer.name })

  return room
}

function joinRoom(room, player) {
  room.players.set(player.id, player)

  // Update drawer order
  const order = roomDrawerOrder.get(room.id) || []
  order.push(player.id)
  roomDrawerOrder.set(room.id, order)

  // Save player to database
  stmt.createPlayer.run(
    player.id,
    room.id,
    player.userId || null,
    player.name,
    player.avatar || null,
    0,
    player.socketId,
  )

  log("player", `${player.name} joined room ${room.code}`)
}

function leaveRoom(room, playerId, io) {
  const player = room.players.get(playerId)
  if (!player) return

  room.players.delete(playerId)
  stmt.deletePlayer.run(playerId)

  // Update drawer order
  const order = roomDrawerOrder.get(room.id) || []
  const idx = order.indexOf(playerId)
  if (idx !== -1) order.splice(idx, 1)
  roomDrawerOrder.set(room.id, order)

  log("player", `${player.name} left room ${room.code}`)

  // Notify others
  io.to(room.id).emit("player:disconnected", {
    playerId,
    reason: "left",
  })

  // Handle host change
  if (room.hostId === playerId && room.players.size > 0) {
    const newHost = room.players.values().next().value
    room.hostId = newHost.id
    newHost.isHost = true
    stmt.setPlayerHost.run(1, newHost.id)

    io.to(room.id).emit("host:changed", {
      newHostId: newHost.id,
      newHostName: newHost.name,
    })

    log("room", `New host: ${newHost.name} in room ${room.code}`)
  }

  // Handle empty room
  if (room.players.size === 0) {
    scheduleRoomCleanup(room.id)
  }

  // Handle game interruption
  if (room.phase !== "lobby" && room.currentDrawer === playerId) {
    endTurn(room, io, "Le dessinateur a quitté")
  }
}

function scheduleRoomCleanup(roomId) {
  // Wait 2 minutes before deleting empty room
  const timer = setTimeout(
    () => {
      const room = rooms.get(roomId)
      if (room && room.players.size === 0) {
        clearRoomTimers(roomId)
        stmt.deletePlayersByRoom.run(roomId)
        stmt.deleteRoom.run(roomId)
        rooms.delete(roomId)
        roomChatHistory.delete(roomId)
        roomDrawerOrder.delete(roomId)
        log("room", `Cleaned up empty room: ${room.code}`)
      }
    },
    2 * 60 * 1000,
  )

  const timers = roomTimers.get(roomId) || {}
  timers.cleanup = timer
  roomTimers.set(roomId, timers)
}

function clearRoomTimers(roomId) {
  const timers = roomTimers.get(roomId)
  if (timers) {
    Object.values(timers).forEach((t) => clearTimeout(t))
    roomTimers.delete(roomId)
  }
}

// ============================================================
// GAME LOGIC
// ============================================================

function startGame(room, io) {
  room.phase = "waiting"
  room.round = 1
  room.turn = 0
  room.guessedPlayers.clear()

  // Reset scores
  room.players.forEach((p) => {
    p.score = 0
    p.hasGuessed = false
    p.isDrawing = false
  })

  // Initialize drawer order
  const playerIds = Array.from(room.players.keys())
  roomDrawerOrder.set(room.id, shuffleArray([...playerIds]))

  stmt.updateRoomPhase.run("playing", room.id)
  stats.totalGamesPlayed++

  log("game", `Game started in room ${room.code}`, { players: room.players.size })

  // Start first turn after countdown
  io.to(room.id).emit("game:starting", { countdown: 3 })

  const timer = setTimeout(() => {
    startTurn(room, io)
  }, 3000)

  const timers = roomTimers.get(room.id) || {}
  timers.start = timer
  roomTimers.set(room.id, timers)
}

function startTurn(room, io) {
  // Get next drawer
  const order = roomDrawerOrder.get(room.id) || []
  if (order.length === 0) {
    endGame(room, io)
    return
  }

  const drawerId = order[room.turn % order.length]
  const drawer = room.players.get(drawerId)

  if (!drawer) {
    room.turn++
    if (room.turn >= order.length) {
      room.turn = 0
      room.round++
      if (room.round > room.maxRounds) {
        endGame(room, io)
        return
      }
    }
    startTurn(room, io)
    return
  }

  room.phase = "choosing"
  room.currentDrawer = drawerId
  room.guessedPlayers.clear()

  room.players.forEach((p) => {
    p.isDrawing = p.id === drawerId
    p.hasGuessed = false
  })

  // Send word choices to drawer
  const words = getRandomWords(room.theme, 3)
  const drawerSocket = Array.from(io.sockets.sockets.values()).find((s) => socketToPlayer.get(s.id)?.id === drawerId)

  if (drawerSocket) {
    drawerSocket.emit("game:choose_word", { words })
  }

  // Sync room state
  syncRoom(room, io)

  log("game", `Turn started in ${room.code}`, { drawer: drawer.name, round: room.round })

  // Auto-select word after timeout
  const timer = setTimeout(() => {
    if (room.phase === "choosing") {
      selectWord(room, io, words[0])
    }
  }, 15000)

  const timers = roomTimers.get(room.id) || {}
  timers.choose = timer
  roomTimers.set(room.id, timers)
}

function selectWord(room, io, word) {
  room.phase = "drawing"
  room.currentWord = word
  room.wordLength = word.length
  room.maskedWord = maskWord(word)
  room.timeLeft = room.drawTime

  const timers = roomTimers.get(room.id) || {}
  clearTimeout(timers.choose)

  // Send word to drawer
  const drawerSocket = Array.from(io.sockets.sockets.values()).find(
    (s) => socketToPlayer.get(s.id)?.id === room.currentDrawer,
  )
  if (drawerSocket) {
    drawerSocket.emit("game:word", { word })
  }

  // Notify all players
  io.to(room.id).emit("game:turn_start", {
    drawerId: room.currentDrawer,
    wordLength: room.wordLength,
    maskedWord: room.maskedWord,
    timeLeft: room.timeLeft,
  })

  // Start timer
  const tickInterval = setInterval(() => {
    room.timeLeft--

    if (room.timeLeft <= 0) {
      clearInterval(tickInterval)
      endTurn(room, io, "Temps écoulé!")
      return
    }

    io.to(room.id).emit("game:time_update", { timeLeft: room.timeLeft })

    // Hints every 20 seconds
    if (room.timeLeft % 20 === 0 && room.timeLeft < room.drawTime - 10) {
      room.maskedWord = revealHint(room.currentWord, room.maskedWord)
      io.to(room.id).emit("game:hint", { maskedWord: room.maskedWord })
    }
  }, 1000)

  timers.tick = tickInterval
  roomTimers.set(room.id, timers)

  log("game", `Word selected in ${room.code}: ${word}`)
}

function handleGuess(room, player, message, io) {
  if (!room.currentWord || player.id === room.currentDrawer || player.hasGuessed) {
    return { isCorrect: false, isClose: false }
  }

  const guess = message.toLowerCase().trim()
  const word = room.currentWord.toLowerCase()

  if (guess === word) {
    player.hasGuessed = true
    room.guessedPlayers.add(player.id)

    // Calculate points
    const timeBonus = Math.floor((room.timeLeft / room.drawTime) * 100)
    const orderBonus = Math.max(0, 100 - room.guessedPlayers.size * 20)
    const points = 100 + timeBonus + orderBonus

    player.score += points
    stmt.updatePlayerScore.run(points, player.id)

    // Give drawer points too
    const drawer = room.players.get(room.currentDrawer)
    if (drawer) {
      drawer.score += 25
      stmt.updatePlayerScore.run(25, drawer.id)
    }

    io.to(room.id).emit("game:correct_guess", {
      playerId: player.id,
      playerName: player.name,
      points,
    })

    log("game", `${player.name} guessed correctly in ${room.code}`, { word, points })

    // Check if everyone guessed
    const nonDrawerCount = room.players.size - 1
    if (room.guessedPlayers.size >= nonDrawerCount) {
      setTimeout(() => endTurn(room, io, "Tout le monde a trouvé!"), 1000)
    }

    return { isCorrect: true, isClose: false }
  }

  // Check for close guess
  if (isCloseGuess(guess, word)) {
    return { isCorrect: false, isClose: true }
  }

  return { isCorrect: false, isClose: false }
}

function isCloseGuess(guess, word) {
  if (guess.length < 3) return false

  // Check if one letter away
  if (Math.abs(guess.length - word.length) <= 1) {
    let diff = 0
    const maxLen = Math.max(guess.length, word.length)
    for (let i = 0; i < maxLen; i++) {
      if (guess[i] !== word[i]) diff++
    }
    if (diff <= 2) return true
  }

  // Check if contains most of the word
  if (word.includes(guess) || guess.includes(word)) return true

  return false
}

function endTurn(room, io, reason = "") {
  const timers = roomTimers.get(room.id) || {}
  clearInterval(timers.tick)
  clearTimeout(timers.choose)

  room.phase = "roundEnd"

  io.to(room.id).emit("game:turn_end", {
    word: room.currentWord,
    reason,
    allGuessed: room.guessedPlayers.size >= room.players.size - 1,
  })

  log("game", `Turn ended in ${room.code}`, { word: room.currentWord, reason })

  // Next turn after delay
  const timer = setTimeout(() => {
    room.turn++
    const order = roomDrawerOrder.get(room.id) || []

    if (room.turn >= order.length) {
      room.turn = 0
      room.round++

      if (room.round > room.maxRounds) {
        endGame(room, io)
        return
      }

      io.to(room.id).emit("game:round_end", { round: room.round })
    }

    startTurn(room, io)
  }, CONFIG.game.turnEndDelay)

  timers.nextTurn = timer
  roomTimers.set(room.id, timers)
}

function endGame(room, io) {
  room.phase = "gameEnd"
  clearRoomTimers(room.id)

  // Calculate rankings
  const rankings = Array.from(room.players.values())
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({
      rank: i + 1,
      id: p.id,
      name: p.name,
      score: p.score,
      userId: p.userId,
    }))

  // Update user stats
  rankings.forEach((r) => {
    if (r.userId) {
      const won = r.rank === 1 ? 1 : 0
      stmt.updateStats.run(won, r.score, r.userId)
    }
  })

  io.to(room.id).emit("game:ended", { rankings })

  log("game", `Game ended in ${room.code}`, {
    winner: rankings[0]?.name,
    players: rankings.length,
  })

  stmt.updateRoomPhase.run("lobby", room.id)
}

function syncRoom(room, io) {
  const players = Array.from(room.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    isHost: room.hostId === p.id,
    isDrawing: room.currentDrawer === p.id,
    hasGuessed: p.hasGuessed,
    avatar: p.avatar || "default",
    isConnected: true,
  }))

  io.to(room.id).emit("room:sync", {
    room: {
      id: room.id,
      code: room.code,
      phase: room.phase,
      round: room.round,
      turn: room.turn,
      maxRounds: room.maxRounds,
      timeLeft: room.timeLeft,
      drawTime: room.drawTime,
      currentDrawer: room.currentDrawer,
      wordLength: room.wordLength,
      maskedWord: room.maskedWord,
      theme: room.theme,
      isPrivate: room.isPrivate,
      maxPlayers: room.maxPlayers,
    },
    players,
  })
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
  return array
}

// ============================================================
// EXPRESS ROUTES
// ============================================================

let app, server, io

function setupRoutes() {
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Admin-Key",
    )
    res.header("Access-Control-Allow-Credentials", "true")

    if (req.method === "OPTIONS") {
      return res.status(200).end()
    }
    next()
  })

  const getStatusResponse = () => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000)
    return {
      name: CONFIG.server.name,
      version: CONFIG.server.version,
      status: "online",
      players: socketToPlayer.size,
      rooms: rooms.size,
      connections: socketToPlayer.size,
      uptime,
      stats: {
        connections: socketToPlayer.size,
        players: socketToPlayer.size,
        rooms: rooms.size,
        activeRooms: rooms.size,
        uptime,
      },
    }
  }

  app.get("/", (req, res) => res.json(getStatusResponse()))
  app.get("/status", (req, res) => res.json(getStatusResponse()))
  app.get("/health", (req, res) => res.json(getStatusResponse()))
  app.get("/info", (req, res) =>
    res.json({ ...getStatusResponse(), features: ["rooms", "auth", "chat", "drawing", "word-selection"] }),
  )
  app.get("/api/status", (req, res) => res.json(getStatusResponse()))
  app.get("/api/info", (req, res) =>
    res.json({ ...getStatusResponse(), features: ["rooms", "auth", "chat", "drawing", "word-selection"] }),
  )
  app.get("/api/health", (req, res) => res.json(getStatusResponse()))

  app.get("/socket.io/", (req, res) => {
    res.json({
      status: "Socket.IO endpoint",
      hint: "This endpoint handles Socket.IO connections",
    })
  })

  // Stats endpoint
  app.get("/api/stats", (req, res) => {
    const memUsage = process.memoryUsage()
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000)
    res.json({
      connections: socketToPlayer.size,
      rooms: rooms.size,
      players: Array.from(rooms.values()).reduce((sum, r) => sum + r.players.size, 0),
      games: stats.totalGamesPlayed,
      uptime,
      stats: {
        connections: socketToPlayer.size,
        players: socketToPlayer.size,
        rooms: rooms.size,
        activeRooms: rooms.size,
        uptime,
      },
      memory: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024),
        total: Math.round(memUsage.heapTotal / 1024 / 1024),
      },
    })
  })

  // Public rooms
  app.get("/api/rooms", (req, res) => {
    const publicRooms = stmt.getPublicRooms.all()
    res.json({
      rooms: publicRooms.map((r) => ({
        code: r.code,
        playerCount: r.player_count,
        maxPlayers: r.max_players,
        phase: r.phase,
        theme: r.theme,
      })),
    })
  })

  // Auth: Register
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { email, password, username, displayName } = req.body

      if (!email || !password) {
        return res.status(400).json({ success: false, error: "Email et mot de passe requis" })
      }

      if (password.length < 6) {
        return res.status(400).json({ success: false, error: "Mot de passe trop court (min 6)" })
      }

      // Check existing
      if (stmt.getUserByEmail.get(email)) {
        return res.status(400).json({ success: false, error: "Email déjà utilisé" })
      }

      if (username && stmt.getUserByUsername.get(username)) {
        return res.status(400).json({ success: false, error: "Nom d'utilisateur déjà pris" })
      }

      const userId = generateId()
      const passwordHash = await hashPassword(password)
      const name = displayName || username || email.split("@")[0]

      stmt.createUser.run(userId, email, username || null, name, passwordHash, null)
      stmt.createProfile.run(userId)

      // Create session
      const token = generateToken()
      const sessionId = generateId()
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

      stmt.createSession.run(sessionId, userId, token, expiresAt)

      const user = stmt.getUserById.get(userId)

      log("success", `User registered: ${email}`)

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
          isPremium: !!user.is_premium,
          isAdmin: !!user.is_admin,
        },
        session: {
          token,
          expiresAt: new Date(expiresAt).getTime(),
        },
      })
    } catch (err) {
      log("error", "Registration failed", err.message)
      res.status(500).json({ success: false, error: "Erreur serveur" })
    }
  })

  // Auth: Login
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = req.body

      if (!email || !password) {
        return res.status(400).json({ success: false, error: "Email et mot de passe requis" })
      }

      const user = stmt.getUserByEmail.get(email)
      if (!user) {
        return res.status(401).json({ success: false, error: "Email ou mot de passe incorrect" })
      }

      if (user.is_banned) {
        return res.status(403).json({ success: false, error: "Compte banni: " + (user.ban_reason || "") })
      }

      const valid = await verifyPassword(password, user.password_hash)
      if (!valid) {
        return res.status(401).json({ success: false, error: "Email ou mot de passe incorrect" })
      }

      // Create session
      const token = generateToken()
      const sessionId = generateId()
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

      stmt.createSession.run(sessionId, user.id, token, expiresAt)

      log("success", `User logged in: ${email}`)

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
          isPremium: !!user.is_premium,
          isAdmin: !!user.is_admin,
        },
        session: {
          token,
          expiresAt: new Date(expiresAt).getTime(),
        },
      })
    } catch (err) {
      log("error", "Login failed", err.message)
      res.status(500).json({ success: false, error: "Erreur serveur" })
    }
  })

  // Auth: Logout
  app.post("/api/auth/logout", (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "")
    if (token) {
      stmt.deleteSession.run(token)
    }
    res.json({ success: true })
  })

  // Auth: Get current user
  app.get("/api/auth/me", (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "")
    if (!token) {
      return res.status(401).json({ error: "Non authentifié" })
    }

    const session = stmt.getSessionByToken.get(token)
    if (!session) {
      return res.status(401).json({ error: "Session invalide" })
    }

    const profile = stmt.getProfile.get(session.user_id)

    res.json({
      user: {
        id: session.id,
        email: session.email,
        username: session.username,
        displayName: session.display_name,
        avatarUrl: session.avatar_url,
        isPremium: !!session.is_premium,
        isAdmin: !!session.is_admin,
      },
      profile: profile
        ? {
            bio: profile.bio,
            country: profile.country,
            gamesPlayed: profile.games_played,
            gamesWon: profile.games_won,
            totalScore: profile.total_score,
          }
        : null,
    })
  })

  // Auth: Update profile
  app.put("/api/auth/profile", (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "")
    if (!token) {
      return res.status(401).json({ success: false, error: "Non authentifié" })
    }

    const session = stmt.getSessionByToken.get(token)
    if (!session) {
      return res.status(401).json({ success: false, error: "Session invalide" })
    }

    const { displayName, avatarUrl, bio, country } = req.body

    if (displayName || avatarUrl) {
      stmt.updateUser.run(displayName || session.display_name, avatarUrl || session.avatar_url, session.user_id)
    }

    if (bio !== undefined || country !== undefined) {
      const profile = stmt.getProfile.get(session.user_id)
      stmt.updateProfile.run(bio ?? profile?.bio, country ?? profile?.country, session.user_id)
    }

    res.json({ success: true })
  })

  // Auth: Change password
  app.post("/api/auth/change-password", async (req, res) => {
    const token = req.headers.authorization?.replace("Bearer ", "")
    if (!token) {
      return res.status(401).json({ success: false, error: "Non authentifié" })
    }

    const session = stmt.getSessionByToken.get(token)
    if (!session) {
      return res.status(401).json({ success: false, error: "Session invalide" })
    }

    const { currentPassword, newPassword } = req.body

    const user = stmt.getUserById.get(session.user_id)
    const valid = await verifyPassword(currentPassword, user.password_hash)
    if (!valid) {
      return res.status(401).json({ success: false, error: "Mot de passe actuel incorrect" })
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: "Nouveau mot de passe trop court" })
    }

    const newHash = await hashPassword(newPassword)
    stmt.updatePassword.run(newHash, session.user_id)

    // Invalidate all sessions and create new one
    stmt.deleteUserSessions.run(session.user_id)

    const newToken = generateToken()
    const sessionId = generateId()
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

    stmt.createSession.run(sessionId, session.user_id, newToken, expiresAt)

    res.json({
      success: true,
      session: {
        token: newToken,
        expiresAt: new Date(expiresAt).getTime(),
      },
    })
  })

  // Logs (admin only - simplified check)
  app.get("/api/logs", (req, res) => {
    const limit = Math.min(Number.parseInt(req.query.limit) || 100, 500)
    const type = req.query.type

    let logs = recentLogs
    if (type) {
      logs = logs.filter((l) => l.type === type)
    }

    res.json({ logs: logs.slice(0, limit) })
  })
}

// ============================================================
// SOCKET HANDLERS
// ============================================================

function setupSocketHandlers() {
  io.on("connection", (socket) => {
    const clientIp = socket.handshake.headers["x-forwarded-for"] || socket.handshake.address
    stats.totalConnections++

    log("socket", `Connection: ${socket.id}`, { ip: clientIp })

    // Rate limiting
    const rateData = rateLimitMap.get(clientIp) || { count: 0, resetAt: Date.now() + 60000 }
    if (Date.now() > rateData.resetAt) {
      rateData.count = 0
      rateData.resetAt = Date.now() + 60000
    }
    rateData.count++
    rateLimitMap.set(clientIp, rateData)

    if (rateData.count > CONFIG.security.rateLimit.connectionsPerMinute) {
      log("security", `Rate limited: ${clientIp}`)
      socket.emit("error", { message: "Trop de connexions" })
      socket.disconnect(true)
      return
    }

    // Create room
    socket.on("room:create", (data, callback) => {
      try {
        log("room", `Creating room for: ${data.playerName}`)

        const playerId = generateId()
        const player = {
          id: playerId,
          socketId: socket.id,
          name: data.playerName?.slice(0, 20) || "Joueur",
          avatar: data.settings?.avatar || "default",
          score: 0,
          isHost: true,
          isDrawing: false,
          hasGuessed: false,
          userId: null,
        }

        const room = createRoom(player, data.settings)
        joinRoom(room, player)

        socketToPlayer.set(socket.id, player)
        socket.join(room.id)

        log("success", `Room created: ${room.code}`, { player: player.name })

        callback({
          success: true,
          roomCode: room.code,
          roomId: room.id,
          playerId: player.id,
        })

        syncRoom(room, io)
      } catch (err) {
        log("error", "Room creation failed", err.message)
        callback({ success: false, error: "Erreur lors de la création" })
      }
    })

    // Join room
    socket.on("room:join", (data, callback) => {
      try {
        log("room", `Join request: ${data.roomCode} by ${data.playerName}`)

        const roomData = stmt.getRoomByCode.get(data.roomCode?.toUpperCase())
        if (!roomData) {
          return callback({ success: false, error: "Partie introuvable" })
        }

        let room = rooms.get(roomData.id)
        if (!room) {
          // Reconstruct room from DB
          room = {
            id: roomData.id,
            code: roomData.code,
            hostId: roomData.host_id,
            isPrivate: !!roomData.is_private,
            maxPlayers: roomData.max_players,
            drawTime: roomData.draw_time,
            maxRounds: roomData.max_rounds,
            theme: roomData.theme || "general",
            phase: roomData.phase || "lobby",
            round: 0,
            turn: 0,
            currentDrawer: null,
            currentWord: null,
            maskedWord: "",
            wordLength: 0,
            timeLeft: 0,
            players: new Map(),
            guessedPlayers: new Set(),
            createdAt: Date.now(),
          }
          rooms.set(room.id, room)
        }

        if (room.players.size >= room.maxPlayers) {
          return callback({ success: false, error: "Partie pleine" })
        }

        if (room.phase !== "lobby") {
          return callback({ success: false, error: "Partie en cours" })
        }

        const playerId = data.playerId || generateId()
        const player = {
          id: playerId,
          socketId: socket.id,
          name: data.playerName?.slice(0, 20) || "Joueur",
          avatar: data.avatar || "default",
          score: 0,
          isHost: false,
          isDrawing: false,
          hasGuessed: false,
          userId: null,
        }

        joinRoom(room, player)
        socketToPlayer.set(socket.id, player)
        socket.join(room.id)

        log("success", `${player.name} joined ${room.code}`)

        const messages = roomChatHistory.get(room.id) || []

        callback({
          success: true,
          roomCode: room.code,
          roomId: room.id,
          playerId: player.id,
          messages: messages.slice(-50),
        })

        io.to(room.id).emit("player:joined", {
          id: player.id,
          name: player.name,
        })

        syncRoom(room, io)
      } catch (err) {
        log("error", "Join failed", err.message)
        callback({ success: false, error: "Erreur lors de la connexion" })
      }
    })

    // Leave room
    socket.on("room:leave", () => {
      const player = socketToPlayer.get(socket.id)
      if (!player) return

      const room = Array.from(rooms.values()).find((r) => r.players.has(player.id))
      if (room) {
        leaveRoom(room, player.id, io)
        socket.leave(room.id)
      }

      socketToPlayer.delete(socket.id)
    })

    // Room settings
    socket.on("room:settings", (data, callback) => {
      const player = socketToPlayer.get(socket.id)
      if (!player) return callback({ success: false })

      const room = Array.from(rooms.values()).find((r) => r.players.has(player.id))
      if (!room || room.hostId !== player.id) return callback({ success: false })

      if (data.drawTime) room.drawTime = Math.max(30, Math.min(180, data.drawTime))
      if (data.maxRounds) room.maxRounds = Math.max(1, Math.min(10, data.maxRounds))

      stmt.updateRoomSettings.run(room.drawTime, room.maxRounds, room.id)
      syncRoom(room, io)
      callback({ success: true })
    })

    // Start game
    socket.on("game:start", (_, callback) => {
      const player = socketToPlayer.get(socket.id)
      if (!player) return callback({ success: false, error: "Non connecté" })

      const room = Array.from(rooms.values()).find((r) => r.players.has(player.id))
      if (!room) return callback({ success: false, error: "Partie introuvable" })

      if (room.hostId !== player.id) {
        return callback({ success: false, error: "Seul l'hôte peut démarrer" })
      }

      if (room.players.size < CONFIG.game.minPlayers) {
        return callback({ success: false, error: `Minimum ${CONFIG.game.minPlayers} joueurs` })
      }

      if (room.phase !== "lobby") {
        return callback({ success: false, error: "Partie déjà en cours" })
      }

      startGame(room, io)
      callback({ success: true })
    })

    // Select word
    socket.on("game:select_word", (data) => {
      const player = socketToPlayer.get(socket.id)
      if (!player) return

      const room = Array.from(rooms.values()).find((r) => r.players.has(player.id))
      if (!room || room.currentDrawer !== player.id || room.phase !== "choosing") return

      selectWord(room, io, data.word)
    })

    // Chat message
    socket.on("chat:message", (data) => {
      const player = socketToPlayer.get(socket.id)
      if (!player || !data.message) return

      // Rate limit messages
      const msgRate = messageRateMap.get(socket.id) || { count: 0, resetAt: Date.now() + 1000 }
      if (Date.now() > msgRate.resetAt) {
        msgRate.count = 0
        msgRate.resetAt = Date.now() + 1000
      }
      msgRate.count++
      messageRateMap.set(socket.id, msgRate)

      if (msgRate.count > CONFIG.security.rateLimit.messagesPerSecond) {
        return socket.emit("chat:error", { message: "Trop de messages" })
      }

      const room = Array.from(rooms.values()).find((r) => r.players.has(player.id))
      if (!room) return

      const message = data.message.slice(0, 200).trim()
      if (!message) return

      // Check for guess
      let guessResult = { isCorrect: false, isClose: false }
      if (room.phase === "drawing" && room.currentDrawer !== player.id && !player.hasGuessed) {
        guessResult = handleGuess(room, player, message, io)
      }

      // Don't send correct guesses to chat
      if (guessResult.isCorrect) {
        syncRoom(room, io)
        return
      }

      const chatMsg = {
        id: generateId(),
        playerId: player.id,
        playerName: player.name,
        message,
        timestamp: Date.now(),
        isClose: guessResult.isClose,
        isGuess: room.phase === "drawing" && room.currentDrawer !== player.id,
      }

      const history = roomChatHistory.get(room.id) || []
      history.push(chatMsg)
      if (history.length > 100) history.shift()
      roomChatHistory.set(room.id, history)

      io.to(room.id).emit("chat:message", chatMsg)

      if (guessResult.isClose) {
        socket.emit("game:close_guess", { message: "Tu es proche!" })
      }
    })

    // Drawing
    socket.on("draw:stroke", (data) => {
      const player = socketToPlayer.get(socket.id)
      if (!player) return

      const room = Array.from(rooms.values()).find((r) => r.players.has(player.id))
      if (!room || room.currentDrawer !== player.id) return

      socket.to(room.id).emit("draw:stroke", data)
    })

    socket.on("draw:clear", () => {
      const player = socketToPlayer.get(socket.id)
      if (!player) return

      const room = Array.from(rooms.values()).find((r) => r.players.has(player.id))
      if (!room || room.currentDrawer !== player.id) return

      socket.to(room.id).emit("draw:clear")
    })

    socket.on("draw:undo", () => {
      const player = socketToPlayer.get(socket.id)
      if (!player) return

      const room = Array.from(rooms.values()).find((r) => r.players.has(player.id))
      if (!room || room.currentDrawer !== player.id) return

      socket.to(room.id).emit("draw:undo")
    })

    // Play again
    socket.on("game:play_again", (_, callback) => {
      const player = socketToPlayer.get(socket.id)
      if (!player) return callback({ success: false })

      const room = Array.from(rooms.values()).find((r) => r.players.has(player.id))
      if (!room || room.hostId !== player.id) return callback({ success: false })

      room.phase = "lobby"
      room.round = 0
      room.turn = 0
      room.currentDrawer = null
      room.currentWord = null
      room.players.forEach((p) => {
        p.score = 0
        p.hasGuessed = false
        p.isDrawing = false
      })

      stmt.updateRoomPhase.run("lobby", room.id)
      syncRoom(room, io)
      callback({ success: true })
    })

    // Kick player
    socket.on("player:kick", (data, callback) => {
      const player = socketToPlayer.get(socket.id)
      if (!player) return callback({ success: false })

      const room = Array.from(rooms.values()).find((r) => r.players.has(player.id))
      if (!room || room.hostId !== player.id) return callback({ success: false, error: "Non autorisé" })

      const target = room.players.get(data.playerId)
      if (!target || target.id === player.id) return callback({ success: false })

      // Find target socket
      const targetSocket = Array.from(io.sockets.sockets.values()).find(
        (s) => socketToPlayer.get(s.id)?.id === target.id,
      )

      if (targetSocket) {
        targetSocket.emit("player:kicked", { reason: "Expulsé par l'hôte" })
        targetSocket.leave(room.id)
        socketToPlayer.delete(targetSocket.id)
      }

      leaveRoom(room, target.id, io)
      callback({ success: true })
    })

    // Disconnect
    socket.on("disconnect", (reason) => {
      log("socket", `Disconnected: ${socket.id}`, { reason })

      const player = socketToPlayer.get(socket.id)
      if (player) {
        const room = Array.from(rooms.values()).find((r) => r.players.has(player.id))
        if (room) {
          leaveRoom(room, player.id, io)
        }
        socketToPlayer.delete(socket.id)
      }
    })
  })

  log("socket", "Socket handlers initialized")
}

// ============================================================
// CLEANUP
// ============================================================

function setupCleanup() {
  // Clean expired sessions hourly
  setInterval(
    () => {
      const result = stmt.cleanExpiredSessions.run()
      if (result.changes > 0) {
        log("db", `Cleaned ${result.changes} expired sessions`)
      }
    },
    60 * 60 * 1000,
  )

  // Clean empty rooms every 5 minutes
  setInterval(
    () => {
      for (const [id, room] of rooms) {
        if (room.players.size === 0) {
          clearRoomTimers(room.id)
          stmt.deletePlayersByRoom.run(room.id)
          stmt.deleteRoom.run(room.id)
          rooms.delete(id)
          roomChatHistory.delete(room.id)
          roomDrawerOrder.delete(room.id)
          log("info", `Cleaned up empty room: ${room.code}`)
        }
      }
    },
    5 * 60 * 1000,
  )

  // Clean rate limit maps
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

  app.set("trust proxy", true)

  const corsOptions = {
    origin: "*", // Allow all origins for Coolify
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

  server = createHttpServer(app)
  log("info", "HTTP server created (SSL handled by Coolify/Traefik)")

  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/socket.io",
    transports: ["polling", "websocket"],
    allowUpgrades: true,
    pingTimeout: 60000,
    pingInterval: 25000,
    upgradeTimeout: 30000,
    maxHttpBufferSize: CONFIG.security.maxMessageSize,
    allowEIO3: false,
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
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
    logBox("Server Configuration", [
      `${C.dim}Listen:${C.reset}         ${CONFIG.host}:${CONFIG.port}`,
      `${C.dim}Public URL:${C.reset}     ${CONFIG.publicUrl}`,
      `${C.dim}Platform:${C.reset}       ${env.platform}`,
      `${C.dim}Socket Path:${C.reset}    /socket.io`,
      `${C.dim}Coolify:${C.reset}        ${env.isCoolify ? "Yes" : "No"}`,
      `${C.dim}Origins:${C.reset}        * (all allowed)`,
    ])

    log("success", `Server is running on port ${CONFIG.port}`)
    log("info", `Socket.IO available at /socket.io`)
  })
}

// ============================================================
// INITIALIZE
// ============================================================

try {
  initDatabase()
  prepareStatements()
  startServer()
} catch (err) {
  console.error(`${C.red}FATAL ERROR:${C.reset}`, err)
  process.exit(1)
}

// Graceful shutdown
process.on("SIGTERM", () => {
  log("warning", "SIGTERM received, shutting down...")
  io?.emit("server:shutdown", { message: "Serveur en maintenance" })
  setTimeout(() => {
    server?.close()
    db?.close()
    process.exit(0)
  }, 1000)
})

process.on("SIGINT", () => {
  log("warning", "SIGINT received, shutting down...")
  server?.close()
  db?.close()
  process.exit(0)
})
