const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const { Server } = require("socket.io");

const corsOrigins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const corsOriginOption = corsOrigins.includes("*") ? "*" : corsOrigins;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOriginOption },
  transports: ["websocket", "polling"],
  pingInterval: 10000,
  pingTimeout: 15000,
  allowEIO3: true,
});

app.use(cors({ origin: corsOriginOption }));
app.use(express.json({ limit: "20mb" }));

const publicDir = path.join(__dirname, "public");

app.use(express.static(publicDir));

const roomSnapshots = new Map();

function setRoomSnapshot(roomId, snapshot) {
  if (!roomId || !snapshot) return;
  roomSnapshots.set(roomId, snapshot);
}

io.on("connection", (socket) => {
  const transport = socket.conn.transport.name;
  console.log(`[${new Date().toISOString()}] Connected via ${transport}, id: ${socket.id}`);

  socket.on("join-room", (roomId) => {
    if (!roomId || typeof roomId !== "string") return;

    for (const room of socket.rooms) {
      if (room !== socket.id) {
        socket.leave(room);
      }
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    const snapshot = roomSnapshots.get(roomId);
    if (snapshot) {
      socket.emit("state:sync", snapshot);
    }
  });

  function emitToRoom(eventName, data) {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    socket.to(roomId).emit(eventName, data);
  }

  function storeAndBroadcastSnapshot(snapshot) {
    const roomId = socket.data.roomId;
    if (!roomId || !snapshot) return;
    setRoomSnapshot(roomId, snapshot);
    socket.to(roomId).emit("state:sync", snapshot);
  }

  socket.on("draw", (data) => {
    emitToRoom("draw", data);
  });

  socket.on("drawBatch", (batch) => {
    emitToRoom("drawBatch", batch);
  });

  socket.on("shape:add", (data) => {
    emitToRoom("shape:add", data);
  });

  socket.on("shape:update", (data) => {
    emitToRoom("shape:update", data);
  });

  socket.on("clear", () => {
    emitToRoom("clear");
  });

  socket.on("state:sync", (snapshot) => {
    storeAndBroadcastSnapshot(snapshot);
  });

  socket.on("state:save", (snapshot) => {
    const roomId = socket.data.roomId;
    if (!roomId || !snapshot) return;
    setRoomSnapshot(roomId, snapshot);
  });

  socket.on("disconnect", (reason) => {
    console.log(`[${new Date().toISOString()}] Disconnected: ${reason}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
