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
let particles = [];

let lastFrameTime = performance.now();
let fps = 0;
let ping = 0;
let lastPingTime = 0;

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

// Replace the ping event handler
socket.on("pong", () => {
  ping = Date.now() - lastPingTime;
  lastPingTime = Date.now(); // Reset for next ping
  socket.emit("ping"); // Immediately request next ping
});

socket.on("dead", () => {
  gameStarted = false;
  canvas.style.display = "none";
  alert("You died!");
  location.reload();
});

socket.on("explosion", (pos) => {
  const colors = pos.color.split(',').map(c => c.trim());
  const particleCount = pos.size || 20;
  
  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 4 + 2;
    const size = Math.random() * 4 + 2;
    const color = colors[Math.floor(Math.random() * colors.length)];
    
    particles.push({
      x: pos.x,
      y: pos.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: color.replace('#', ''),
      life: 60,
      size: size,
      alpha: 1
    });
  }
});

// Replace measurePing function
function measurePing() {
  lastPingTime = Date.now();
  socket.emit("ping");
}

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
  // Dark background with gradient
  ctx.fillStyle = '#0a0a15';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw particles with reduced glow
  particles.forEach((p, i) => {
    p.life--;
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.98; // Add friction
    p.vy *= 0.98;
    p.alpha = p.life / 60;
    
    ctx.shadowBlur = 15;
    ctx.shadowColor = `#${p.color}`;
    ctx.fillStyle = `#${p.color}`;
    ctx.globalAlpha = p.alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (p.life <= 0) particles.splice(i, 1);
  });

  // Draw local player
  if (gameState.players[socket.id]) {
    const p = gameState.players[socket.id];
    ctx.save();
    ctx.translate(localPlayer.x, localPlayer.y);
    ctx.rotate(localPlayer.angle);
    
    // Add glow effect only for local player
    ctx.shadowBlur = 10;
    ctx.shadowColor = p.color;
    
    ctx.fillStyle = p.paused ? "#404040" : p.color;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-10, 10);
    ctx.lineTo(-10, -10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#ffffff";
    ctx.font = "12px Arial";
    ctx.fillText(p.username, localPlayer.x - ctx.measureText(p.username).width / 2, localPlayer.y - 20);
  }

  // Reset shadow
  ctx.shadowBlur = 0;

  // Draw other players without glow
  for (const id in gameState.players) {
    if (id === socket.id) continue;
    const p = gameState.players[id];
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.fillStyle = p.paused ? "#404040" : p.color;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-10, 10);
    ctx.lineTo(-10, -10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    
    ctx.fillStyle = "#ffffff";
    ctx.font = "12px Arial";
    ctx.fillText(p.username, p.x - ctx.measureText(p.username).width / 2, p.y - 20);
  }

  // Draw bullets with minimal effects
  gameState.bullets.forEach((b) => {
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw bots without glow
  gameState.bots.forEach((b) => {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    ctx.fillStyle = b.color;
    ctx.strokeStyle = "#ff0000";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-10, 10);
    ctx.lineTo(-10, -10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  });

  // Draw UI
  ctx.fillStyle = "#ffffff";
  ctx.font = "14px Arial";
  ctx.fillText(`FPS: ${fps}`, 10, 20);
  ctx.fillText(`Ping: ${ping}ms`, 10, 40);

  // Add upgrade status
  if (gameState.players[socket.id]) {
    const player = gameState.players[socket.id];
    const upgradeTexts = [
      "No upgrade",
      "Rapid Fire",
      "Double Shot",
      "Triple Shot"
    ];
    const upgradeText = upgradeTexts[player.upgrade] || upgradeTexts[3];
    ctx.fillText(`Upgrade: ${upgradeText}`, 10, 60);
    ctx.fillText(`Kills to next: ${50 - (player.score % 50)}`, 10, 80);
  }

  // Replace the player list drawing code with this scoreboard
  // Draw player list
  ctx.fillStyle = "rgba(0, 10, 30, 0.7)";
  ctx.fillRect(canvas.width - 200, 0, 200, Object.keys(gameState.players).length * 20 + 30);

  // Draw scoreboard header
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 14px Arial";
  ctx.fillText("SCOREBOARD", canvas.width - 190, 20);

  // Draw player scores
  let y = 40;
  const sortedPlayers = Object.values(gameState.players)
    .sort((a, b) => b.score - a.score);

  for (const player of sortedPlayers) {
    const status = player.paused ? " (PAUSED)" : "";
    ctx.fillStyle = player.color;
    ctx.font = "14px Arial";
    ctx.fillText(
      `${player.username}${status}: ${player.score}`, 
      canvas.width - 190, 
      y
    );
    y += 20;
  }
}

// Replace gameLoop function
function gameLoop() {
  if (!gameStarted) return;
  
  const now = performance.now();
  const delta = now - lastFrameTime;
  fps = Math.round(1000 / delta);
  lastFrameTime = now;

  // Remove ping measurement from here since it's now continuous
  updateMovement();
  draw();
  requestAnimationFrame(gameLoop);
}

// Add this after gameState declaration
socket.emit("ping"); // Initial ping measurement when game starts

canvas.setAttribute("tabindex", "0");