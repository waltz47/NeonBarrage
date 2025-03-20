const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { PickupSystem } = require("./pickup-server");
const { profiler } = require("./profiler");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

// Add bullet pool at the top with other constants
class BulletPool {
  constructor(initialSize = 1000) {
    this.pool = new Array(initialSize).fill(null).map(() => ({
      x: 0, y: 0, angle: 0, color: '', owner: null, speed: 0,
      active: false, fromAutoShooter: false
    }));
    this.activeCount = 0;
  }

  obtain() {
    // First try to find an inactive bullet
    for (let i = 0; i < this.pool.length; i++) {
      if (!this.pool[i].active) {
        this.pool[i].active = true;
        this.activeCount++;
        return this.pool[i];
      }
    }
    
    // If no inactive bullets, expand the pool
    const newBullet = { x: 0, y: 0, angle: 0, color: '', owner: null, speed: 0, active: true, fromAutoShooter: false };
    this.pool.push(newBullet);
    this.activeCount++;
    return newBullet;
  }

  release(bullet) {
    bullet.active = false;
    this.activeCount--;
  }

  getActiveBullets() {
    return this.pool.filter(b => b.active);
  }
}

// Initialize bullet pool
const bulletPool = new BulletPool();

// Replace gameState.bullets array with bullet pool
const gameState = {
  players: {},
  bullets: bulletPool,
  bots: [],
  frameCount: 0
};

// Initialize pickup system
const pickupSystem = new PickupSystem(io, gameState);

// Make sure pickup system is initialized
console.log("Initializing pickup system");
pickupSystem.init();
console.log("Pickup system initialized successfully");

const BOT_SPAWN_RATE = 2;
const BULLET_SPEED = 5; // Base bullet speed for bots
const PLAYER_BULLET_SPEED = 6.5; // Slightly faster for players
const BOT_SPEED = 2;
const TURN_RATE = 0.1;
const SHOOT_ANGLE = Math.PI / 6;
const MAX_BOTS = 10;
const BOID_RADIUS = 100;
const SEPARATION_WEIGHT = 0.5;
const ALIGNMENT_WEIGHT = 0.3;
const COHESION_WEIGHT = 0.3;
const PURSUIT_WEIGHT = 4.0;
const GRID_SIZE = 50; // Grid cell size for spatial partitioning (adjust based on bullet size)
const DIFFICULTY_INCREASE_INTERVAL = 30000; // 30 seconds
const DIFFICULTY_BOT_INCREMENT = 2;
const BOT_FIRE_RATE = 0.01; // Reduced from 0.03
const BOT_FIRE_COOLDOWN = 1000; // Minimum 1 second between shots
const MIN_SPAWN_DISTANCE = 500; // Increased from 300
const BOT_SPAWN_RATE_INCREASE = 0.5; // Additional spawn rate per player upgrade level
const BULLET_HOMING_STRENGTH = 0.02; // Reduced from 0.04 for even smoother turning
const BULLET_HOMING_RANGE = 800; // Increased from 400 for much longer range detection
const DIFFICULTY_DECREASE_ON_DEATH = 1;
const MIN_DIFFICULTY = 1;
let difficultyLevel = 1;
let gameStartTime = Date.now();

// Use reasonable defaults for game dimensions
let gameWidth = 1024;  // Default to a standard resolution
let gameHeight = 768;

// Add neon color palette
const NEON_PALETTE = {
  red: '#ff1744',
  pink: '#f50057',
  purple: '#d500f9',
  blue: '#2979ff',
  cyan: '#00e5ff',
  green: '#00e676',
  yellow: '#ffea00',
  orange: '#ff9100'
};

// Replace randomColor function
function randomColor() {
  const botColors = [
    "#ff0000", // Red
    "#ff3300", // Orange-Red
    "#ff6600", // Orange
    "#ff9900", // Dark Orange
  ];
  return botColors[Math.floor(Math.random() * botColors.length)];
}

const PLAYER_COLORS = [
  "#00ffff", // Cyan
  "#00ff99", // Spring Green
  "#33ff33", // Lime
  "#99ff00", // Yellow-Green
  "#00ccff", // Sky Blue
  "#0099ff", // Bright Blue
];

function findSafeSpawnPoint() {
  const edge = Math.floor(Math.random() * 4); // 0: top, 1: right, 2: bottom, 3: left
  let x, y;

  // Add a margin to ensure bots are visible when spawning
  const margin = 50;

  switch(edge) {
    case 0: // top
      x = Math.random() * (gameWidth - 2*margin) + margin;
      y = margin;
      break;
    case 1: // right
      x = gameWidth - margin;
      y = Math.random() * (gameHeight - 2*margin) + margin;
      break;
    case 2: // bottom
      x = Math.random() * (gameWidth - 2*margin) + margin;
      y = gameHeight - margin;
      break;
    case 3: // left
      x = margin;
      y = Math.random() * (gameHeight - 2*margin) + margin;
      break;
  }

  // If no players, just return this point
  if (Object.keys(gameState.players).length === 0) {
    return { x, y, angle: Math.atan2(gameHeight/2 - y, gameWidth/2 - x) };
  }

  // Check distance from all players
  for (const id in gameState.players) {
    const player = gameState.players[id];
    const dx = player.x - x;
    const dy = player.y - y;
    if (dx * dx + dy * dy < MIN_SPAWN_DISTANCE * MIN_SPAWN_DISTANCE) {
      return null; // Too close to a player
    }
  }

  return { x, y, angle: Math.atan2(gameHeight/2 - y, gameWidth/2 - x) };
}

function spawnBot() {
  let spawnPoint;
  for (let attempts = 0; attempts < 10; attempts++) {
    spawnPoint = findSafeSpawnPoint();
    if (spawnPoint) break;
  }

  // If no safe point found after attempts, don't spawn
  if (!spawnPoint) return null;

  return {
    id: Math.random().toString(36).substr(2, 9),
    x: spawnPoint.x,
    y: spawnPoint.y,
    angle: spawnPoint.angle,
    color: randomColor(),
    lastShot: 0
  };
}

function findNearestPlayer(bot) {
  let closestPlayer = null;
  let minDist = Infinity;
  for (const id in gameState.players) {
    const player = gameState.players[id];
    if (player.paused) continue;
    const dx = player.x - bot.x;
    const dy = player.y - bot.y;
    const dist = dx * dx + dy * dy;
    if (dist < minDist) {
      minDist = dist;
      closestPlayer = player;
    }
  }
  return closestPlayer;
}

// Spatial grid helper function
function getGridKey(x, y) {
  const gridX = Math.floor(x / GRID_SIZE);
  const gridY = Math.floor(y / GRID_SIZE);
  return `${gridX},${gridY}`;
}

// Add helper function for bullet homing
function findNearestTarget(bullet, grid) {
  const gridX = Math.floor(bullet.x / GRID_SIZE);
  const gridY = Math.floor(bullet.y / GRID_SIZE);
  let nearestDist = BULLET_HOMING_RANGE * BULLET_HOMING_RANGE;
  let nearestTarget = null;

  // Expand grid search radius further
  for (let dx = -3; dx <= 3; dx++) {  // Increased from -2/+2 to -3/+3
    for (let dy = -3; dy <= 3; dy++) {
      const key = `${gridX + dx},${gridY + dy}`;
      if (!grid[key]) continue;

      for (const { bullet: target } of grid[key]) {
        if (target === bullet) continue;
        if (gameState.players[bullet.owner] && gameState.players[target.owner]) continue;
        if (!gameState.players[bullet.owner] && !gameState.players[target.owner]) continue;

        const dx = target.x - bullet.x;
        const dy = target.y - bullet.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < nearestDist) {
          nearestDist = distSq;
          nearestTarget = target;
        }
      }
    }
  }
  return nearestTarget;
}

// Replace the adjustDifficulty function with this optimized version
function adjustDifficulty() {
  const playerCount = Object.keys(gameState.players).length;
  if (playerCount === 0) {
    difficultyLevel = MIN_DIFFICULTY;
    return MIN_DIFFICULTY;
  }

  // Calculate time-based difficulty, cached to avoid frequent calculations
  const timeSinceStart = Date.now() - gameStartTime;
  const timeBasedDifficulty = Math.floor(timeSinceStart / DIFFICULTY_INCREASE_INTERVAL);
  
  // Calculate new difficulty level
  return Math.max(
    MIN_DIFFICULTY,
    Math.min(timeBasedDifficulty, Math.ceil(playerCount * 1.5))
  );
}

// Modify updateGame function to use bullet pool and batch processing
function updateGame() {
  const now = Date.now();

  // Profile bullet collisions
  profiler.startProfile('bullet-collisions');
  
  // Get active bullets
  const activeBullets = bulletPool.getActiveBullets();
  const grid = {};
  
  // Process bullets in batches of 100
  const BATCH_SIZE = 100;
  const totalBatches = Math.ceil(activeBullets.length / BATCH_SIZE);
  
  // Only process one batch per frame, rotating through all batches
  const currentBatch = gameState.frameCount % totalBatches;
  const start = currentBatch * BATCH_SIZE;
  const end = Math.min(start + BATCH_SIZE, activeBullets.length);
  
  // Build grid for current batch
  for (let i = start; i < end; i++) {
    const bullet = activeBullets[i];
    const key = getGridKey(bullet.x, bullet.y);
    if (!grid[key]) grid[key] = [];
    grid[key].push({ bullet, index: i });
  }

  // Process current batch of bullets
  for (let i = start; i < end; i++) {
    const bullet = activeBullets[i];
    const bulletSpeed = bullet.speed || BULLET_SPEED;

    // Only apply homing logic for player bullets and limit its frequency
    if (gameState.players[bullet.owner] && i % 3 === 0) {
      const target = findNearestTarget(bullet, grid);
      
      if (target) {
        const dx = target.x - bullet.x;
        const dy = target.y - bullet.y;
        const desiredAngle = Math.atan2(dy, dx);
        
        let angleDiff = desiredAngle - bullet.angle;
        if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        
        bullet.angle += Math.sign(angleDiff) * 
                       Math.min(Math.abs(angleDiff), BULLET_HOMING_STRENGTH);
      }
    }

    // Move bullet
    bullet.x += Math.cos(bullet.angle) * bulletSpeed;
    bullet.y += Math.sin(bullet.angle) * bulletSpeed;

    // Remove if out of bounds
    if (bullet.x < 0 || bullet.x > gameWidth || 
        bullet.y < 0 || bullet.y > gameHeight) {
      bulletPool.release(bullet);
    }
  }
  profiler.endProfile('bullet-collisions');

  // Profile bullet vs bullet collision
  profiler.startProfile('bullet-bullet-collisions');
  
  // Get player bullets and AI bullets
  const playerBulletsForCollision = bulletPool.getActiveBullets().filter(b => gameState.players[b.owner]);
  const aiBulletsForCollision = bulletPool.getActiveBullets().filter(b => !gameState.players[b.owner]);
  
  // Build grid for AI bullets to optimize collision checks
  const aiBulletGrid = {};
  aiBulletsForCollision.forEach(bullet => {
    const key = getGridKey(bullet.x, bullet.y);
    if (!aiBulletGrid[key]) aiBulletGrid[key] = [];
    aiBulletGrid[key].push(bullet);
  });
  
  // Check player bullets against AI bullets using grid
  for (let i = playerBulletsForCollision.length - 1; i >= 0; i--) {
    const playerBullet = playerBulletsForCollision[i];
    const gridKey = getGridKey(playerBullet.x, playerBullet.y);
    
    // Check nearby grid cells
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const checkKey = `${Math.floor(playerBullet.x / GRID_SIZE) + dx},${Math.floor(playerBullet.y / GRID_SIZE) + dy}`;
        const nearbyAiBullets = aiBulletGrid[checkKey];
        
        if (nearbyAiBullets) {
          for (let j = nearbyAiBullets.length - 1; j >= 0; j--) {
            const aiBullet = nearbyAiBullets[j];
            if (!aiBullet.active) continue;  // Skip if already destroyed
            
            const dx = playerBullet.x - aiBullet.x;
            const dy = playerBullet.y - aiBullet.y;
            const distSquared = dx * dx + dy * dy;
            
            if (distSquared < 100) { // 10^2 for bullet collision radius
              // Release both bullets
              bulletPool.release(playerBullet);
              bulletPool.release(aiBullet);
              
              // Remove AI bullet from grid array
              nearbyAiBullets.splice(j, 1);
              
              // Create explosion effect
              io.emit("explosion", {
                x: (playerBullet.x + aiBullet.x) / 2,
                y: (playerBullet.y + aiBullet.y) / 2,
                color: `${NEON_PALETTE.cyan}, ${NEON_PALETTE.blue}, ${NEON_PALETTE.purple}`,
                size: 15  // Smaller explosion for bullet collisions
              });
              
              break; // Exit inner loop since bullet is destroyed
            }
          }
          
          // If player bullet was destroyed, exit outer loop
          if (!playerBullet.active) break;
        }
      }
      // If player bullet was destroyed, exit outermost loop
      if (!playerBullet.active) break;
    }
  }
  
  profiler.endProfile('bullet-bullet-collisions');

  // Profile AI movement/behavior
  profiler.startProfile('ai-behavior');
  // Move bots, shoot, and clean up out-of-bounds
  const botsToProcess = Math.min(gameState.bots.length, 10);
  const processInterval = Math.max(1, Math.floor(gameState.bots.length / botsToProcess));
  
  for (let i = gameState.bots.length - 1; i >= 0; i -= processInterval) {
    const bot = gameState.bots[i];
    const target = findNearestPlayer(bot);
    if (target) {
      const targetAngle = Math.atan2(target.y - bot.y, target.x - bot.x);
      let desiredAngle = targetAngle;

      // Only apply complex boid behavior for bots that are visible on screen
      const isOnScreen = bot.x >= 0 && bot.x <= gameWidth && bot.y >= 0 && bot.y <= gameHeight;
      
      if (isOnScreen) {
        // Limit the number of nearby bots we check
        const maxNearbyBotsToCheck = 5;
        const nearbyBots = gameState.bots
          .filter((b, idx) => b.id !== bot.id && 
                    Math.hypot(b.x - bot.x, b.y - bot.y) < BOID_RADIUS)
          .slice(0, maxNearbyBotsToCheck);

        if (nearbyBots.length > 0) {
          let separationX = 0, separationY = 0;
          let avgAngle = 0;
          let centerX = 0, centerY = 0;
          
          const nearbyBotsCount = nearbyBots.length;
          for (let j = 0; j < nearbyBotsCount; j++) {
            const nb = nearbyBots[j];
            const dx = bot.x - nb.x;
            const dy = bot.y - nb.y;
            const dist = Math.hypot(dx, dy);
            if (dist > 0) {
              separationX += dx / dist;
              separationY += dy / dist;
            }
            avgAngle += nb.angle;
            centerX += nb.x;
            centerY += nb.y;
          }

          avgAngle /= nearbyBotsCount;
          centerX /= nearbyBotsCount;
          centerY /= nearbyBotsCount;

          const separationAngle = Math.atan2(separationY, separationX);
          const cohesionAngle = Math.atan2(centerY - bot.y, centerX - bot.x);

          const boidsInfluence = (
            separationAngle * SEPARATION_WEIGHT +
            avgAngle * ALIGNMENT_WEIGHT +
            cohesionAngle * COHESION_WEIGHT
          ) / (SEPARATION_WEIGHT + ALIGNMENT_WEIGHT + COHESION_WEIGHT);

          desiredAngle = (desiredAngle * PURSUIT_WEIGHT + boidsInfluence) / (PURSUIT_WEIGHT + 1);
        }
      }

      let angleDiff = desiredAngle - bot.angle;
      if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      bot.angle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), TURN_RATE);

      // Reduced shooting logic checks
      if (isOnScreen && Math.abs(angleDiff) < SHOOT_ANGLE && 
          now - bot.lastShot > BOT_FIRE_COOLDOWN && 
          Math.random() < BOT_FIRE_RATE) {
        const bullet = bulletPool.obtain();
        bullet.x = bot.x;
        bullet.y = bot.y;
        bullet.angle = bot.angle;
        bullet.color = "#FF0000";
        bullet.owner = bot.id;
        bullet.speed = BULLET_SPEED;
        bot.lastShot = now;
      }
    }

    bot.x += Math.cos(bot.angle) * BOT_SPEED;
    bot.y += Math.sin(bot.angle) * BOT_SPEED;
    if (bot.x < -50 || bot.x > gameWidth + 50 || bot.y < -50 || bot.y > gameHeight + 50) {
      gameState.bots.splice(i, 1);
    }
  }
  profiler.endProfile('ai-behavior');

  // Profile bullet vs bot collision
  profiler.startProfile('bullet-bot-collisions');
  const playerBullets = bulletPool.getActiveBullets().filter(b => gameState.players[b.owner]);
  
  for (let i = playerBullets.length - 1; i >= 0; i--) {
    const bullet = playerBullets[i];
    const gridX = Math.floor(bullet.x / GRID_SIZE);
    const gridY = Math.floor(bullet.y / GRID_SIZE);
    
    // Check bots
    for (let j = gameState.bots.length - 1; j >= 0; j--) {
      const bot = gameState.bots[j];
      const dx = bot.x - bullet.x;
      const dy = bot.y - bullet.y;
      const distSquared = dx * dx + dy * dy;
      
      if (distSquared < 400) { // 20^2
        gameState.bots.splice(j, 1);
        bulletPool.release(bullet);
        
        // Add score for the player who killed the bot
        if (gameState.players[bullet.owner]) {
          gameState.players[bullet.owner].score++;
          
          // Try to spawn a pickup when a bot is destroyed
          pickupSystem.trySpawnPickup({ x: bot.x, y: bot.y });
        }
        
        io.emit("explosion", { 
          x: bot.x, 
          y: bot.y, 
          color: `${NEON_PALETTE.orange}, ${NEON_PALETTE.red}, ${NEON_PALETTE.yellow}`,
          size: 30
        });
        io.emit("botDestroyed", { x: bot.x, y: bot.y });
        break;
      }
    }
  }
  profiler.endProfile('bullet-bot-collisions');

  // Profile bullet vs player collision
  profiler.startProfile('bullet-player-collisions');
  const activePlayers = Object.entries(gameState.players)
    .filter(([_, player]) => !(player.paused || (player.invulnerableUntil && now < player.invulnerableUntil)))
    .map(([id, player]) => ({ id, player }));

  // Only check collisions for AI bullets (not player bullets)
  const aiBullets = bulletPool.getActiveBullets().filter(b => !gameState.players[b.owner]);
  
  for (const { id, player } of activePlayers) {
    for (let i = aiBullets.length - 1; i >= 0; i--) {
      const bullet = aiBullets[i];
      const dx = player.x - bullet.x;
      const dy = player.y - bullet.y;
      const distSquared = dx * dx + dy * dy;
      
      if (distSquared < 400) { // 20^2
        io.emit("explosion", { 
          x: player.x, 
          y: player.y, 
          color: `${NEON_PALETTE.blue}, ${NEON_PALETTE.cyan}, ${NEON_PALETTE.purple}`,
          size: 40
        });
        delete gameState.players[id];
        io.to(id).emit("dead");
        
        // Release the bullet
        bulletPool.release(bullet);
        
        // Also remove from our temporary array
        aiBullets.splice(i, 1);
      }
    }
  }
  profiler.endProfile('bullet-player-collisions');

  // Profile AI spawning
  profiler.startProfile('ai-spawning');
  if (gameState.frameCount % 30 === 0) {
    if (gameState.bots.length < MAX_BOTS) {
      const currentDifficulty = adjustDifficulty();
      const currentMaxBots = Math.min(
        MAX_BOTS + (currentDifficulty * DIFFICULTY_BOT_INCREMENT), 
        30
      );

      if (gameState.bots.length < currentMaxBots) {
        const players = Object.values(gameState.players);
        if (players.length > 0) {
          const avgUpgradeLevel = players.reduce((sum, p) => sum + p.upgrade, 0) / players.length;
          const spawnChance = BOT_SPAWN_RATE * (1 + avgUpgradeLevel * BOT_SPAWN_RATE_INCREASE);
          
          if (Math.random() < spawnChance) {
            const bot = spawnBot();
            if (bot) {
              gameState.bots.push(bot);
              // console.log("Bot spawned", bot.id);
            }
          }
        }
      }
    }
  }
  profiler.endProfile('ai-spawning');

  // Increment frame counter and advance profiler frame
  gameState.frameCount = (gameState.frameCount || 0) + 1;
  profiler.nextFrame();

  // Only send updates at 30fps to reduce network traffic
  if (gameState.frameCount % 2 === 0) {
    io.emit("update", gameState);
  }

  // Update pickup system each frame
  pickupSystem.update();
}

// Add profiling output every 5 seconds
setInterval(() => {
  console.log(profiler.formatMetrics());
}, 5000);

// Change server update rate to 60fps, but send updates at 30fps
setInterval(updateGame, 1000 / 60);

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  const PLAYER_SHOOT_COOLDOWN = 100; // Reduced from 250
  const UPGRADED_SHOOT_COOLDOWN = 50; // Reduced from 150

  socket.on("login", (username) => {
    console.log("Login event received with username:", username);
    const colorIndex = Object.keys(gameState.players).length % PLAYER_COLORS.length;
    
    // Set initial player position
    const initialX = gameWidth / 2;
    const initialY = gameHeight / 2;
    
    gameState.players[socket.id] = {
      id: socket.id,
      x: initialX,
      y: initialY,
      angle: 0,
      username,
      color: PLAYER_COLORS[colorIndex],
      paused: false,
      invulnerableUntil: Date.now() + 5000,
      score: 0,
      lastShot: 0,
      upgrade: 0, // Track upgrade level: 0=normal, 1=fast, 2=double, 3=triple
      activePickups: {} // Add activePickups to player state
    };
    
    // Send confirmation with initial position
    socket.emit("login-confirm", {
      position: { x: initialX, y: initialY },
      color: PLAYER_COLORS[colorIndex]
    });
    console.log("Login-confirm event emitted with position and color:", { x: initialX, y: initialY }, PLAYER_COLORS[colorIndex]);
  });

  socket.on("move", (move) => {
    const player = gameState.players[socket.id];
    if (player && !player.paused) {
      // Apply server movement with smoothing
      // For small movements, trust client more for responsiveness
      let moveX = move.x;
      let moveY = move.y;
      
      // Apply standard server movement with bounds checking
      const newX = Math.max(0, Math.min(gameWidth, player.x + moveX));
      const newY = Math.max(0, Math.min(gameHeight, player.y + moveY));
      
      // Update server position
      player.x = newX;
      player.y = newY;
      
      // If client also sent its position, we can use it for additional validation
      if (move.clientX !== undefined && move.clientY !== undefined) {
        // Check if client position is within reasonable bounds
        const dx = move.clientX - player.x;
        const dy = move.clientY - player.y;
        const distSquared = dx * dx + dy * dy;
        
        // Only send corrections for significant discrepancies
        // If client position is too far off from server position (could be cheating or severe lag)
        if (distSquared > 10000) { // Increased threshold to reduce teleporting
          // Force client to reconcile with a direct position update
          socket.emit("position-correction", { x: player.x, y: player.y });
        } else if (distSquared > 1024) { // Medium adjustment for moderate discrepancies
          // Apply stronger server adjustment to client position
          // but also adapt server position slightly to reduce perceived lag
          player.x += dx * 0.05; // Server moves 5% toward client position
          player.y += dy * 0.05;
          
          // Only send correction if still significantly off after adjustment
          if (distSquared > 2500) {
            socket.emit("position-correction", { x: player.x, y: player.y });
          }
        } else {
          // For small discrepancies, subtly adjust server toward client for better feel
          player.x += dx * 0.1;
          player.y += dy * 0.1;
        }
      }
    }
  });

  socket.on("rotate", (angle) => {
    const player = gameState.players[socket.id];
    if (player) player.angle = angle;
  });

  socket.on("shoot", (data) => {
    const player = gameState.players[socket.id];
    if (!player || player.paused) return;

    const now = Date.now();
    const cooldown = player.upgrade >= 1 ? UPGRADED_SHOOT_COOLDOWN : PLAYER_SHOOT_COOLDOWN;
    if (now - player.lastShot < cooldown) return;

    player.upgrade = Math.floor(player.score / 50);

    let shootX = player.x;
    let shootY = player.y;
    let shootAngle = player.angle;
    
    if (data && typeof data === 'object') {
      if (data.clientX !== undefined && data.clientY !== undefined) {
        const dx = data.clientX - player.x;
        const dy = data.clientY - player.y;
        const distSquared = dx * dx + dy * dy;
        
        if (distSquared < 2500) {
          shootX = data.clientX;
          shootY = data.clientY;
        }
      }
      
      if (data.angle !== undefined) {
        shootAngle = data.angle;
      }
    }

    const createBullet = (angleOffset = 0) => {
      const bullet = bulletPool.obtain();
      bullet.x = shootX;
      bullet.y = shootY;
      bullet.angle = shootAngle + angleOffset;
      bullet.color = player.color;
      bullet.owner = player.id;
      bullet.speed = PLAYER_BULLET_SPEED;
      return bullet;
    };

    if (player.upgrade >= 2) {
      createBullet(-0.2);
      createBullet();
      createBullet(0.2);
    } else if (player.upgrade >= 1) {
      createBullet(-0.1);
      createBullet(0.1);
    } else {
      createBullet();
    }

    player.lastShot = now;
  });

  socket.on("pause", (paused) => {
    const player = gameState.players[socket.id];
    if (player) player.paused = paused;
  });

  socket.on("setDimensions", (dimensions) => {
    // Ensure we have valid dimensions before updating
    if (dimensions && dimensions.width && dimensions.height) {
      if (dimensions.width > 0 && dimensions.height > 0) {
        console.log("Setting game dimensions:", dimensions);
        gameWidth = dimensions.width;
        gameHeight = dimensions.height;
      }
    }
  });

  socket.on("ping", () => {
    socket.emit("pong");
  });

  socket.on("collectPickup", (data) => {
    if (data.pickupId) {
      pickupSystem.collectPickup(socket.id, data.pickupId);
    }
  });

  socket.on("pickupEffect", (data) => {
    // This is mostly for synchronization and feedback
    // The server is the authority on active effects
    if (!data.type) return;
    
    const player = gameState.players[socket.id];
    if (!player) return;
    
    // Most effect logic is handled in the pickupSystem
    // This just acknowledges the client's notification
    console.log(`Player ${player.username} ${data.active ? 'activated' : 'deactivated'} ${data.type}`);
  });

  socket.on("disconnect", () => {
    delete gameState.players[socket.id];
    console.log("Player disconnected:", socket.id);
    // Decrease difficulty when a player dies/disconnects
    difficultyLevel = Math.max(MIN_DIFFICULTY, difficultyLevel - DIFFICULTY_DECREASE_ON_DEATH);
    adjustDifficulty();
    pickupSystem.cleanupPlayer(socket.id);
  });

  // Special debug commands
  socket.on("spawnTestPickup", (position) => {
    // console.log("🧪 DEBUG: Manual test pickup spawn requested", position);
    // Force spawn a pickup (bypass random check)
    if (!position || typeof position.x === 'undefined') {
      // Default to center if no position provided
      position = { x: gameWidth / 2, y: gameHeight / 2 };
    }
    const pickup = pickupSystem.spawnPickup(position);
    // console.log("🧪 DEBUG: Test pickup spawned", pickup);
  });
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});