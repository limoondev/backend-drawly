#!/usr/bin/env node
// ============================================================
// DRAWLY BACKEND v5.5.0 - Enhanced Room Sync & Persistence
// ============================================================
// Optimized for: https://limoon-space.cloud/drawly/
// ============================================================

import express from "express"
import { createServer as createHttpServer } from "http"
import { Server } from "socket.io"
import cors from "cors"
import Database from "better-sqlite3"
import { existsSync, mkdirSync } from "fs"
import path from "path"
import crypto from "crypto"

// Declare app, server, and io variables to fix undeclared variable errors
let app
let server
let io

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
    version: "5.5.0",
  },

  port: Number.parseInt(process.env.PORT) || 3001,
  host: process.env.HOST || "0.0.0.0", // Listen on all interfaces for Coolify

  publicUrl: process.env.PUBLIC_URL || "https://limoon-space.cloud/drawly",
  basePath: process.env.BASE_PATH || "/drawly",

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
      player_count INTEGER DEFAULT 0,
      last_activity TEXT DEFAULT CURRENT_TIMESTAMP,
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
    CREATE INDEX IF NOT EXISTS idx_rooms_activity ON rooms(last_activity);
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
      INSERT INTO rooms (id, code, host_id, is_private, max_players, draw_time, max_rounds, theme, player_count, last_activity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
    `),
    getRoomByCode: db.prepare("SELECT * FROM rooms WHERE code = ?"),
    getRoomById: db.prepare("SELECT * FROM rooms WHERE id = ?"),
    getAllRooms: db.prepare("SELECT * FROM rooms ORDER BY last_activity DESC"),
    getActiveRooms: db.prepare("SELECT * FROM rooms WHERE player_count > 0 ORDER BY last_activity DESC"),
    updateRoomPhase: db.prepare("UPDATE rooms SET phase = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?"),
    updateRoomSettings: db.prepare(
      "UPDATE rooms SET draw_time = ?, max_rounds = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?",
    ),
    updateRoomPlayerCount: db.prepare(
      "UPDATE rooms SET player_count = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?",
    ),
    updateRoomActivity: db.prepare("UPDATE rooms SET last_activity = CURRENT_TIMESTAMP WHERE id = ?"),
    deleteRoom: db.prepare("DELETE FROM rooms WHERE id = ?"),
    deleteOldRooms: db.prepare(
      "DELETE FROM rooms WHERE player_count = 0 AND last_activity < datetime('now', '-30 minutes')",
    ),
    getPublicRooms: db.prepare(`
      SELECT * FROM rooms
      WHERE is_private = 0 AND player_count > 0 AND player_count < max_players
      ORDER BY player_count DESC
      LIMIT 20
    `),
    roomExists: db.prepare("SELECT 1 FROM rooms WHERE code = ?"),

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
    countPlayersInRoom: db.prepare("SELECT COUNT(*) as count FROM players WHERE room_id = ?"),

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
// ROOM MANAGEMENT - ENHANCED
// ============================================================

function loadRoomsFromDatabase() {
  const dbRooms = stmt.getActiveRooms.all()
  let loadedCount = 0

  for (const roomData of dbRooms) {
    if (!rooms.has(roomData.id)) {
      const room = reconstructRoomFromDb(roomData)
      rooms.set(roomData.id, room)
      roomChatHistory.set(roomData.id, [])
      roomDrawerOrder.set(roomData.id, [])
      loadedCount++
    }
  }

  if (loadedCount > 0) {
    log("db", `Loaded ${loadedCount} rooms from database`)
  }

  return loadedCount
}

function reconstructRoomFromDb(roomData) {
  const dbPlayers = stmt.getPlayersByRoom.all(roomData.id)
  const playersMap = new Map()

  for (const p of dbPlayers) {
    playersMap.set(p.id, {
      id: p.id,
      socketId: p.socket_id,
      name: p.name,
      avatar: p.avatar || "default",
      score: p.score || 0,
      isHost: !!p.is_host,
      isDrawing: false,
      hasGuessed: false,
      userId: p.user_id,
    })
  }

  return {
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
    players: playersMap,
    guessedPlayers: new Set(),
    createdAt: new Date(roomData.created_at).getTime(),
  }
}

function getRoom(roomCode) {
  // First check memory
  for (const [id, room] of rooms) {
    if (room.code === roomCode) {
      return room
    }
  }

  // Check database
  const roomData = stmt.getRoomByCode.get(roomCode)
  if (!roomData) {
    return null
  }

  // Reconstruct from DB
  const room = reconstructRoomFromDb(roomData)
  rooms.set(room.id, room)
  roomChatHistory.set(room.id, [])
  roomDrawerOrder.set(room.id, Array.from(room.players.keys()))

  log("room", `Room ${roomCode} loaded from database`)
  return room
}

function roomCodeExists(code) {
  // Check memory first
  for (const room of rooms.values()) {
    if (room.code === code) return true
  }
  // Check database
  return !!stmt.roomExists.get(code)
}

function createRoom(hostPlayer, settings = {}) {
  const id = generateId()
  let code = generateCode()

  let attempts = 0
  while (roomCodeExists(code) && attempts < 100) {
    code = generateCode()
    attempts++
  }

  if (attempts >= 100) {
    throw new Error("Unable to generate unique room code")
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

  log(
    "debug",
    `Active rooms: ${Array.from(rooms.values())
      .map((r) => r.code)
      .join(", ")}`,
  )

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
    player.isHost ? 1 : 0,
    player.socketId,
  )

  stmt.updateRoomPlayerCount.run(room.players.size, room.id)

  log("player", `${player.name} joined room ${room.code} (${room.players.size} players)`)
}

function leaveRoom(room, playerId, io) {
  const player = room.players.get(playerId)
  if (!player) return

  room.players.delete(playerId)
  stmt.deletePlayer.run(playerId)

  stmt.updateRoomPlayerCount.run(room.players.size, room.id)

  // Update drawer order
  const order = roomDrawerOrder.get(room.id) || []
  const idx = order.indexOf(playerId)
  if (idx !== -1) order.splice(idx, 1)
  roomDrawerOrder.set(room.id, order)

  log("player", `${player.name} left room ${room.code} (${room.players.size} players remaining)`)

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
// EXPRESSROUTES - ENHANCED
// ============================================================

function setupRoutes() {
  const statusHandler = (req, res) => {
    res.json({
      status: "online",
      server: "Drawly Backend",
      version: CONFIG.server.version,
      timestamp: Date.now(),
      uptime: Math.floor((Date.now() - stats.startTime) / 1000),
      connections: socketToPlayer.size,
      rooms: rooms.size,
    })
  }

  // Status routes (accessible via /drawly/api/status, /drawly/api/health, etc.)
  app.get("/", statusHandler)
  app.get("/status", statusHandler)
  app.get("/health", statusHandler)

  app.get("/stats", (req, res) => {
    const memUsage = process.memoryUsage()
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000)

    const activeRooms = Array.from(rooms.values()).filter((r) => r.players.size > 0)

    res.json({
      connections: socketToPlayer.size,
      rooms: rooms.size,
      activeRooms: activeRooms.length,
      players: Array.from(rooms.values()).reduce((sum, r) => sum + r.players.size, 0),
      games: stats.totalGamesPlayed,
      uptime,
      stats: {
        connections: socketToPlayer.size,
        players: socketToPlayer.size,
        rooms: rooms.size,
        activeRooms: activeRooms.length,
        totalCreated: stats.totalRoomsCreated,
        uptime,
      },
      memory: {
        used: Math.round(memUsage.heapUsed / 1024 / 1024),
        total: Math.round(memUsage.heapTotal / 1024 / 1024),
      },
    })
  })

  app.get("/room/:code", (req, res) => {
    const code = req.params.code?.toUpperCase()
    const room = getRoom(code)

    if (!room) {
      return res.status(404).json({ exists: false, error: "Room not found" })
    }

    res.json({
      exists: true,
      code: room.code,
      playerCount: room.players.size,
      maxPlayers: room.maxPlayers,
      phase: room.phase,
      isPrivate: room.isPrivate,
      canJoin: room.players.size < room.maxPlayers && room.phase === "lobby",
    })
  })

  app.get("/rooms/codes", (req, res) => {
    const codes = Array.from(rooms.values()).map((r) => ({
      code: r.code,
      players: r.players.size,
      phase: r.phase,
    }))

    // Also get from DB
    const dbRooms = stmt.getAllRooms.all()
    const dbCodes = dbRooms.map((r) => ({
      code: r.code,
      players: r.player_count,
      phase: r.phase,
      inMemory: rooms.has(r.id),
    }))

    res.json({
      memory: codes,
      database: dbCodes,
      totalMemory: codes.length,
      totalDatabase: dbCodes.length,
    })
  })

  // Public rooms (accessible via /drawly/api/rooms)
  app.get("/rooms", (req, res) => {
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

  // Logs (admin only - accessible via /drawly/logs)
  app.get("/logs", (req, res) => {
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
// SOCKET HANDLERS - ENHANCED
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

    socket.on("room:join", (data, callback) => {
      try {
        const roomCode = data.roomCode?.toUpperCase()
        log("room", `Join request: ${roomCode} by ${data.playerName}`)

        const room = getRoom(roomCode)

        if (!room) {
          log("warning", `Room not found: ${roomCode}`)
          log(
            "debug",
            `Available rooms: ${Array.from(rooms.values())
              .map((r) => r.code)
              .join(", ")}`,
          )
          return callback({ success: false, error: "Partie introuvable" })
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
// CLEANUP - ENHANCED
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

  setInterval(
    () => {
      // Clean empty rooms from memory
      for (const [id, room] of rooms) {
        if (room.players.size === 0) {
          clearRoomTimers(id) // Use 'id' here, not 'roomId'
          stmt.deletePlayersByRoom.run(id) // Use 'id' here
          stmt.deleteRoom.run(id) // Use 'id' here
          rooms.delete(id)
          roomChatHistory.delete(id)
          roomDrawerOrder.delete(id)
          log("info", `Cleaned up empty room: ${room.code}`)
        }
      }

      // Clean old rooms from database
      const deleted = stmt.deleteOldRooms.run()
      if (deleted.changes > 0) {
        log("db", `Cleaned ${deleted.changes} old rooms from database`)
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

  setInterval(() => {
    loadRoomsFromDatabase()
  }, 30000)
}

// ============================================================
// SERVER STARTUP - ENHANCED
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
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Upgrade", "Connection"],
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

  // Coolify/Traefik strips the base path, so we use /socket.io directly
  // The frontend connects to https://domain/drawly/api which proxies to this server
  // Socket.IO then uses /socket.io relative to this server
  const SOCKET_PATH = process.env.SOCKET_PATH || "/socket.io"

  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: SOCKET_PATH,
    transports: ["polling", "websocket"],
    allowUpgrades: true,
    upgradeTimeout: 30000,
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: CONFIG.security.maxMessageSize,
    allowEIO3: true,
    addTrailingSlash: false,
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
    cookie: false,
    perMessageDeflate: false, // Disable compression for lower latency
    httpCompression: false,
  })

  io.engine.on("connection_error", (err) => {
    log("warn", `Socket.IO connection error: ${err.message}`, {
      code: err.code,
      req: err.req?.url,
    })
  })

  io.engine.on("connection", (rawSocket) => {
    rawSocket.on("upgrade", () => {
      log("debug", `Socket upgraded to WebSocket: ${rawSocket.id}`)
    })
  })

  setupRoutes()
  setupSocketHandlers()
  setupCleanup()

  loadRoomsFromDatabase()

  server.listen(CONFIG.port, CONFIG.host, () => {
    logBox("Server Configuration", [
      `${C.dim}Listen:${C.reset}         ${CONFIG.host}:${CONFIG.port}`,
      `${C.dim}Public URL:${C.reset}     ${CONFIG.publicUrl}`,
      `${C.dim}Platform:${C.reset}       ${env.platform}`,
      `${C.dim}Socket Path:${C.reset}    ${SOCKET_PATH}`,
      `${C.dim}Coolify:${C.reset}        ${env.isCoolify ? "Yes" : "No"}`,
      `${C.dim}Transports:${C.reset}     polling -> websocket`,
      `${C.dim}Origins:${C.reset}        * (all allowed)`,
      `${C.dim}Rooms Loaded:${C.reset}   ${rooms.size}`,
    ])

    log("success", `Server is running on port ${CONFIG.port}`)
    log("info", `Socket.IO path: ${SOCKET_PATH}`)
    log("info", `Full URL: ${CONFIG.publicUrl}${SOCKET_PATH}`)
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
