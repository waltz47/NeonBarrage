// Initialize socket with error handling
let socket;
try {
  socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5
  });
  // Make socket available globally
  window.socket = socket;
} catch (error) {
  console.error("Failed to initialize socket:", error);
  window.onSocketError(error);
}

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d", { alpha: false });
let gameStarted = false;

// Initialize input elements
const usernameInput = document.getElementById("username");
const joinButton = document.getElementById("joinButton");

// Only disable join button by default, leave input enabled
joinButton.disabled = true;

// Set canvas to viewport size
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
socket.emit("setDimensions", { width: canvas.width, height: canvas.height });

// Logging socket connection status
socket.on('connect', () => {
  console.log("%c🔌 SOCKET CONNECTED", "background: green; color: white");
  console.log("Socket ID:", socket.id);
  joinButton.disabled = false;
  window.onSocketConnect();
});

socket.on('connect_error', (error) => {
  console.error("%c❌ SOCKET CONNECTION ERROR", "background: red; color: white", error);
  usernameInput.placeholder = "Cannot connect to server...";
  usernameInput.disabled = true;
  joinButton.disabled = true;
  window.onSocketError(error);
});

socket.on('disconnect', (reason) => {
  console.warn("%c🔌 SOCKET DISCONNECTED", "background: orange; color: black", reason);
  usernameInput.placeholder = "Connection lost...";
  usernameInput.disabled = true;
  joinButton.disabled = true;
});

// Check if pickup system is available, and create a fallback if not
function checkPickupSystem() {
  // First check if the real system is available - it should be initialized with a placeholder at the top of pickups.js
  if (window.pickupSystem) {
    // Multiple checks to ensure it's the real system
    if (window.pickupSystem._isRealSystem === true || 
        window.pickupSystem._isFallback === false ||
        typeof window.pickupSystem.debug === 'function') {
      console.log("✅ Real pickup system found!");
      return true;
    }
  }
  
  console.error("❌ PICKUP SYSTEM NOT FOUND - Creating fallback system");
  console.error("Current pickupSystem:", window.pickupSystem);
  
  // Create a bare-bones fallback pickup system
  window.pickupSystem = {
    pickups: [],
    _isFallback: true,
    
    drawPickups: function(ctx) {
      console.warn("Using fallback drawPickups - real system not loaded!");
      
      // Draw a warning indicator
      ctx.fillStyle = 'red';
      ctx.font = '20px Arial';
      ctx.fillText('PICKUP SYSTEM NOT LOADED!', 20, canvas.height - 20);
      
      // Draw any pickups in the fallback array
      if (this.pickups && this.pickups.length > 0) {
        this.pickups.forEach(pickup => {
          ctx.fillStyle = 'red';
          ctx.beginPath();
          ctx.arc(pickup.x, pickup.y, 30, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.fillStyle = 'white';
          ctx.fillText(pickup.type, pickup.x - 40, pickup.y);
        });
      }
    },
    
    checkPickupCollisions: function() {
      console.warn("Using fallback checkPickupCollisions - real system not loaded!");
    }
  };
  
  // Create a test socket listener for pickups in the fallback
  socket.on('pickupSpawned', (pickup) => {
    console.warn("Pickup spawned event caught by FALLBACK system:", pickup);
    window.pickupSystem.pickups.push(pickup);
  });
  
  socket.on('pickupDespawned', (pickupId) => {
    console.warn("Pickup despawned event caught by FALLBACK system:", pickupId);
    window.pickupSystem.pickups = window.pickupSystem.pickups.filter(p => p.id !== pickupId);
  });
  
  return false;
}

// Local player state
let localPlayer = { x: canvas.width / 2, y: canvas.height / 2, angle: 0 };

// Set up throttled event handlers
let lastMoveSent = 0;
const MOVE_THROTTLE = 16; // Reduced from 50ms to ~16ms (60fps) for smoother updates

function startGame() {
  const username = document.getElementById("username").value.trim();
  if (!username) {
    alert("Please enter a username");
    return;
  }
  
  if (!socket.connected) {
    console.error("Socket not connected - cannot join game");
    alert("Cannot connect to game server. Please try again in a moment.");
    return;
  }
  
  console.log("🎮 Starting game with username:", username);
  socket.emit("login", username);
  console.log("🔄 Login event emitted");
  
  document.getElementById("login").style.display = "none";
  canvas.style.display = "block";
  canvas.focus();
  gameStarted = true;
  
  // Check that the pickup system is available
  const pickupSystemReady = checkPickupSystem();
  
  // Log the status
  if (pickupSystemReady) {
    console.log("✅ Game started with pickup system ready");
  } else {
    console.warn("⚠️ Game started with fallback pickup system");
  }
  
  console.log("🎬 Starting game loop");
  requestAnimationFrame(gameLoop);
}

const keys = { w: false, a: false, s: false, d: false };
document.addEventListener("keydown", (e) => {
  if (!gameStarted) return;
  if (e.key === "p") {
    socket.emit("pause", !gameState.players[socket.id]?.paused);
  }
  if (e.key in keys) keys[e.key] = true;
  e.preventDefault();
});

document.addEventListener("keyup", (e) => {
  if (!gameStarted) return;
  if (e.key in keys) keys[e.key] = false;
  e.preventDefault();
});

// Throttle mouse move events
let lastMouseMove = 0;
const MOUSE_THROTTLE = 50; // Only update angle every 50ms

canvas.addEventListener("mousemove", (e) => {
  if (!gameStarted) return;
  
  const now = performance.now();
  if (now - lastMouseMove < MOUSE_THROTTLE) return;
  lastMouseMove = now;
  
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  localPlayer.angle = Math.atan2(mouseY - localPlayer.y, mouseX - localPlayer.x);
  socket.emit("rotate", localPlayer.angle);
});

// Throttle mouse click events to prevent rapid fire
let lastShot = 0;
const SHOT_THROTTLE = 100; // Limit to roughly 10 shots per second client-side

canvas.addEventListener("mousedown", (e) => {
  if (!gameStarted || e.button !== 0) return;
  
  const now = performance.now();
  if (now - lastShot < SHOT_THROTTLE) return;
  lastShot = now;
  
  // Send current client position with shoot event for more accurate bullet spawning
  socket.emit("shoot", {
    clientX: localPlayer.x,
    clientY: localPlayer.y,
    angle: localPlayer.angle
  });
});

let gameState = { players: {}, bullets: [], bots: [] };
let particles = [];

// Add these after the gameState declaration
let backgroundParticles = [];
const BACKGROUND_PARTICLE_COUNT = 25; // Reduced from 50

// Initialize background particles
for (let i = 0; i < BACKGROUND_PARTICLE_COUNT; i++) {
  backgroundParticles.push({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height,
    size: Math.random() * 2 + 1,
    speed: Math.random() * 0.5 + 0.2,
    color: `rgba(${Math.random() * 100 + 155}, ${Math.random() * 100 + 155}, 255, 0.5)`
  });
}

let lastFrameTime = performance.now();
let fps = 0;
let ping = 0;
let lastPingTime = 0;
let frameCount = 0; // Add local frame counter for client-side updates

// Batch updates to reduce redraws
let pendingUpdates = [];
const MAX_PENDING_UPDATES = 2;

socket.on("update", (state) => {
  pendingUpdates.push(state);
  
  // Process only the most recent update if we have too many
  if (pendingUpdates.length > MAX_PENDING_UPDATES) {
    gameState = pendingUpdates.pop();
    pendingUpdates = [];
  }
});

// Initialize variables for the optimizations
let cachedGradient = null;
let lastPlayerCount = 0;
let scoreboardCache = null;
let scoreboardNeedsUpdate = true;

// Create an offscreen canvas for the scoreboard to prevent flickering
function createScoreboardCache() {
  if (!scoreboardCache) {
    scoreboardCache = document.createElement('canvas');
  }
  scoreboardCache.width = 200;
  scoreboardCache.height = Math.max(1, Object.keys(gameState.players).length) * 20 + 30;
  
  const sbCtx = scoreboardCache.getContext('2d');
  
  // Draw scoreboard background
  sbCtx.fillStyle = "rgba(0, 10, 30, 0.7)";
  sbCtx.fillRect(0, 0, scoreboardCache.width, scoreboardCache.height);

  // Draw scoreboard header
  sbCtx.fillStyle = "#ffffff";
  sbCtx.font = "bold 14px Arial";
  sbCtx.fillText("SCOREBOARD", 10, 20);

  // Draw player scores
  let y = 40;
  const sortedPlayers = Object.values(gameState.players)
    .sort((a, b) => b.score - a.score);

  if (sortedPlayers.length === 0) {
    sbCtx.fillStyle = "#ffffff";
    sbCtx.font = "14px Arial";
    sbCtx.fillText("No players yet", 10, y);
  } else {
    for (const player of sortedPlayers) {
      const status = player.paused ? " (PAUSED)" : "";
      sbCtx.fillStyle = player.color;
      sbCtx.font = "14px Arial";
      sbCtx.fillText(
        `${player.username}${status}: ${player.score}`, 
        10, 
        y
      );
      y += 20;
    }
  }
}

function draw() {
  // Dark background with gradient
  ctx.fillStyle = '#0a0a15';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw background particles without creating a new gradient every frame
  backgroundParticles.forEach(p => {
    p.y += p.speed;
    if (p.y > canvas.height) {
      p.y = 0;
      p.x = Math.random() * canvas.width;
    }
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  });

  // Cache and reuse the gradient instead of creating it every frame
  if (!cachedGradient) {
    cachedGradient = ctx.createRadialGradient(
    canvas.width/2, canvas.height/2, 0,
    canvas.width/2, canvas.height/2, canvas.width/2
  );
    cachedGradient.addColorStop(0, 'rgba(0,20,40,0)');
    cachedGradient.addColorStop(1, 'rgba(0,20,40,0.3)');
  }
  ctx.fillStyle = cachedGradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Reduce shadows and only apply when necessary
  // Draw particles with minimal effects
  ctx.shadowBlur = 0; // Turn off shadow by default
  
  // Process particles in batches for better performance
  const maxParticlesToRender = Math.min(particles.length, 50);
  for (let i = particles.length - 1; i >= particles.length - maxParticlesToRender; i--) {
    if (i < 0) break;
    
    const p = particles[i];
    p.life--;
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.98;
    p.vy *= 0.98;
    p.alpha = p.life / 60;
    
    // Only apply shadow blur for larger particles
    if (p.size > 3) {
      ctx.shadowBlur = 10;
    ctx.shadowColor = `#${p.color}`;
    } else {
      ctx.shadowBlur = 0;
    }
    
    ctx.fillStyle = `#${p.color}`;
    ctx.globalAlpha = p.alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    
    if (p.life <= 0) particles.splice(i, 1);
  }

  // Reset shadow
  ctx.shadowBlur = 0;

  // Draw local player
  if (gameState.players[socket.id]) {
    const p = gameState.players[socket.id];
    ctx.save();
    ctx.translate(localPlayer.x, localPlayer.y);
    ctx.rotate(localPlayer.angle);
    
    // Only apply glow for local player and limit shadow blur
    ctx.shadowBlur = 5; // Reduced from 10
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

    // Reset shadow for text
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ffffff";
    ctx.font = "12px Arial";
    ctx.fillText(p.username, localPlayer.x - ctx.measureText(p.username).width / 2, localPlayer.y - 20);
  }

  // Reset shadow
  ctx.shadowBlur = 0;

  // Draw other players without glow - only draw visible players
  for (const id in gameState.players) {
    if (id === socket.id) continue;
    const p = gameState.players[id];
    
    // Skip players that are off-screen (with a margin)
    if (p.x < -50 || p.x > canvas.width + 50 || p.y < -50 || p.y > canvas.height + 50) continue;
    
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

  // Draw bullets with minimal effects - only draw visible bullets
  gameState.bullets.forEach((b) => {
    // Skip bullets that are off-screen (with a margin)
    if (b.x < -10 || b.x > canvas.width + 10 || b.y < -10 || b.y > canvas.height + 10) return;
    
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw bots without glow - only draw visible bots
  gameState.bots.forEach((b) => {
    // Skip bots that are off-screen (with a margin)
    if (b.x < -50 || b.x > canvas.width + 50 || b.y < -50 || b.y > canvas.height + 50) return;
    
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
      "Twin Shot",
      "Triple Shot"
    ];
    const upgradeText = upgradeTexts[player.upgrade] || upgradeTexts[2];
    ctx.fillText(`Upgrade: ${upgradeText}`, 10, 60);
    ctx.fillText(`Kills to next: ${50 - (player.score % 50)}`, 10, 80);
    
    // Draw active pickup list in bottom left
    if (window.pickupSystem && window.activePickups) {
      const activePickupKeys = Object.keys(window.activePickups);
      
      if (activePickupKeys.length > 0) {
        // Draw background panel
        ctx.fillStyle = "rgba(0, 10, 30, 0.7)";
        ctx.fillRect(10, canvas.height - 110, 200, 100);
        
        // Draw header
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 14px Arial";
        ctx.fillText("ACTIVE PICKUPS", 20, canvas.height - 90);
        
        // Draw each active pickup
        let y = canvas.height - 70;
        activePickupKeys.forEach(type => {
          const pickupInfo = window.PICKUP_TYPES[type];
          if (pickupInfo) {
            const timeActive = Date.now() - window.activePickups[type].activatedAt;
            const duration = pickupInfo.duration || 5000;
            const timeRemaining = Math.max(0, (duration - timeActive) / 1000).toFixed(1);
            
            ctx.fillStyle = pickupInfo.color;
            ctx.beginPath();
            ctx.arc(25, y, 8, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = "#ffffff";
            ctx.font = "14px Arial";
            ctx.fillText(`${pickupInfo.description} (${timeRemaining}s)`, 40, y + 5);
            
            y += 20;
          }
        });
      }
    }
  }

  // Draw the scoreboard from cache if available, or create it if needed
  if (scoreboardNeedsUpdate || !scoreboardCache) {
    createScoreboardCache();
    scoreboardNeedsUpdate = false;
  }
  
  // Draw the cached scoreboard in the top-right corner
  if (scoreboardCache) {
    ctx.drawImage(scoreboardCache, canvas.width - scoreboardCache.width, 0);
  }

  // Draw pickups if the system is available
  if (window.pickupSystem) {
    window.pickupSystem.drawPickups(ctx);
  }
}

// Replace the original drawScoreboard function with a function that just marks it for update
function updateScoreboard() {
  const playerCount = Object.keys(gameState.players).length;
  if (lastPlayerCount !== playerCount) {
    scoreboardNeedsUpdate = true;
    lastPlayerCount = playerCount;
  }
}

// Add handler for position correction
socket.on("position-correction", (pos) => {
  if (pos.x !== undefined && pos.y !== undefined) {
    // Smoothly update position over time rather than snapping
    const dx = pos.x - localPlayer.x;
    const dy = pos.y - localPlayer.y;
    
    // If the difference is very large, snap instantly to avoid visible teleporting
    if (dx * dx + dy * dy > 10000) { // Increased threshold to reduce teleporting
      localPlayer.x = pos.x;
      localPlayer.y = pos.y;
    } else {
      // Mark position for gradual correction over more frames for smoothness
      localPlayer.targetX = pos.x;
      localPlayer.targetY = pos.y;
      localPlayer.correctionTimeRemaining = 10; // Increased from 5 to 10 frames
    }
  }
});

// Process pending game state updates in the game loop
function processUpdates() {
  // Apply any position correction in progress
  if (localPlayer.correctionTimeRemaining > 0) {
    const factor = 0.15; // Fixed lower factor for smoother corrections
    localPlayer.x += (localPlayer.targetX - localPlayer.x) * factor;
    localPlayer.y += (localPlayer.targetY - localPlayer.y) * factor;
    localPlayer.correctionTimeRemaining--;
  }
  
  if (pendingUpdates.length === 0) return;
  
  // Get the most recent update
  gameState = pendingUpdates.pop();
  pendingUpdates = [];
  
  if (gameState.players[socket.id]) {
    const serverPlayer = gameState.players[socket.id];
    
    // Always update scoreboard when we get new game state
    scoreboardNeedsUpdate = true;
    
    // Store the server position locally to use for bullet spawning
    serverPlayer.clientX = serverPlayer.x;
    serverPlayer.clientY = serverPlayer.y;
    
    // Calculate the difference between client prediction and server state
    const dx = serverPlayer.x - localPlayer.x;
    const dy = serverPlayer.y - localPlayer.y;
    const distanceSquared = dx * dx + dy * dy;
    
    // Use gentler lerping with diminishing adjustments to avoid jankiness
    if (distanceSquared > 6400) { // Large correction for extreme differences
      localPlayer.x += dx * 0.3; // Reduced from instant to 30% correction
      localPlayer.y += dy * 0.3;
    } else if (distanceSquared > 1600) {
      localPlayer.x += dx * 0.15;
      localPlayer.y += dy * 0.15;
    } else if (distanceSquared > 400) {
      localPlayer.x += dx * 0.08;
      localPlayer.y += dy * 0.08;
    } else if (distanceSquared > 100) {
      localPlayer.x += dx * 0.05;
      localPlayer.y += dy * 0.05;
    }
    // Very small differences are ignored to prevent jitter
  }
}

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
  const particleCount = Math.min(pos.size || 20, 25); // Limit max particles
  
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

// Add timestamp tracking for frame-independent movement
let lastUpdateTime = performance.now();

function updateMovement() {
  if (!gameStarted || gameState.players[socket.id]?.paused) return;
  
  const now = performance.now();
  const deltaTime = (now - lastUpdateTime) / (1000 / 60); // Normalize to 60fps
  lastUpdateTime = now;
  
  // Get player's current speed from server state, with fallback to base speed
  const serverPlayer = gameState.players[socket.id];
  const baseSpeed = 8;
  const currentSpeed = (serverPlayer && serverPlayer.speed) || baseSpeed;
  
  // Apply frame rate independence
  const speed = currentSpeed * Math.min(deltaTime, 2); // Cap at 2x to prevent huge jumps
  
  // Calculate movement vector
  let dx = 0, dy = 0;
  if (keys.w) dy -= speed;
  if (keys.s) dy += speed;
  if (keys.a) dx -= speed;
  if (keys.d) dx += speed;

  // Normalize diagonal movement to prevent faster diagonal speed
  if (dx !== 0 && dy !== 0) {
    const diagonalFactor = 0.7071; // 1/sqrt(2)
    dx *= diagonalFactor;
    dy *= diagonalFactor;
  }

  if (dx !== 0 || dy !== 0) {
    // Apply client-side prediction with buffering
    // Instead of immediately updating to the final position, move a percentage of the way
    const newX = Math.max(0, Math.min(canvas.width, localPlayer.x + dx));
    const newY = Math.max(0, Math.min(canvas.height, localPlayer.y + dy));
    
    // Gradually update local position for smoother movement
    localPlayer.x = newX;
    localPlayer.y = newY;
    
    // Throttle sending movement updates to server
    const now = performance.now();
    if (now - lastMoveSent > MOVE_THROTTLE) {
      // Send the current client position
      socket.emit("move", { 
        x: dx, 
        y: dy,
        clientX: localPlayer.x,
        clientY: localPlayer.y 
      });
      lastMoveSent = now;
    }
  }
}

// Game loop function
function gameLoop() {
  if (!gameStarted) return;
  
  const now = performance.now();
  const delta = now - lastFrameTime;
  fps = Math.round(1000 / delta);
  lastFrameTime = now;

  // Process any pending game state updates
  processUpdates();
  
  // Increment frame counter
  frameCount++;
  
  // Update scoreboard only every 60 frames (approximately once per second)
  if (frameCount % 60 === 0) {
    scoreboardNeedsUpdate = true;
  }

  // Batch particle cleanup to reduce GC pressure
  if (particles.length > 100) {
    particles = particles.slice(-100);
  }

  updateMovement();
  updateScoreboard(); // Check if scoreboard needs updating based on player count
  
  // Draw the scene
  draw();
  
  // Always share the gameState and localPlayer with the window object
  window.gameState = gameState;
  window.localPlayer = localPlayer;
  
  // Share the gameState and localPlayer with the pickup system
  if (window.pickupSystem) {
    window.pickupSystem.checkPickupCollisions();
  }
  
  // Use requestAnimationFrame for smoother animation
  requestAnimationFrame(gameLoop);
}

// Add this after gameState declaration
socket.emit("ping"); // Initial ping measurement when game starts

// Disable right-click context menu on canvas
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.setAttribute("tabindex", "0");

// Add this to the socket.on("login") event that the server might send
socket.on("login-confirm", (data) => {
  console.log("🔐 Login confirmed by server with data:", data);
  if (data && data.position) {
    // Initialize player position with server data
    localPlayer.x = data.position.x;
    localPlayer.y = data.position.y;
    console.log("📍 Player position initialized:", localPlayer);
  }
});