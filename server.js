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
  transports: ["polling", "websocket"],
  pingInterval: 10000,
  pingTimeout: 15000,
  allowEIO3: true,
});

app.use(cors({ origin: corsOriginOption }));
app.use(express.json({ limit: "20mb" }));

const publicDir = path.join(__dirname, "public");
const imagesDir = process.env.TEMP_DIR || path.join(__dirname, "images");

app.use(express.static(publicDir));
app.use("/images", express.static(imagesDir));

if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

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

  socket.on("disconnect", (reason) => {
    console.log(`[${new Date().toISOString()}] Disconnected: ${reason}`);
  });
});

app.post("/save-image", (req, res) => {
  const { imageData } = req.body;
  if (!imageData || typeof imageData !== "string")
    return res.status(400).json({ error: "imageData required" });

  const matches = imageData.match(/^data:(image\/(png|jpeg|jpg));base64,(.+)$/);
  if (!matches) return res.status(400).json({ error: "invalid image data" });
  const ext = matches[2] === "png" ? "png" : "jpg";
  const data = matches[3];
  const buffer = Buffer.from(data, "base64");
  const filename = `image-${Date.now()}.${ext}`;
  const filePath = path.join(imagesDir, filename);

  fs.writeFile(filePath, buffer, (err) => {
    if (err) {
      console.error("Failed to save image", err);
      return res.status(500).json({ error: "save failed" });
    }
    res.json({ url: `/images/${filename}` });
  });
});

app.get("/list-images", (req, res) => {
  fs.readdir(imagesDir, (err, files) => {
    if (err) return res.json([]);
    const images = files.filter((f) => /\.(png|jpe?g)$/i.test(f)).map((f) => `/images/${f}`);
    res.json(images);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
