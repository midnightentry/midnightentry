const path = require("path");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");

const VERSION = "v6";

const app = express();
const server = http.createServer(app);

// Serve static from /public; avoid stale HTML
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-store");
    }
  }
}));

app.get("/version", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("text/plain").send(`midnightentry ${VERSION}`);
});

// Chat route
app.get("/chat/:roomId", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(__dirname, "public", "chat.html"));
});

const wss = new WebSocket.Server({ server });

// In-memory rooms only (no database)
const rooms = new Map();
// roomId -> { clients:Set<ws>, createdAt:number, lastActivity:number, joins:number, sealed:boolean }

const MAX_JOINS = 2;
const JOIN_WINDOW_MS = 5 * 60 * 1000;
const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;
const INACTIVE_TTL_MS = 60 * 60 * 1000;

const now = () => Date.now();

function isSafeRoomId(roomId) {
  return typeof roomId === "string" && /^[a-zA-Z0-9_-]{6,64}$/.test(roomId);
}

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      clients: new Set(),
      createdAt: now(),
      lastActivity: now(),
      joins: 0,
      sealed: false
    });
  }
  return rooms.get(roomId);
}

function broadcast(roomId, payloadObj, exceptWs = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg = JSON.stringify(payloadObj);
  for (const client of room.clients) {
    if (client === exceptWs) continue;
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
  room.lastActivity = now();
}

function closeRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const client of room.clients) {
    try { client.close(1000, "room closed"); } catch {}
  }
  rooms.delete(roomId);
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const roomId = url.searchParams.get("room");

  if (!isSafeRoomId(roomId)) {
    ws.close(1008, "invalid room");
    return;
  }

  const room = getRoom(roomId);

  // Joining window (limits old links)
  if (now() - room.createdAt > JOIN_WINDOW_MS) {
    ws.close(1008, "expired");
    return;
  }

  // Max joins ever
  if (room.sealed || room.joins >= MAX_JOINS) {
    ws.close(1008, "sealed");
    return;
  }

  room.joins += 1;
  if (room.joins >= MAX_JOINS) room.sealed = true;

  room.clients.add(ws);
  room.lastActivity = now();

  ws.send(JSON.stringify({ type: "sys", event: "joined", sealed: room.sealed, version: VERSION }));

  ws.on("message", (data) => {
    room.lastActivity = now();

    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "ping") {
      try { ws.send(JSON.stringify({ type: "pong" })); } catch {}
      return;
    }

    if (msg.type === "end") {
      broadcast(roomId, { type: "sys", event: "ended" }, null);
      closeRoom(roomId);
      return;
    }

    // Encrypted chat relay
    if (msg.type === "msg") {
      if (typeof msg.iv !== "string" || typeof msg.ct !== "string") return;
      broadcast(roomId, { type: "msg", iv: msg.iv, ct: msg.ct }, ws);
      return;
    }

    // WebRTC signaling relay
    if (msg.type === "rtc") {
      if (typeof msg.kind !== "string") return; // offer|answer|ice|hangup
      broadcast(roomId, { type: "rtc", kind: msg.kind, data: msg.data }, ws);
      return;
    }
  });

  ws.on("close", () => {
    const r = rooms.get(roomId);
    if (!r) return;
    r.clients.delete(ws);
    r.lastActivity = now();

    if (r.clients.size === 0) {
      setTimeout(() => {
        const rr = rooms.get(roomId);
        if (!rr) return;
        if (rr.clients.size === 0 && now() - rr.lastActivity >= EMPTY_ROOM_TTL_MS) {
          rooms.delete(roomId);
        }
      }, EMPTY_ROOM_TTL_MS + 250);
    }
  });
});

// Cleanup old rooms
setInterval(() => {
  const t = now();
  for (const [roomId, room] of rooms.entries()) {
    if (t - room.lastActivity > INACTIVE_TTL_MS) closeRoom(roomId);
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT} (${VERSION})`));
