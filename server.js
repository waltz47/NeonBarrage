const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const gameState = {
  players: {},
  bullets: [],
  bots: [],
};

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

let gameWidth = 800;
let gameHeight = 600;

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

  switch(edge) {
    case 0: // top
      x = Math.random() * gameWidth;
      y = 0;
      break;
    case 1: // right
      x = gameWidth;
      y = Math.random() * gameHeight;
      break;
    case 2: // bottom
      x = Math.random() * gameWidth;
      y = gameHeight;
      break;
    case 3: // left
      x = 0;
      y = Math.random() * gameHeight;
      break;
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
        const dy = target.y - target.y;
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

function updateGame() {
  const now = Date.now();

  // Move bullets and clean up
  const grid = {};
  gameState.bullets.forEach((bullet, index) => {
    const key = getGridKey(bullet.x, bullet.y);
    if (!grid[key]) grid[key] = [];
    grid[key].push({ bullet, index });
  });

  for (let i = gameState.bullets.length - 1; i >= 0; i--) {
    const bullet = gameState.bullets[i];
    const speed = bullet.speed || BULLET_SPEED;

    // Only apply homing to player bullets
    if (gameState.players[bullet.owner]) {
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
    bullet.x += Math.cos(bullet.angle) * speed;
    bullet.y += Math.sin(bullet.angle) * speed;

    // Remove if out of bounds
    if (bullet.x < 0 || bullet.x > gameWidth || 
        bullet.y < 0 || bullet.y > gameHeight) {
      gameState.bullets.splice(i, 1);
    }
  }

  // Move bots, shoot, and clean up out-of-bounds
  for (let i = gameState.bots.length - 1; i >= 0; i--) {
    const bot = gameState.bots[i];
    const target = findNearestPlayer(bot);
    if (target) {
      const targetAngle = Math.atan2(target.y - bot.y, target.x - bot.x);
      let desiredAngle = targetAngle;

      const nearbyBots = gameState.bots.filter(
        (b) => b.id !== bot.id && Math.hypot(b.x - bot.x, b.y - bot.y) < BOID_RADIUS
      );

      if (nearbyBots.length > 0) {
        let separationX = 0, separationY = 0;
        let avgAngle = 0;
        let centerX = 0, centerY = 0;
        nearbyBots.forEach((nb) => {
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
        });

        avgAngle /= nearbyBots.length;
        centerX /= nearbyBots.length;
        centerY /= nearbyBots.length;

        const separationAngle = Math.atan2(separationY, separationX);
        const cohesionAngle = Math.atan2(centerY - bot.y, centerX - bot.x);

        const boidsInfluence = (
          separationAngle * SEPARATION_WEIGHT +
          avgAngle * ALIGNMENT_WEIGHT +
          cohesionAngle * COHESION_WEIGHT
        ) / (SEPARATION_WEIGHT + ALIGNMENT_WEIGHT + COHESION_WEIGHT);

        desiredAngle = (desiredAngle * PURSUIT_WEIGHT + boidsInfluence) / (PURSUIT_WEIGHT + 1);
      }

      let angleDiff = desiredAngle - bot.angle;
      if (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      if (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
      bot.angle += Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), TURN_RATE);

      if (Math.abs(angleDiff) < SHOOT_ANGLE && 
          now - bot.lastShot > BOT_FIRE_COOLDOWN && 
          Math.random() < BOT_FIRE_RATE) {
        gameState.bullets.push({
          x: bot.x,
          y: bot.y,
          angle: bot.angle,
          color: "#FF0000",
          owner: bot.id,
        });
        bot.lastShot = now;
      }
    }

    bot.x += Math.cos(bot.angle) * BOT_SPEED;
    bot.y += Math.sin(bot.angle) * BOT_SPEED;
    if (bot.x < 0 || bot.x > gameWidth || bot.y < 0 || bot.y > gameHeight) {
      gameState.bots.splice(i, 1);
    }
  }

  // Bullet vs Bot collision
  for (let i = gameState.bullets.length - 1; i >= 0; i--) {
    const bullet = gameState.bullets[i];
    for (let j = gameState.bots.length - 1; j >= 0; j--) {
      const bot = gameState.bots[j];
      const dx = bot.x - bullet.x;
      const dy = bot.y - bullet.y;
      if (dx * dx + dy * dy < 400) { // Increased from 225 (15^2 -> 20^2)
        if (!gameState.bots.some(b => b.id === bullet.owner)) {
          const botColor = bot.color;
          gameState.bots.splice(j, 1);
          gameState.bullets.splice(i, 1);
          
          // Add score for the player who killed the bot
          if (gameState.players[bullet.owner]) {
            gameState.players[bullet.owner].score++;
          }
          
          io.emit("explosion", { 
            x: bot.x, 
            y: bot.y, 
            color: `${NEON_PALETTE.orange}, ${NEON_PALETTE.red}, ${NEON_PALETTE.yellow}`,
            size: 30
          });
          break;
        }
      }
    }
  }

  // Bullet vs Player collision with invulnerability
  for (const id in gameState.players) {
    const player = gameState.players[id];
    if (player.paused || (player.invulnerableUntil && now < player.invulnerableUntil)) continue;
    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
      const bullet = gameState.bullets[i];
      if (gameState.players[bullet.owner]) continue;
      const dx = player.x - bullet.x;
      const dy = player.y - bullet.y;
      if (dx * dx + dy * dy < 400) { // Increased from 225 to match bot collision size
        io.emit("explosion", { 
          x: player.x, 
          y: player.y, 
          color: `${NEON_PALETTE.blue}, ${NEON_PALETTE.cyan}, ${NEON_PALETTE.purple}`,
          size: 40
        });
        delete gameState.players[id];
        io.to(id).emit("dead");
        gameState.bullets.splice(i, 1);
      }
    }
  }

  // Bullet vs Bullet collision with spatial partitioning
  const playerBullets = [];
  const aiBullets = [];
  gameState.bullets.forEach((bullet, index) => {
    if (gameState.players[bullet.owner]) {
      playerBullets.push({ bullet, index });
    } else {
      aiBullets.push({ bullet, index });
    }
  });

  for (let i = playerBullets.length - 1; i >= 0; i--) {
    const pBullet = playerBullets[i].bullet;
    const pIndex = playerBullets[i].index;
    const gridX = Math.floor(pBullet.x / GRID_SIZE);
    const gridY = Math.floor(pBullet.y / GRID_SIZE);

    // Check current and adjacent grid cells
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = `${gridX + dx},${gridY + dy}`;
        if (!grid[key]) continue;
        for (const { bullet: aBullet, index: aIndex } of grid[key]) {
          if (gameState.players[aBullet.owner]) continue; // Skip if both are player bullets
          const dx = pBullet.x - aBullet.x;
          const dy = pBullet.y - aBullet.y;
          if (dx * dx + dy * dy < 144) { // Increased from 64 (8^2 -> 12^2)
            gameState.bullets.splice(Math.max(pIndex, aIndex), 1);
            gameState.bullets.splice(Math.min(pIndex, aIndex), 1);
            io.emit("explosion", { 
              x: pBullet.x, 
              y: pBullet.y,
              color: `255, 255, 255`, // Revert to simple white explosion
              size: 15
            });
            playerBullets.splice(i, 1);
            aiBullets.splice(aiBullets.findIndex(b => b.index === aIndex), 1);
            break; // Bullet destroyed, move to next
          }
        }
      }
    }
  }

  // Spawn bots with limit (calculate difficulty only when needed)
  if (gameState.bots.length < MAX_BOTS) {
    const currentDifficulty = adjustDifficulty();
    const currentMaxBots = Math.min(
      MAX_BOTS + (currentDifficulty * DIFFICULTY_BOT_INCREMENT), 
      30
    );

    if (gameState.bots.length < currentMaxBots) {
      const players = Object.values(gameState.players);
      // Only calculate average upgrade if we might spawn a bot
      if (Math.random() < BOT_SPAWN_RATE * players.length / 60) {
        const avgUpgradeLevel = players.length > 0 
          ? players.reduce((sum, p) => sum + p.upgrade, 0) / players.length 
          : 0;
        
        const adjustedSpawnRate = (BOT_SPAWN_RATE + (avgUpgradeLevel * BOT_SPAWN_RATE_INCREASE)) 
                                 * (players.length / Math.max(1, currentDifficulty));
        
        if (Math.random() < adjustedSpawnRate) {
          const bot = spawnBot();
          if (bot) gameState.bots.push(bot);
        }
      }
    }
  }

  io.emit("update", gameState);
}

setInterval(updateGame, 1000 / 60); // Restore to 60 FPS

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  const PLAYER_SHOOT_COOLDOWN = 100; // Reduced from 250
  const UPGRADED_SHOOT_COOLDOWN = 50; // Reduced from 150

  socket.on("login", (username) => {
    const colorIndex = Object.keys(gameState.players).length % PLAYER_COLORS.length;
    gameState.players[socket.id] = {
      id: socket.id,
      x: gameWidth / 2,
      y: gameHeight / 2,
      angle: 0,
      username,
      color: PLAYER_COLORS[colorIndex],
      paused: false,
      invulnerableUntil: Date.now() + 5000,
      score: 0,
      lastShot: 0,
      upgrade: 0 // Track upgrade level: 0=normal, 1=fast, 2=double, 3=triple
    };
  });

  socket.on("move", (move) => {
    const player = gameState.players[socket.id];
    if (player && !player.paused) {
      player.x = Math.max(0, Math.min(gameWidth, player.x + move.x));
      player.y = Math.max(0, Math.min(gameHeight, player.y + move.y));
    }
  });

  socket.on("rotate", (angle) => {
    const player = gameState.players[socket.id];
    if (player) player.angle = angle;
  });

  socket.on("shoot", () => {
    const player = gameState.players[socket.id];
    if (!player || player.paused) return;

    const now = Date.now();
    const cooldown = player.upgrade >= 1 ? UPGRADED_SHOOT_COOLDOWN : PLAYER_SHOOT_COOLDOWN;
    if (now - player.lastShot < cooldown) return;

    // Update player's upgrade based on score
    player.upgrade = Math.floor(player.score / 50);

    const createBullet = (angleOffset = 0) => ({
      x: player.x,
      y: player.y,
      angle: player.angle + angleOffset,
      color: player.color,
      owner: player.id,
      speed: PLAYER_BULLET_SPEED
    });

    // Add bullets based on upgrade level
    if (player.upgrade >= 2) { // 100+ kills: triple shot
      gameState.bullets.push(
        createBullet(-0.2),
        createBullet(),
        createBullet(0.2)
      );
    } else if (player.upgrade >= 1) { // 50+ kills: twin shot
      gameState.bullets.push(
        createBullet(-0.1),
        createBullet(0.1)
      );
    } else { // Single shot
      gameState.bullets.push(createBullet());
    }

    player.lastShot = now;
  });

  socket.on("pause", (paused) => {
    const player = gameState.players[socket.id];
    if (player) player.paused = paused;
  });

  socket.on("setDimensions", (dimensions) => {
    gameWidth = dimensions.width;
    gameHeight = dimensions.height;
  });

  socket.on("ping", () => {
    socket.emit("pong");
  });

  socket.on("disconnect", () => {
    delete gameState.players[socket.id];
    console.log("Player disconnected:", socket.id);
    // Decrease difficulty when a player dies/disconnects
    difficultyLevel = Math.max(MIN_DIFFICULTY, difficultyLevel - DIFFICULTY_DECREASE_ON_DEATH);
    adjustDifficulty();
  });
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});