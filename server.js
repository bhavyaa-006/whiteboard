const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["polling", "websocket"],
  pingInterval: 25000,
  pingTimeout: 60000,
});

app.use(express.json({ limit: "20mb" }));

const publicDir = path.join(__dirname, "public");
const imagesDir = process.env.TEMP_DIR || path.join(__dirname, "images");

app.use(express.static(publicDir));
app.use("/images", express.static(imagesDir));

if (!fs.existsSync(imagesDir)) {
  fs.mkdirSync(imagesDir, { recursive: true });
}

io.on("connection", (socket) => {
  console.log("socket connected", socket.id);

  socket.on("draw", (data) => {
    socket.broadcast.emit("draw", data);
  });

  socket.on("clear", () => {
    io.emit("clear");
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
