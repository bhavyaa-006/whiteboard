function createRoomId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `room-${window.crypto.randomUUID().slice(0, 8)}`;
  }
  return `room-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeRoomId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  // Keep room IDs URL-safe and bounded.
  if (!/^room-[a-z0-9-]{4,40}$/.test(trimmed)) return null;
  return trimmed;
}

function getRoomIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return normalizeRoomId(params.get("room"));
}

function getInviteLink(roomId) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  return url.toString();
}

const appConfig = window.__APP_CONFIG__ || {};
const rawBackendUrl = appConfig.BACKEND_URL || window.location.origin;
const backendBaseUrl = String(rawBackendUrl).replace(/\/$/, "");

function buildBackendUrl(pathname) {
  return `${backendBaseUrl}${pathname}`;
}

function toAbsoluteAssetUrl(url) {
  if (typeof url !== "string") return url;
  if (/^https?:\/\//i.test(url) || /^data:/i.test(url) || /^blob:/i.test(url)) {
    return url;
  }
  if (url.startsWith("/")) {
    return buildBackendUrl(url);
  }
  return buildBackendUrl(`/${url}`);
}

const socket = io(backendBaseUrl, {
  transports: ["polling", "websocket"],
  reconnection: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000,
  reconnectionAttempts: Infinity,
  timeout: 60000,
});

const baseCanvas = document.getElementById("board");
const baseCtx = baseCanvas.getContext("2d");
const shapeCanvas = document.getElementById("elements");
const shapeCtx = shapeCanvas.getContext("2d");
const colorPicker = document.getElementById("color");
const sizeInput = document.getElementById("size");
const brushInput = document.getElementById("brush");
const shapeInput = document.getElementById("shape");
const rotationInput = document.getElementById("rotation");
const useFillCheckbox = document.getElementById("useFill");
const fillColorPicker = document.getElementById("fillColor");
const undoBtn = document.getElementById("undo");
const redoBtn = document.getElementById("redo");
const clearBtn = document.getElementById("clear");
const saveBtn = document.getElementById("save");
const downloadBtn = document.getElementById("download");
const createRoomBtn = document.getElementById("createRoom");
const joinRoomBtn = document.getElementById("joinRoom");
const joinRoomInput = document.getElementById("joinRoomInput");
const roomInput = document.getElementById("room");
const newRoomBtn = document.getElementById("newRoom");
const copyRoomBtn = document.getElementById("copyRoom");
const imagesEl = document.getElementById("images");
const connectionStatus = document.getElementById("connectionStatus");
const launchPage = document.getElementById("launchPage");
const appShell = document.getElementById("appShell");
const ERASER_CURSOR = 'url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22 viewBox=%220 0 40 40%22><rect x=%229%22 y=%2212%22 width=%2222%22 height=%2214%22 rx=%222%22 fill=%22white%22 stroke=%22black%22 stroke-width=%222%22 transform=%22rotate(-25 20 20)%22/><path d=%22M11 28 L28 11%22 stroke=%22black%22 stroke-width=%223%22 stroke-linecap=%22round%22/></svg>") 4 32, auto';
let last = null;
let shapeStart = null;
let currentPoint = null;
let drawing = false;
let selectedElementId = null;
let draggingElement = false;
let dragStartPoint = null;
let dragOrigin = null;
let draftElement = null;
let shapeElements = [];
let currentRoomId = getRoomIdFromUrl();
let historyStack = [];
let redoStack = [];
let isApplyingSnapshot = false;

function setCanvasCursor(cursor) {
  shapeCanvas.style.cursor = cursor;
  baseCanvas.style.cursor = cursor;
}

function updateCursorForTool() {
  const tool = shapeInput.value;

  if (tool === "select") {
    setCanvasCursor(draggingElement ? "grabbing" : "grab");
    return;
  }

  if (tool === "eraser") {
    setCanvasCursor(ERASER_CURSOR);
    return;
  }

  if (tool === "bucket") {
    setCanvasCursor("cell");
    return;
  }

  setCanvasCursor("crosshair");
}

function updateHistoryButtons() {
  if (undoBtn) {
    undoBtn.disabled = historyStack.length <= 1;
  }
  if (redoBtn) {
    redoBtn.disabled = redoStack.length === 0;
  }
}

function syncRoomUrl(roomId, replace = false) {
  const url = new URL(window.location.href);
  if (roomId) {
    url.searchParams.set("room", roomId);
  } else {
    url.searchParams.delete("room");
  }
  window.history[replace ? "replaceState" : "pushState"]({}, "", url);
}

function setCurrentRoom(roomId, replace = false) {
  currentRoomId = normalizeRoomId(roomId) || createRoomId();
  roomInput.value = currentRoomId;
  syncRoomUrl(currentRoomId, replace);
  socket.emit("join-room", currentRoomId);
  launchPage.hidden = true;
  appShell.hidden = false;
  updateCursorForTool();
}

function showLaunchPage() {
  launchPage.hidden = false;
  appShell.hidden = true;
  updateCursorForTool();
}

function openRoom(roomId, replace = false) {
  setCurrentRoom(roomId, replace);
  historyStack = [];
  redoStack = [];
  initializeHistoryFromCurrentState();
}

if (currentRoomId) {
  setCurrentRoom(currentRoomId, true);
  initializeHistoryFromCurrentState();
} else {
  showLaunchPage();
}

updateCursorForTool();

socket.on("connect", () => {
  const transport = socket.io.engine.transport.name;
  connectionStatus.textContent = `● ${transport} connected`;
  connectionStatus.style.color = transport === "websocket" ? "#22c55e" : "#f59e0b";
  socket.emit("join-room", currentRoomId);
});

newRoomBtn.addEventListener("click", async () => {
  clearAll();
  const nextRoomId = createRoomId();
  openRoom(nextRoomId);
  socket.emit("state:sync", captureSnapshot());

  try {
    await navigator.clipboard.writeText(getInviteLink(nextRoomId));
  } catch {
    // Clipboard can fail on some browsers; the invite link is still in the URL.
  }
});

shapeInput.addEventListener("change", () => {
  updateCursorForTool();
});

createRoomBtn.addEventListener("click", () => {
  clearAll();
  openRoom(createRoomId());
});

joinRoomBtn.addEventListener("click", () => {
  const roomId = normalizeRoomId(joinRoomInput.value);
  if (!roomId) {
    joinRoomInput.focus();
    joinRoomInput.select();
    return;
  }
  clearAll();
  openRoom(roomId, true);
});

joinRoomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    joinRoomBtn.click();
  }
});

window.addEventListener("popstate", () => {
  const roomId = getRoomIdFromUrl();
  if (roomId) {
    setCurrentRoom(roomId, true);
    initializeHistoryFromCurrentState();
  } else {
    currentRoomId = null;
    showLaunchPage();
  }
});

copyRoomBtn.addEventListener("click", async () => {
  const inviteLink = getInviteLink(currentRoomId);
  try {
    await navigator.clipboard.writeText(inviteLink);
  } catch {
    alert(inviteLink);
  }
});

undoBtn.addEventListener("click", () => {
  void undoState();
});

redoBtn.addEventListener("click", () => {
  void redoState();
});

document.addEventListener("keydown", (event) => {
  const isEditable = event.target instanceof HTMLInputElement
    || event.target instanceof HTMLTextAreaElement
    || event.target instanceof HTMLSelectElement;
  if (isEditable) return;

  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && key === "z") {
    event.preventDefault();
    if (event.shiftKey) void redoState();
    else void undoState();
  }
  if ((event.metaKey || event.ctrlKey) && key === "y") {
    event.preventDefault();
    void redoState();
  }
});

socket.on("disconnect", () => {
  connectionStatus.textContent = "● disconnected";
  connectionStatus.style.color = "#ef4444";
});

socket.on("connect_error", (err) => {
  console.error("Connection error:", err);
  connectionStatus.textContent = "● reconnecting";
  connectionStatus.style.color = "#ef4444";
});

function createId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `shape-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getFilenameFromUrl(url, fallbackPrefix = "image") {
  try {
    const parsedUrl = new URL(url, window.location.href);
    const pathname = parsedUrl.pathname.split("/").filter(Boolean);
    return pathname.length ? pathname[pathname.length - 1] : `${fallbackPrefix}.png`;
  } catch {
    return `${fallbackPrefix}.png`;
  }
}

function triggerDownload(blobUrl, filename) {
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function clonePoint(point) {
  return { x: point.x, y: point.y };
}

function cloneElement(element) {
  return {
    ...element,
    from: clonePoint(element.from),
    to: clonePoint(element.to),
  };
}

function snapshotSignature(snapshot) {
  return JSON.stringify({
    baseDataUrl: snapshot.baseDataUrl,
    shapeElements: snapshot.shapeElements,
  });
}

function captureSnapshot() {
  return {
    baseDataUrl: baseCanvas.toDataURL("image/png"),
    shapeElements: shapeElements.map(cloneElement),
  };
}

function resetInteractionState() {
  selectedElementId = null;
  draggingElement = false;
  dragStartPoint = null;
  dragOrigin = null;
  draftElement = null;
  drawing = false;
  last = null;
  shapeStart = null;
  currentPoint = null;
  syncRotationControl();
}

function setHistoryState(snapshot) {
  const signature = snapshotSignature(snapshot);
  const lastEntry = historyStack[historyStack.length - 1];
  if (lastEntry && lastEntry.signature === signature) return false;
  historyStack.push({ signature, snapshot });
  redoStack = [];
  updateHistoryButtons();
  return true;
}

function initializeHistoryFromCurrentState() {
  const snapshot = captureSnapshot();
  historyStack = [{ signature: snapshotSignature(snapshot), snapshot }];
  redoStack = [];
  updateHistoryButtons();
}

function commitCurrentState(broadcast = true) {
  if (isApplyingSnapshot) return;
  const snapshot = captureSnapshot();
  if (!setHistoryState(snapshot)) return;
  if (broadcast) {
    socket.emit("state:sync", snapshot);
  }
}

function applySnapshotToBoard(snapshot) {
  return new Promise((resolve) => {
    const apply = () => {
      shapeElements = Array.isArray(snapshot.shapeElements)
        ? snapshot.shapeElements.map(cloneElement)
        : [];
      resetInteractionState();
      renderShapeLayer();
      resolve();
    };

    if (!snapshot.baseDataUrl) {
      baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
      apply();
      return;
    }

    const image = new Image();
    image.onload = () => {
      baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
      baseCtx.drawImage(image, 0, 0, baseCanvas.width, baseCanvas.height);
      apply();
    };
    image.onerror = () => {
      baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
      apply();
    };
    image.src = snapshot.baseDataUrl;
  });
}

async function applySnapshot(snapshot, { pushToHistory = true } = {}) {
  if (!snapshot) return;
  isApplyingSnapshot = true;
  try {
    await applySnapshotToBoard(snapshot);
    if (pushToHistory) {
      setHistoryState(snapshot);
    }
  } finally {
    isApplyingSnapshot = false;
  }
}

async function undoState() {
  if (historyStack.length <= 1) return;
  const currentEntry = historyStack.pop();
  redoStack.push(currentEntry);
  const previousEntry = historyStack[historyStack.length - 1];
  updateHistoryButtons();
  await applySnapshot(previousEntry.snapshot, { pushToHistory: false });
  socket.emit("state:sync", previousEntry.snapshot);
}

async function redoState() {
  if (!redoStack.length) return;
  const nextEntry = redoStack.pop();
  historyStack.push(nextEntry);
  updateHistoryButtons();
  await applySnapshot(nextEntry.snapshot, { pushToHistory: false });
  socket.emit("state:sync", nextEntry.snapshot);
}

function getCanvasPoint(event) {
  const rect = shapeCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
  };
}

function resizeCanvas(canvas, context, preserve = false) {
  const dataUrl = preserve ? canvas.toDataURL() : null;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  if (preserve && dataUrl) {
    const image = new Image();
    image.onload = () => context.drawImage(image, 0, 0);
    image.src = dataUrl;
  }
}

function resizeAll() {
  const baseData = baseCanvas.toDataURL();
  baseCanvas.width = window.innerWidth;
  baseCanvas.height = window.innerHeight;
  shapeCanvas.width = window.innerWidth;
  shapeCanvas.height = window.innerHeight;

  const image = new Image();
  image.onload = () => baseCtx.drawImage(image, 0, 0);
  image.src = baseData;
  renderShapeLayer();
}

window.addEventListener("resize", resizeAll);
resizeAll();
initializeHistoryFromCurrentState();

useFillCheckbox.addEventListener("change", () => {
  fillColorPicker.disabled = !useFillCheckbox.checked;
});

function sendLine(from, to, color, size, brush, shape, useFill, fillColor) {
  socket.emit("draw", { from, to, color, size, brush, shape, useFill, fillColor });
}

function sendShapeEvent(eventName, element) {
  socket.emit(eventName, element);
}

function drawDottedLine(context, from, to, color, size) {
  context.strokeStyle = color;
  context.lineWidth = size;
  context.setLineDash([size * 2, size * 2]);
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(from.x * context.canvas.width, from.y * context.canvas.height);
  context.lineTo(to.x * context.canvas.width, to.y * context.canvas.height);
  context.stroke();
  context.setLineDash([]);
}

function drawDashedLine(context, from, to, color, size) {
  context.strokeStyle = color;
  context.lineWidth = size;
  context.setLineDash([size * 4, size * 2]);
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(from.x * context.canvas.width, from.y * context.canvas.height);
  context.lineTo(to.x * context.canvas.width, to.y * context.canvas.height);
  context.stroke();
  context.setLineDash([]);
}

function drawSprayLine(context, from, to, color, size) {
  const distance = Math.sqrt(Math.pow(to.x - from.x, 2) + Math.pow(to.y - from.y, 2));
  const steps = Math.ceil(distance * context.canvas.width);

  for (let i = 0; i < steps; i += 1) {
    const t = steps > 0 ? i / steps : 0;
    const x = (from.x + (to.x - from.x) * t) * context.canvas.width;
    const y = (from.y + (to.y - from.y) * t) * context.canvas.height;

    for (let j = 0; j < size * 3; j += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * size;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;

      context.fillStyle = color;
      context.fillRect(px, py, 1, 1);
    }
  }
}

function drawSolidLine(context, from, to, color, size) {
  context.strokeStyle = color;
  context.lineWidth = size;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(from.x * context.canvas.width, from.y * context.canvas.height);
  context.lineTo(to.x * context.canvas.width, to.y * context.canvas.height);
  context.stroke();
}

function drawLine(context, from, to, color, size, brush = "solid") {
  if (brush === "dotted") drawDottedLine(context, from, to, color, size);
  else if (brush === "dashed") drawDashedLine(context, from, to, color, size);
  else if (brush === "spray") drawSprayLine(context, from, to, color, size);
  else drawSolidLine(context, from, to, color, size);
}

function drawEraserLine(context, from, to, size) {
  context.save();
  context.globalCompositeOperation = "destination-out";
  context.strokeStyle = "rgba(0,0,0,1)";
  context.lineWidth = Math.max(6, size * 2);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  context.moveTo(from.x * context.canvas.width, from.y * context.canvas.height);
  context.lineTo(to.x * context.canvas.width, to.y * context.canvas.height);
  context.stroke();
  context.restore();
}

function drawRectangle(context, start, end, color, size, useFill, fillColor) {
  const x1 = start.x * context.canvas.width;
  const y1 = start.y * context.canvas.height;
  const x2 = end.x * context.canvas.width;
  const y2 = end.y * context.canvas.height;
  const width = x2 - x1;
  const height = y2 - y1;

  if (useFill) {
    context.fillStyle = fillColor;
    context.fillRect(x1, y1, width, height);
  }
  context.strokeStyle = color;
  context.lineWidth = size;
  context.strokeRect(x1, y1, width, height);
}

function drawCircle(context, start, end, color, size, useFill, fillColor) {
  const x1 = start.x * context.canvas.width;
  const y1 = start.y * context.canvas.height;
  const x2 = end.x * context.canvas.width;
  const y2 = end.y * context.canvas.height;
  const radius = Math.max(1, Math.min(Math.abs(x2 - x1), Math.abs(y2 - y1)) / 2);
  const centerX = (x1 + x2) / 2;
  const centerY = (y1 + y2) / 2;

  context.beginPath();
  context.arc(centerX, centerY, radius, 0, Math.PI * 2);
  if (useFill) {
    context.fillStyle = fillColor;
    context.fill();
  }
  context.strokeStyle = color;
  context.lineWidth = size;
  context.stroke();
}

function drawTriangle(context, start, end, color, size, useFill, fillColor) {
  const x1 = start.x * context.canvas.width;
  const y1 = start.y * context.canvas.height;
  const x2 = end.x * context.canvas.width;
  const y2 = end.y * context.canvas.height;
  const width = x2 - x1;
  const height = y2 - y1;

  context.beginPath();
  context.moveTo(x1 + width / 2, y1);
  context.lineTo(x2, y2);
  context.lineTo(x1, y2);
  context.closePath();

  if (useFill) {
    context.fillStyle = fillColor;
    context.fill();
  }
  context.strokeStyle = color;
  context.lineWidth = size;
  context.stroke();
}

function hexToRgba(hex) {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized;
  const intValue = parseInt(expanded, 16);
  return [
    (intValue >> 16) & 255,
    (intValue >> 8) & 255,
    intValue & 255,
    255,
  ];
}

function colorsMatch(data, index, target) {
  return data[index] === target[0]
    && data[index + 1] === target[1]
    && data[index + 2] === target[2]
    && data[index + 3] === target[3];
}

function bucketFill(startPoint, fillColor) {
  const x = Math.floor(startPoint.x * baseCanvas.width);
  const y = Math.floor(startPoint.y * baseCanvas.height);

  if (x < 0 || y < 0 || x >= baseCanvas.width || y >= baseCanvas.height) return;

  const imageData = baseCtx.getImageData(0, 0, baseCanvas.width, baseCanvas.height);
  const { data, width, height } = imageData;
  const targetIndex = (y * width + x) * 4;
  const targetColor = [
    data[targetIndex],
    data[targetIndex + 1],
    data[targetIndex + 2],
    data[targetIndex + 3],
  ];
  const replacementColor = hexToRgba(fillColor);

  if (colorsMatch(data, targetIndex, replacementColor)) return;

  const stack = [[x, y]];

  while (stack.length) {
    const [startX, startY] = stack.pop();

    if (startX < 0 || startX >= width || startY < 0 || startY >= height) continue;

    let left = startX;
    let right = startX;
    let currentIndex = (startY * width + startX) * 4;

    while (left >= 0 && colorsMatch(data, currentIndex, targetColor)) {
      left -= 1;
      currentIndex -= 4;
    }

    left += 1;
    currentIndex = (startY * width + startX) * 4;

    while (right < width && colorsMatch(data, currentIndex, targetColor)) {
      right += 1;
      currentIndex += 4;
    }

    right -= 1;

    for (let fillX = left; fillX <= right; fillX += 1) {
      const pixelIndex = (startY * width + fillX) * 4;
      data[pixelIndex] = replacementColor[0];
      data[pixelIndex + 1] = replacementColor[1];
      data[pixelIndex + 2] = replacementColor[2];
      data[pixelIndex + 3] = replacementColor[3];
    }

    for (const neighborY of [startY - 1, startY + 1]) {
      if (neighborY < 0 || neighborY >= height) continue;

      let fillRun = false;
      for (let fillX = left; fillX <= right; fillX += 1) {
        const neighborIndex = (neighborY * width + fillX) * 4;
        if (colorsMatch(data, neighborIndex, targetColor)) {
          if (!fillRun) {
            stack.push([fillX, neighborY]);
            fillRun = true;
          }
        } else {
          fillRun = false;
        }
      }
    }
  }

  baseCtx.putImageData(imageData, 0, 0);
}

function createShapeElement(type, from, to, color, size, brush, useFill, fillColor, rotation = 0) {
  return {
    id: createId(),
    type,
    from: clonePoint(from),
    to: clonePoint(to),
    color,
    size,
    brush,
    useFill,
    fillColor,
    rotation,
  };
}

function getElementFrame(element) {
  const x1 = element.from.x * shapeCanvas.width;
  const y1 = element.from.y * shapeCanvas.height;
  const x2 = element.to.x * shapeCanvas.width;
  const y2 = element.to.y * shapeCanvas.height;
  const center = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  const rotation = (element.rotation || 0) * Math.PI / 180;
  const baseAngle = Math.atan2(y2 - y1, x2 - x1);
  const angle = element.type === "line" ? baseAngle + rotation : rotation;
  const length = Math.hypot(x2 - x1, y2 - y1);
  return { center, width, height, length, angle };
}

function toLocalPoint(point, center, angle) {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
}

function getTransformedPoints(element) {
  const frame = getElementFrame(element);
  const angle = frame.angle;
  const center = frame.center;

  if (element.type === "circle") {
    const radius = Math.max(1, Math.min(frame.width, frame.height) / 2);
    return [
      { x: center.x - radius, y: center.y - radius },
      { x: center.x + radius, y: center.y - radius },
      { x: center.x + radius, y: center.y + radius },
      { x: center.x - radius, y: center.y + radius },
    ];
  }

  if (element.type === "line") {
    const halfLength = frame.length / 2;
    return [
      { x: center.x - halfLength * Math.cos(angle), y: center.y - halfLength * Math.sin(angle) },
      { x: center.x + halfLength * Math.cos(angle), y: center.y + halfLength * Math.sin(angle) },
    ];
  }

  if (element.type === "triangle") {
    const points = [
      { x: 0, y: -frame.height / 2 },
      { x: frame.width / 2, y: frame.height / 2 },
      { x: -frame.width / 2, y: frame.height / 2 },
    ];
    return points.map((point) => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return {
        x: center.x + point.x * cos - point.y * sin,
        y: center.y + point.x * sin + point.y * cos,
      };
    });
  }

  const corners = [
    { x: -frame.width / 2, y: -frame.height / 2 },
    { x: frame.width / 2, y: -frame.height / 2 },
    { x: frame.width / 2, y: frame.height / 2 },
    { x: -frame.width / 2, y: frame.height / 2 },
  ];

  return corners.map((point) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: center.x + point.x * cos - point.y * sin,
      y: center.y + point.x * sin + point.y * cos,
    };
  });
}

function getElementBounds(element) {
  const points = getTransformedPoints(element);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function pointInTriangle(point, a, b, c) {
  const v0x = c.x - a.x;
  const v0y = c.y - a.y;
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = point.x - a.x;
  const v2y = point.y - a.y;

  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
  const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  return u >= 0 && v >= 0 && (u + v) <= 1;
}

function hitTestElement(element, point) {
  const frame = getElementFrame(element);
  const pixelPoint = { x: point.x * shapeCanvas.width, y: point.y * shapeCanvas.height };
  const localPoint = toLocalPoint(pixelPoint, frame.center, frame.angle);

  if (element.type === "line") {
    const halfLength = frame.length / 2;
    const tolerance = Math.max(8, (element.size || 1) / 2 + 4);
    return Math.abs(localPoint.y) <= tolerance && localPoint.x >= -halfLength - tolerance && localPoint.x <= halfLength + tolerance;
  }

  if (element.type === "circle") {
    const radius = Math.max(1, Math.min(frame.width, frame.height) / 2);
    return Math.sqrt(Math.pow(localPoint.x, 2) + Math.pow(localPoint.y, 2)) <= radius;
  }

  if (element.type === "triangle") {
    const trianglePoints = [
      { x: 0, y: -frame.height / 2 },
      { x: frame.width / 2, y: frame.height / 2 },
      { x: -frame.width / 2, y: frame.height / 2 },
    ];
    return pointInTriangle(localPoint, trianglePoints[0], trianglePoints[1], trianglePoints[2]);
  }

  return Math.abs(localPoint.x) <= frame.width / 2 && Math.abs(localPoint.y) <= frame.height / 2;
}

function drawShapeElement(context, element, highlight = false) {
  const frame = getElementFrame(element);
  context.save();
  context.strokeStyle = element.color;
  context.lineWidth = element.size;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (element.type === "line") {
    context.translate(frame.center.x, frame.center.y);
    context.rotate(frame.angle);
    drawLine(context, { x: -frame.length / 2 / context.canvas.width, y: 0 }, { x: frame.length / 2 / context.canvas.width, y: 0 }, element.color, element.size, element.brush);
  } else if (element.type === "rectangle") {
    context.translate(frame.center.x, frame.center.y);
    context.rotate(frame.angle);
    if (element.useFill) {
      context.fillStyle = element.fillColor;
      context.fillRect(-frame.width / 2, -frame.height / 2, frame.width, frame.height);
    }
    context.strokeStyle = element.color;
    context.strokeRect(-frame.width / 2, -frame.height / 2, frame.width, frame.height);
  } else if (element.type === "circle") {
    const radius = Math.max(1, Math.min(frame.width, frame.height) / 2);
    context.beginPath();
    context.arc(frame.center.x, frame.center.y, radius, 0, Math.PI * 2);
    if (element.useFill) {
      context.fillStyle = element.fillColor;
      context.fill();
    }
    context.strokeStyle = element.color;
    context.stroke();
  } else if (element.type === "triangle") {
    context.translate(frame.center.x, frame.center.y);
    context.rotate(frame.angle);
    context.beginPath();
    context.moveTo(0, -frame.height / 2);
    context.lineTo(frame.width / 2, frame.height / 2);
    context.lineTo(-frame.width / 2, frame.height / 2);
    context.closePath();
    if (element.useFill) {
      context.fillStyle = element.fillColor;
      context.fill();
    }
    context.strokeStyle = element.color;
    context.stroke();
  }

  if (highlight) {
    const bounds = getElementBounds(element);
    context.save();
    context.setLineDash([8, 6]);
    context.strokeStyle = "#00A3FF";
    context.lineWidth = 1;
    context.strokeRect(bounds.left - 6, bounds.top - 6, bounds.right - bounds.left + 12, bounds.bottom - bounds.top + 12);
    context.restore();
  }

  context.restore();
}

function renderShapeLayer() {
  shapeCtx.clearRect(0, 0, shapeCanvas.width, shapeCanvas.height);
  shapeElements.forEach((element) => {
    drawShapeElement(shapeCtx, element, element.id === selectedElementId);
  });
  if (draftElement) {
    drawShapeElement(shapeCtx, draftElement, false);
  }
}

function syncRotationControl() {
  const selectedElement = shapeElements.find((element) => element.id === selectedElementId);
  const isSelectable = Boolean(selectedElement);
  rotationInput.disabled = !isSelectable;
  if (isSelectable) {
    rotationInput.value = String(Math.round(selectedElement.rotation || 0) % 360);
  } else {
    rotationInput.value = "0";
  }
}

function addShapeElement(element, broadcast = true) {
  shapeElements.push(element);
  if (broadcast) sendShapeEvent("shape:add", element);
  renderShapeLayer();
}

function updateShapeElement(updatedElement, broadcast = true) {
  const index = shapeElements.findIndex((element) => element.id === updatedElement.id);
  if (index === -1) return;
  shapeElements[index] = cloneElement(updatedElement);
  if (broadcast) sendShapeEvent("shape:update", updatedElement);
  renderShapeLayer();
  syncRotationControl();
}

function clearAll() {
  baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
  shapeElements = [];
  resetInteractionState();
  renderShapeLayer();
}

function createShapeFromTool(tool, from, to) {
  const color = colorPicker.value;
  const size = parseInt(sizeInput.value, 10);
  const brush = brushInput.value;
  const useFill = useFillCheckbox.checked;
  const fillColor = fillColorPicker.value;
  return createShapeElement(tool, from, to, color, size, brush, useFill, fillColor, 0);
}

baseCanvas.addEventListener("pointerdown", () => {});

shapeCanvas.addEventListener("pointerdown", (event) => {
  const tool = shapeInput.value;
  const point = getCanvasPoint(event);

  if (tool === "pen" || tool === "eraser") {
    drawing = true;
    last = point;
    shapeStart = point;
    currentPoint = point;
    shapeCanvas.setPointerCapture(event.pointerId);
    updateCursorForTool();
    return;
  }

  if (tool === "bucket") {
    const bucketColor = useFillCheckbox.checked ? fillColorPicker.value : colorPicker.value;
    bucketFill(point, bucketColor);
    sendLine(point, point, bucketColor, 0, "solid", "bucket", false, bucketColor);
    commitCurrentState(true);
    return;
  }

  if (tool === "select") {
    const hitElement = [...shapeElements].reverse().find((element) => hitTestElement(element, point));
    if (!hitElement) {
      selectedElementId = null;
      draggingElement = false;
      dragOrigin = null;
      dragStartPoint = null;
      syncRotationControl();
      renderShapeLayer();
      return;
    }

    selectedElementId = hitElement.id;
    draggingElement = true;
    dragStartPoint = point;
    dragOrigin = cloneElement(hitElement);
    syncRotationControl();
    renderShapeLayer();
    shapeCanvas.setPointerCapture(event.pointerId);
    updateCursorForTool();
    return;
  }

  drawing = true;
  shapeStart = point;
  currentPoint = point;
  draftElement = createShapeFromTool(tool, point, point);
  shapeCanvas.setPointerCapture(event.pointerId);
  renderShapeLayer();
});

shapeCanvas.addEventListener("pointermove", (event) => {
  const point = getCanvasPoint(event);
  const tool = shapeInput.value;

  if ((tool === "pen" || tool === "eraser") && drawing) {
    const color = colorPicker.value;
    const size = parseInt(sizeInput.value, 10);
    const brush = brushInput.value;
    if (tool === "eraser") {
      drawEraserLine(baseCtx, last, point, size);
    } else {
      drawLine(baseCtx, last, point, color, size, brush);
    }
    sendLine(last, point, color, size, brush, tool, false, fillColorPicker.value);
    last = point;
    currentPoint = point;
    return;
  }

  if (tool === "select" && draggingElement && selectedElementId && dragOrigin) {
    const delta = { x: point.x - dragStartPoint.x, y: point.y - dragStartPoint.y };
    const activeElement = shapeElements.find((element) => element.id === selectedElementId);
    if (!activeElement) return;
    activeElement.from = { x: dragOrigin.from.x + delta.x, y: dragOrigin.from.y + delta.y };
    activeElement.to = { x: dragOrigin.to.x + delta.x, y: dragOrigin.to.y + delta.y };
    renderShapeLayer();
    return;
  }

  if (!drawing || !draftElement) return;
  draftElement.to = clonePoint(point);
  currentPoint = point;
  renderShapeLayer();
});

shapeCanvas.addEventListener("pointerup", (event) => {
  const tool = shapeInput.value;

  if (tool === "select" && draggingElement && selectedElementId) {
    const activeElement = shapeElements.find((element) => element.id === selectedElementId);
    if (activeElement) {
      updateShapeElement(activeElement, true);
      commitCurrentState(true);
    }
    draggingElement = false;
    dragOrigin = null;
    dragStartPoint = null;
    updateCursorForTool();
    return;
  }

  if (tool === "pen" || tool === "eraser") {
    drawing = false;
    last = null;
    shapeStart = null;
    currentPoint = null;
    commitCurrentState(true);
    return;
  }

  if (drawing && draftElement) {
    draftElement.to = getCanvasPoint(event);
    addShapeElement(cloneElement(draftElement), true);
    draftElement = null;
    commitCurrentState(true);
  }

  drawing = false;
  last = null;
  shapeStart = null;
  currentPoint = null;
  updateCursorForTool();
});

shapeCanvas.addEventListener("pointercancel", () => {
  drawing = false;
  last = null;
  shapeStart = null;
  currentPoint = null;
  draggingElement = false;
  dragOrigin = null;
  dragStartPoint = null;
  draftElement = null;
  renderShapeLayer();
  updateCursorForTool();
});

shapeCanvas.addEventListener("pointerleave", () => {
  if (shapeInput.value === "select" && !draggingElement) {
    setCanvasCursor("grab");
  }
});

shapeCanvas.addEventListener("pointerenter", () => {
  updateCursorForTool();
});

rotationInput.addEventListener("input", () => {
  const selectedElement = shapeElements.find((element) => element.id === selectedElementId);
  if (!selectedElement) return;
  selectedElement.rotation = Number(rotationInput.value);
  renderShapeLayer();
});

rotationInput.addEventListener("change", () => {
  const selectedElement = shapeElements.find((element) => element.id === selectedElementId);
  if (!selectedElement) return;
  updateShapeElement(selectedElement, true);
});

socket.on("draw", (data) => {
  const { from, to, color, size, brush = "solid", shape = "pen", useFill = false, fillColor = "#FF0000" } = data;

  if (shape === "pen") {
    drawLine(baseCtx, from, to, color, size, brush);
  } else if (shape === "eraser") {
    drawEraserLine(baseCtx, from, to, size);
  } else if (shape === "bucket") {
    bucketFill(from || to, color);
  }
});

socket.on("shape:add", (element) => {
  if (shapeElements.some((existing) => existing.id === element.id)) return;
  shapeElements.push(cloneElement(element));
  renderShapeLayer();
});

socket.on("shape:update", (element) => {
  const index = shapeElements.findIndex((existing) => existing.id === element.id);
  if (index === -1) return;
  shapeElements[index] = cloneElement(element);
  renderShapeLayer();
  syncRotationControl();
});

socket.on("state:sync", async (snapshot) => {
  await applySnapshot(snapshot, { pushToHistory: true });
});

clearBtn.addEventListener("click", () => {
  clearAll();
  commitCurrentState(true);
  socket.emit("clear");
});

socket.on("clear", () => {
  clearAll();
  commitCurrentState(false);
});

async function saveCanvas() {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = baseCanvas.width;
  exportCanvas.height = baseCanvas.height;
  const exportCtx = exportCanvas.getContext("2d");
  exportCtx.drawImage(baseCanvas, 0, 0);
  exportCtx.drawImage(shapeCanvas, 0, 0);
  const dataUrl = exportCanvas.toDataURL("image/png");

  try {
    const res = await fetch(buildBackendUrl("/save-image"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageData: dataUrl }),
    });
    const result = await res.json();
    if (result.url) {
      await refreshGallery();
      alert("Saved to server");
    } else {
      alert("Save failed");
    }
  } catch (err) {
    console.error(err);
    alert("Save error");
  }
}

saveBtn.addEventListener("click", saveCanvas);

async function downloadCanvas() {
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = baseCanvas.width;
  exportCanvas.height = baseCanvas.height;
  const exportCtx = exportCanvas.getContext("2d");
  exportCtx.drawImage(baseCanvas, 0, 0);
  exportCtx.drawImage(shapeCanvas, 0, 0);

  const blob = await new Promise((resolve) => exportCanvas.toBlob(resolve, "image/png"));
  if (!blob) {
    alert("Download failed");
    return;
  }

  const blobUrl = URL.createObjectURL(blob);
  triggerDownload(blobUrl, `whiteboard-${Date.now()}.png`);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
}

downloadBtn.addEventListener("click", downloadCanvas);

async function refreshGallery() {
  try {
    const res = await fetch(buildBackendUrl("/list-images"));
    const list = await res.json();
    imagesEl.innerHTML = "";
    list.reverse().forEach((url) => {
      const absoluteUrl = toAbsoluteAssetUrl(url);
      const item = document.createElement("div");
      item.className = "gallery-item";

      const img = document.createElement("img");
      img.src = absoluteUrl;

      const download = document.createElement("button");
      download.type = "button";
      download.textContent = "Download";
      download.addEventListener("click", async () => {
        try {
          const response = await fetch(absoluteUrl);
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          triggerDownload(blobUrl, getFilenameFromUrl(absoluteUrl));
          setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
        } catch (err) {
          console.error(err);
          alert("Download failed");
        }
      });

      item.appendChild(img);
      item.appendChild(download);
      imagesEl.appendChild(item);
    });
  } catch (err) {
    console.error(err);
  }
}

refreshGallery();
