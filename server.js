const path = require("path");
const http = require("http");
const express = require("express");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

// Serve static files from /public
app.use(express.static(path.join(__dirname, "public")));

// Serve chat UI route if/when you add it later
app.get("/chat/:roomId", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "chat.html"));
});

const wss = new WebSocket.Server({ server });

// Rooms in memory only
const rooms = new Map();
// roomId -> { clients:Set, lastActivity:number, joins:number, sealed:boolean, createdAt:number }

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
      lastActivity: now(),
      joins: 0,
      sealed: false,
      createdAt: now()
    });
  }
  return rooms.get(roomId);
}

function deleteRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const ws of room.clients) {
    try { ws.close(1000, "room closed"); } catch {}
  }
  rooms.delete(roomId);
}

function broadcast(roomId, payloadObj) {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg = JSON.stringify(payloadObj);
  for (const ws of room.clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
  room.lastActivity = now();
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const roomId = url.searchParams.get("room");

  if (!isSafeRoomId(roomId)) {
    ws.close(1008, "invalid room");
    return;
  }

  const room = getRoom(roomId);

  // Join window
  if (now() - room.createdAt > JOIN_WINDOW_MS) {
    ws.close(1008, "join window expired");
    return;
  }

  // Sealed / max joins ever
  if (room.sealed || room.joins >= MAX_JOINS) {
    ws.close(1008, "room sealed");
    return;
  }

  room.joins += 1;
  if (room.joins >= MAX_JOINS) room.sealed = true;

  room.clients.add(ws);
  room.lastActivity = now();

  ws.send(JSON.stringify({ type: "sys", event: "joined", sealed: room.sealed }));

  ws.on("message", (data) => {
    room.lastActivity = now();

    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "msg") {
      if (typeof msg.iv !== "string" || typeof msg.ct !== "string") return;
      broadcast(roomId, { type: "msg", iv: msg.iv, ct: msg.ct });
      return;
    }

    if (msg.type === "end") {
      broadcast(roomId, { type: "sys", event: "ended" });
      deleteRoom(roomId);
      return;
    }

    if (msg.type === "ping") {
      try { ws.send(JSON.stringify({ type: "pong" })); } catch {}
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
      }, EMPTY_ROOM_TTL_MS + 500);
    }
  });
});

// Cleanup
setInterval(() => {
  const t = now();
  for (const [roomId, room] of rooms.entries()) {
    if (t - room.lastActivity > INACTIVE_TTL_MS) deleteRoom(roomId);
  }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
