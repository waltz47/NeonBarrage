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
const BULLET_SPEED = 5;
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

let gameWidth = 800;
let gameHeight = 600;

function randomColor() {
  const r = Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  const g = Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  const b = Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function spawnBot() {
  return {
    id: Math.random().toString(36).substr(2, 9),
    x: Math.random() * gameWidth,
    y: 0,
    angle: Math.PI / 2,
    color: randomColor(),
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

function updateGame() {
  const now = Date.now();

  // Move bullets and clean up
  for (let i = gameState.bullets.length - 1; i >= 0; i--) {
    const bullet = gameState.bullets[i];
    bullet.x += Math.cos(bullet.angle) * BULLET_SPEED;
    bullet.y += Math.sin(bullet.angle) * BULLET_SPEED;
    if (bullet.x < 0 || bullet.x > gameWidth || bullet.y < 0 || bullet.y > gameHeight) {
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

      if (Math.abs(angleDiff) < SHOOT_ANGLE && Math.random() < 0.03) {
        gameState.bullets.push({
          x: bot.x,
          y: bot.y,
          angle: bot.angle,
          color: "#FF0000",
          owner: bot.id,
        });
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
      if (dx * dx + dy * dy < 225) {
        if (!gameState.bots.some(b => b.id === bullet.owner)) {
          gameState.bots.splice(j, 1);
          gameState.bullets.splice(i, 1);
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
      if (dx * dx + dy * dy < 225) {
        delete gameState.players[id];
        io.to(id).emit("dead");
        gameState.bullets.splice(i, 1);
      }
    }
  }

  // Bullet vs Bullet collision with spatial partitioning
  const grid = {};
  gameState.bullets.forEach((bullet, index) => {
    const key = getGridKey(bullet.x, bullet.y);
    if (!grid[key]) grid[key] = [];
    grid[key].push({ bullet, index });
  });

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
          if (dx * dx + dy * dy < 36) { // 6^2 (bullet radius 3 + 3)
            gameState.bullets.splice(Math.max(pIndex, aIndex), 1);
            gameState.bullets.splice(Math.min(pIndex, aIndex), 1);
            playerBullets.splice(i, 1);
            aiBullets.splice(aiBullets.findIndex(b => b.index === aIndex), 1);
            break; // Bullet destroyed, move to next
          }
        }
      }
    }
  }

  // Spawn bots with limit
  if (gameState.bots.length < MAX_BOTS && Math.random() < (BOT_SPAWN_RATE * Object.keys(gameState.players).length) / 60) {
    gameState.bots.push(spawnBot());
  }

  io.emit("update", gameState);
}

setInterval(updateGame, 1000 / 60);

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("login", (username) => {
    gameState.players[socket.id] = {
      id: socket.id,
      x: gameWidth / 2,
      y: gameHeight / 2,
      angle: 0,
      username,
      color: "#ADD8E6",
      paused: false,
      invulnerableUntil: Date.now() + 5000,
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
    if (player && !player.paused) {
      gameState.bullets.push({
        x: player.x,
        y: player.y,
        angle: player.angle,
        color: "#FFFFFF",
        owner: player.id,
      });
    }
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
  });
});

server.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});