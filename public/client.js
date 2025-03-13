const socket = io();
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
let gameStarted = false;

// Set canvas to viewport size
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
socket.emit("setDimensions", { width: canvas.width, height: canvas.height });

// Local player state
let localPlayer = { x: canvas.width / 2, y: canvas.height / 2, angle: 0 };

function startGame() {
  const username = document.getElementById("username").value.trim();
  if (username) {
    socket.emit("login", username);
    document.getElementById("login").style.display = "none";
    canvas.style.display = "block";
    canvas.focus();
    gameStarted = true;
    requestAnimationFrame(gameLoop);
  }
}

const keys = { w: false, a: false, s: false, d: false };
document.addEventListener("keydown", (e) => {
  if (!gameStarted) return;
  e.preventDefault();
  if (e.key === "p") {
    socket.emit("pause", !gameState.players[socket.id]?.paused);
  }
  if (e.key in keys) keys[e.key] = true;
});

document.addEventListener("keyup", (e) => {
  if (!gameStarted) return;
  e.preventDefault();
  if (e.key in keys) keys[e.key] = false;
});

canvas.addEventListener("mousemove", (e) => {
  if (!gameStarted) return;
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  localPlayer.angle = Math.atan2(mouseY - localPlayer.y, mouseX - localPlayer.x);
  socket.emit("rotate", localPlayer.angle);
});

canvas.addEventListener("mousedown", (e) => {
  if (gameStarted && e.button === 0) socket.emit("shoot");
});

let gameState = { players: {}, bullets: [], bots: [] };

socket.on("update", (state) => {
  gameState = state;
  if (gameState.players[socket.id]) {
    const serverPlayer = gameState.players[socket.id];
    const dx = serverPlayer.x - localPlayer.x;
    const dy = serverPlayer.y - localPlayer.y;
    const distance = dx * dx + dy * dy;
    if (distance > 100) {
      localPlayer.x += dx * 0.1;
      localPlayer.y += dy * 0.1;
    }
  }
});

socket.on("dead", () => {
  gameStarted = false;
  canvas.style.display = "none";
  alert("You died!");
  location.reload();
});

function updateMovement() {
  if (!gameStarted || gameState.players[socket.id]?.paused) return;
  let move = { x: 0, y: 0 };
  if (keys.w) move.y -= 5;
  if (keys.s) move.y += 5;
  if (keys.a) move.x -= 5;
  if (keys.d) move.x += 5;

  if (move.x || move.y) {
    localPlayer.x = Math.max(0, Math.min(canvas.width, localPlayer.x + move.x));
    localPlayer.y = Math.max(0, Math.min(canvas.height, localPlayer.y + move.y));
    socket.emit("move", move);
  }
}

function draw() {
  ctx.fillStyle = "#000000"; // Solid black background
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (gameState.players[socket.id]) {
    const p = gameState.players[socket.id];
    ctx.save();
    ctx.translate(localPlayer.x, localPlayer.y);
    ctx.rotate(localPlayer.angle);
    ctx.fillStyle = p.paused ? "#808080" : p.color;
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-10, 10);
    ctx.lineTo(-10, -10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "12px Arial";
    ctx.fillText(p.username, localPlayer.x - ctx.measureText(p.username).width / 2, localPlayer.y - 20);
  }

  for (const id in gameState.players) {
    if (id === socket.id) continue;
    const p = gameState.players[id];
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = p.paused ? "#808080" : p.color;
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-10, 10);
    ctx.lineTo(-10, -10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "12px Arial";
    ctx.fillText(p.username, p.x - ctx.measureText(p.username).width / 2, p.y - 20);
  }

  gameState.bullets.forEach((b) => {
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
    ctx.fill();
  });

  gameState.bots.forEach((b) => {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    ctx.fillStyle = b.color; // Random color from server
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-10, 10);
    ctx.lineTo(-10, -10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  });
}

function gameLoop() {
  if (!gameStarted) return;
  updateMovement();
  draw();
  requestAnimationFrame(gameLoop);
}

canvas.setAttribute("tabindex", "0");