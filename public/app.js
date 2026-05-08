const socket = io({
  transports: ["polling", "websocket"],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: 5
});

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const colorPicker = document.getElementById("color");
const sizeInput = document.getElementById("size");
const brushInput = document.getElementById("brush");
const shapeInput = document.getElementById("shape");
const useFillCheckbox = document.getElementById("useFill");
const fillColorPicker = document.getElementById("fillColor");
const clearBtn = document.getElementById("clear");
const saveBtn = document.getElementById("save");
const imagesEl = document.getElementById("images");

let drawing = false;
let last = null;
let shapeStart = null;

function resize(){
  const data = canvas.toDataURL();
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const img = new Image();
  img.onload = ()=> ctx.drawImage(img,0,0);
  img.src = data;
}

window.addEventListener("resize", resize);
resize();

// Toggle fill color input based on checkbox
useFillCheckbox.addEventListener("change", () => {
  fillColorPicker.disabled = !useFillCheckbox.checked;
});

function sendLine(from, to, color, size, brush, shape, useFill, fillColor){
  socket.emit("draw", { from, to, color, size, brush, shape, useFill, fillColor });
}

function drawDottedLine(from, to, color, size){
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.setLineDash([size * 2, size * 2]);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
  ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawDashedLine(from, to, color, size){
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.setLineDash([size * 4, size * 2]);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
  ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawSprayLine(from, to, color, size){
  const distance = Math.sqrt(Math.pow(to.x - from.x, 2) + Math.pow(to.y - from.y, 2));
  const steps = Math.ceil(distance * canvas.width);
  
  for(let i = 0; i < steps; i++){
    const t = steps > 0 ? i / steps : 0;
    const x = (from.x + (to.x - from.x) * t) * canvas.width;
    const y = (from.y + (to.y - from.y) * t) * canvas.height;
    
    for(let j = 0; j < size * 3; j++){
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * size;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      
      ctx.fillStyle = color;
      ctx.fillRect(px, py, 1, 1);
    }
  }
}

function drawSolidLine(from, to, color, size){
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
  ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
  ctx.stroke();
}

function drawLine(from, to, color, size, brush = "solid"){
  if (brush === "dotted") drawDottedLine(from, to, color, size);
  else if (brush === "dashed") drawDashedLine(from, to, color, size);
  else if (brush === "spray") drawSprayLine(from, to, color, size);
  else drawSolidLine(from, to, color, size);
}

function drawRectangle(start, end, color, size, useFill, fillColor){
  const x1 = start.x * canvas.width;
  const y1 = start.y * canvas.height;
  const x2 = end.x * canvas.width;
  const y2 = end.y * canvas.height;
  const width = x2 - x1;
  const height = y2 - y1;
  
  if (useFill) {
    ctx.fillStyle = fillColor;
    ctx.fillRect(x1, y1, width, height);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.strokeRect(x1, y1, width, height);
}

function drawCircle(start, end, color, size, useFill, fillColor){
  const x1 = start.x * canvas.width;
  const y1 = start.y * canvas.height;
  const x2 = end.x * canvas.width;
  const y2 = end.y * canvas.height;
  const radius = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  
  ctx.beginPath();
  ctx.arc(x1, y1, radius, 0, Math.PI * 2);
  if (useFill) {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.stroke();
}

function drawTriangle(start, end, color, size, useFill, fillColor){
  const x1 = start.x * canvas.width;
  const y1 = start.y * canvas.height;
  const x2 = end.x * canvas.width;
  const y2 = end.y * canvas.height;
  const width = x2 - x1;
  const height = y2 - y1;
  
  ctx.beginPath();
  ctx.moveTo(x1 + width / 2, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x1, y2);
  ctx.closePath();
  
  if (useFill) {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.stroke();
}

canvas.addEventListener("pointerdown", (e)=>{
  drawing = true;
  shapeStart = { x: e.clientX / canvas.width, y: e.clientY / canvas.height };
  last = shapeStart;
});

canvas.addEventListener("pointermove", (e)=>{
  if (!drawing) return;
  
  const cur = { x: e.clientX / canvas.width, y: e.clientY / canvas.height };
  const color = colorPicker.value;
  const size = parseInt(sizeInput.value, 10);
  const brush = brushInput.value;
  const shape = shapeInput.value;
  const useFill = useFillCheckbox.checked;
  const fillColor = fillColorPicker.value;
  
  if (shape === "pen") {
    drawLine(last, cur, color, size, brush);
    sendLine(last, cur, color, size, brush, shape, useFill, fillColor);
    last = cur;
  } else {
    // For shapes, redraw the entire canvas to show live preview
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    if (shape === "line") drawLine(shapeStart, cur, color, size, brush);
    else if (shape === "rectangle") drawRectangle(shapeStart, cur, color, size, useFill, fillColor);
    else if (shape === "circle") drawCircle(shapeStart, cur, color, size, useFill, fillColor);
    else if (shape === "triangle") drawTriangle(shapeStart, cur, color, size, useFill, fillColor);
  }
});

canvas.addEventListener("pointerup", ()=>{
  if (drawing && shapeStart) {
    const color = colorPicker.value;
    const size = parseInt(sizeInput.value, 10);
    const brush = brushInput.value;
    const shape = shapeInput.value;
    const useFill = useFillCheckbox.checked;
    const fillColor = fillColorPicker.value;
    const cur = last;
    
    if (shape !== "pen") {
      sendLine(shapeStart, cur, color, size, brush, shape, useFill, fillColor);
    }
  }
  
  drawing = false;
  last = null;
  shapeStart = null;
});

canvas.addEventListener("pointercancel", ()=>{ drawing=false; last=null; shapeStart=null; });

socket.on("draw", (data)=>{
  const { from, to, color, size, brush = "solid", shape = "pen", useFill = false, fillColor = "#FF0000" } = data;
  
  if (shape === "pen") {
    drawLine(from, to, color, size, brush);
  } else if (shape === "line") {
    drawLine(from, to, color, size, brush);
  } else if (shape === "rectangle") {
    drawRectangle(from, to, color, size, useFill, fillColor);
  } else if (shape === "circle") {
    drawCircle(from, to, color, size, useFill, fillColor);
  } else if (shape === "triangle") {
    drawTriangle(from, to, color, size, useFill, fillColor);
  }
});

clearBtn.addEventListener("click", ()=>{
  ctx.clearRect(0,0,canvas.width,canvas.height);
  socket.emit("clear");
});

socket.on("clear", ()=>{
  ctx.clearRect(0,0,canvas.width,canvas.height);
});

async function saveCanvas(){
  const dataUrl = canvas.toDataURL("image/png");
  try{
    const res = await fetch("/save-image", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ imageData: dataUrl }) });
    const j = await res.json();
    if (j.url) {
      await refreshGallery();
      alert("Saved to server");
    } else {
      alert("Save failed");
    }
  } catch (err){
    console.error(err);
    alert("Save error");
  }
}

saveBtn.addEventListener("click", saveCanvas);

async function refreshGallery(){
  try{
    const res = await fetch("/list-images");
    const list = await res.json();
    imagesEl.innerHTML = "";
    list.reverse().forEach(url => {
      const img = document.createElement("img");
      img.src = url;
      imagesEl.appendChild(img);
    });
  } catch (err){ console.error(err); }
}

refreshGallery();
