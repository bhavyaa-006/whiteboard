const socket = io();

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const colorPicker = document.getElementById("color");
const sizeInput = document.getElementById("size");
const clearBtn = document.getElementById("clear");
const saveBtn = document.getElementById("save");
const imagesEl = document.getElementById("images");

let drawing = false;
let last = null;

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

function sendLine(from, to, color, size){
  socket.emit("draw", { from, to, color, size });
}

function drawLine(from, to, color, size){
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
  ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
  ctx.stroke();
}

canvas.addEventListener("pointerdown", (e)=>{
  drawing = true;
  last = { x: e.clientX / canvas.width, y: e.clientY / canvas.height };
});

canvas.addEventListener("pointermove", (e)=>{
  if (!drawing) return;
  const cur = { x: e.clientX / canvas.width, y: e.clientY / canvas.height };
  const color = colorPicker.value;
  const size = parseInt(sizeInput.value, 10);
  drawLine(last, cur, color, size);
  sendLine(last, cur, color, size);
  last = cur;
});

canvas.addEventListener("pointerup", ()=>{ drawing=false; last=null; });
canvas.addEventListener("pointercancel", ()=>{ drawing=false; last=null; });

socket.on("draw", (data)=>{
  drawLine(data.from, data.to, data.color, data.size);
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
