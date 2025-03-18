// Process pending game state updates in the game loop
function processUpdates() {
  if (pendingUpdates.length === 0) return;
  
  // Get the most recent update
  gameState = pendingUpdates.pop();
  pendingUpdates = [];
  
  if (gameState.players[socket.id]) {
    const serverPlayer = gameState.players[socket.id];
    
    // Store the server position locally to use for bullet spawning
    serverPlayer.clientX = serverPlayer.x;
    serverPlayer.clientY = serverPlayer.y;
    
    // Calculate the difference between client prediction and server state
    const dx = serverPlayer.x - localPlayer.x;
    const dy = serverPlayer.y - localPlayer.y;
    const distanceSquared = dx * dx + dy * dy;
    
    // Apply smoother lerping based on distance
    if (distanceSquared > 400) { // If very far off (20 units), snap faster
      localPlayer.x += dx * 0.3;
      localPlayer.y += dy * 0.3;
    } else if (distanceSquared > 100) { // Medium correction
      localPlayer.x += dx * 0.15;
      localPlayer.y += dy * 0.15;
    } else if (distanceSquared > 9) { // Small correction, but don't micro-adjust
      localPlayer.x += dx * 0.08;
      localPlayer.y += dy * 0.08;
    }
    // Very small differences (<3 units) are ignored to prevent jitter
  }
}

function updateMovement() {
  if (!gameStarted || gameState.players[socket.id]?.paused) return;
  
  let move = { x: 0, y: 0 };
  if (keys.w) move.y -= 5;
  if (keys.s) move.y += 5;
  if (keys.a) move.x -= 5;
  if (keys.d) move.x += 5;

  if (move.x || move.y) {
    // Apply client-side prediction immediately for smooth movement
    const newX = Math.max(0, Math.min(canvas.width, localPlayer.x + move.x));
    const newY = Math.max(0, Math.min(canvas.height, localPlayer.y + move.y));
    
    // Calculate actual movement delta after boundary checks
    const actualDx = newX - localPlayer.x;
    const actualDy = newY - localPlayer.y;
    
    // Update local position with the actual movement
    localPlayer.x = newX;
    localPlayer.y = newY;
    
    // Throttle sending movement updates to server
    const now = performance.now();
    if (now - lastMoveSent > MOVE_THROTTLE) {
      // Send the accumulated movement since last update
      socket.emit("move", { 
        x: move.x, 
        y: move.y,
        clientX: localPlayer.x,
        clientY: localPlayer.y 
      });
      lastMoveSent = now;
    }
  }
}

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