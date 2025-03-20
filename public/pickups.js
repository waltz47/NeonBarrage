// Pickup system for Neon Barrage
// Handles different types of powerups that spawn when enemies are destroyed

// Make sure window.pickupSystem exists immediately to prevent the fallback system
window.pickupSystem = {
  drawPickups: function(ctx) {
    // Draw each pickup with enhanced visuals
    const currentTime = Date.now();
    
    // Draw pickups
    pickups.forEach(pickup => {
      const pickupType = PICKUP_TYPES[pickup.type] || PICKUP_TYPES.SHIELD;
      const timeAlive = currentTime - pickup.createdAt;
      const timeRemaining = PICKUP_DESPAWN_TIME - timeAlive;
      
      // Animation for new pickups - grow to full size
      if (pickup.scale < 1) {
        pickup.scale = Math.min(1, pickup.scale + 0.08);
      }
      
      // Pulse effect increases as pickup nears despawn time
      pickup.pulsePhase += 0.1;
      const pulseAmount = Math.sin(pickup.pulsePhase) * 0.2;
      
      // Hovering animation
      pickup.hoverOffset += 0.05;
      const hoverY = Math.sin(pickup.hoverOffset) * 3;
      
      // Fade out as it's about to despawn (last second)
      let alpha = 1;
      if (timeRemaining < 1000) {
        alpha = timeRemaining / 1000;
        if (timeRemaining < 500 && Math.sin(timeAlive * 0.02) > 0) {
          alpha *= 0.5;
        }
      }
      
      ctx.save();
      ctx.globalAlpha = alpha;
      
      // Draw pickup with glow effect
      ctx.shadowBlur = pickupType.glow || 15;
      ctx.shadowColor = pickupType.color;
      
      // Draw at pickup location with hover
      ctx.translate(pickup.x, pickup.y + hoverY);
      
      // Draw outer circle
      ctx.beginPath();
      ctx.arc(0, 0, 30, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
      
      // Draw the pickup (core)
      ctx.fillStyle = pickupType.color;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      
      const scaledRadius = pickupType.radius * pickup.scale * (1 + pulseAmount);
      
      switch(pickup.type) {
        case 'SHIELD':
          // Shield - circle with inner ring
          ctx.beginPath();
          ctx.arc(0, 0, scaledRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          
          // Inner ring
          ctx.beginPath();
          ctx.arc(0, 0, scaledRadius * 0.7, 0, Math.PI * 2);
          ctx.stroke();
          break;
          
        case 'AUTO_SHOOTER':
          // Auto-shooter - star shape
          drawStar(ctx, 0, 0, 5, scaledRadius, scaledRadius * 0.5);
          ctx.fill();
          ctx.stroke();
          break;
          
        case 'SPEED_BOOST':
          // Speed boost - lightning bolt
          ctx.beginPath();
          ctx.moveTo(-scaledRadius * 0.5, 0);
          ctx.lineTo(0, -scaledRadius);
          ctx.lineTo(scaledRadius * 0.5, 0);
          ctx.lineTo(0, scaledRadius);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;
        
        default:
          // Default fallback
          ctx.beginPath();
          ctx.arc(0, 0, scaledRadius, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          break;
      }
      
      // Add text label above pickup
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(pickupType.name.toUpperCase(), 0, -35);
      
      ctx.restore();
    });
  },
  checkPickupCollisions: function() {
    // Basic collision detection
    if (!window.gameState || !window.gameState.players || !window.gameState.players[socket.id]) return;
    if (!window.localPlayer) return;
    
    const playerX = window.localPlayer.x;
    const playerY = window.localPlayer.y;
    const collisionRadius = 20; // Reduced collision radius
    
    pickups.forEach(pickup => {
      const dx = pickup.x - playerX;
      const dy = pickup.y - playerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < collisionRadius + (pickup.radius || 15)) {
        socket.emit("collectPickup", { pickupId: pickup.id });
      }
    });
  },
  _isFallback: false,
  _isRealSystem: true,
  debug: function() {
    console.log("PICKUP SYSTEM STATUS:");
    console.log(`- Pickups count: ${pickups.length}`);
    console.log(`- Active effects count: ${Object.keys(activePickups).length}`);
    console.log("- Pickup system working properly");
    console.log("- This is the REAL pickup system");
    return true;
  }
};

// Pickup types and their effects
const PICKUP_TYPES = {
  SHIELD: {
    name: 'shield',
    color: '#00e5ff', // Cyan
    duration: 5000, // 5 seconds
    radius: 15, // REDUCED SIZE
    description: 'Temporary invincibility',
    glow: 20 // REDUCED GLOW
  },
  AUTO_SHOOTER: {
    name: 'autoShooter',
    color: '#ffea00', // Yellow
    duration: 8000, // 8 seconds
    radius: 15, // REDUCED SIZE
    description: 'Auto-targets nearby enemies',
    glow: 15 // REDUCED GLOW
  },
  SPEED_BOOST: {
    name: 'speedBoost',
    color: '#00e676', // Green
    duration: 7000, // 7 seconds
    radius: 15, // REDUCED SIZE
    description: 'Movement speed boost',
    glow: 15 // REDUCED GLOW
  }
};

// Probability of pickup spawning when an enemy is destroyed (30%)
const PICKUP_SPAWN_CHANCE = 0.3;

// Pickup despawn time (5 seconds)
const PICKUP_DESPAWN_TIME = 5000;

// Initialize pickup system
let pickups = [];
let activePickups = {};
// Use window.localPlayer and window.gameState which are already initialized

// Debug function to log pickups array status every 3 seconds
setInterval(() => {
  console.log("%c🔍 PICKUP SYSTEM STATUS CHECK", "background: #333; color: white");
  console.log("Current pickups array length:", pickups.length);
  console.log("Active pickups:", Object.keys(activePickups).length);
  console.log("Local player initialized:", window.localPlayer !== null);
  console.log("Game state initialized:", window.gameState !== null);
  
  if (pickups.length === 0) {
    console.warn("⚠️ Pickups array is empty! This is why the test pickup is showing.");
  } else {
    console.log("Pickups present:", pickups.map(p => ({id: p.id, type: p.type})));
  }
}, 3000);

// Expose activePickups and PICKUP_TYPES to the window object
window.activePickups = activePickups;
window.PICKUP_TYPES = PICKUP_TYPES;
window._debugPickups = () => {
  return {
    pickups: [...pickups],
    activePickups: {...activePickups},
    PICKUP_TYPES
  };
};

// Debug function to spawn a test pickup
window.spawnTestPickup = (x, y) => {
  console.log("🧪 Requesting server to spawn test pickup at:", x, y);
  socket.emit("spawnTestPickup", { x, y });
};

// Debug keyboard listener to spawn pickups with 'P' key
document.addEventListener('keydown', (e) => {
  if (e.key === 'p' && e.ctrlKey) {
    console.log("🧪 Ctrl+P pressed, spawning test pickup");
    // Get mouse position or use center of screen
    const x = window.localPlayer ? window.localPlayer.x : canvas.width / 2;
    const y = window.localPlayer ? window.localPlayer.y : canvas.height / 2;
    window.spawnTestPickup(x, y);
  }
});

// Socket connection should be already available from client.js

// Request pickup from server when an enemy is destroyed
socket.on("botDestroyed", (position) => {
  // Server already handles the random chance of spawning
  // console.log("%c💥 BOT DESTROYED EVENT RECEIVED", "background: red; color: white");
  // console.log("Bot destroyed at:", position);
  
  // Display a visual indicator at the destruction location to confirm the event is firing
  const explosionParticles = 10;
  for (let i = 0; i < explosionParticles; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 2 + 1;
    particles.push({
      x: position.x,
      y: position.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: "ffffff", // White
      life: 30,
      size: Math.random() * 2 + 1,
      alpha: 0.7
    });
  }
});

// Handle new pickup spawned by server
socket.on("pickupSpawned", (pickup) => {
  // console.log("%c⚡ PICKUP SPAWNED EVENT RECEIVED", "background: yellow; color: black");
  // console.log("Pickup data from server:", pickup);
  // console.log("Current pickup array length:", pickups.length);
  
  if (!pickup || pickup.id === undefined) {
    console.error("❌ Invalid pickup data received:", pickup);
    return;
  }
  
  // Check if this pickup already exists to avoid duplicates
  const existingIndex = pickups.findIndex(p => p.id === pickup.id);
  if (existingIndex >= 0) {
    console.warn("⚠️ Duplicate pickup ID detected, ignoring:", pickup.id);
    return;
  }
  
  // Create immediate visual effect at spawn location
  const pickupType = PICKUP_TYPES[pickup.type] || PICKUP_TYPES.SHIELD;
  createPickupSpawnEffect(pickup.x, pickup.y, pickupType.color);
  
  // Create the new pickup object
  const newPickup = {
    id: pickup.id,
    x: pickup.x,
    y: pickup.y,
    type: pickup.type,
    createdAt: Date.now(),
    // For visual effects
    pulsePhase: 0,
    rotation: 0,
    hoverOffset: 0,
    scale: 0.1 // Start small and grow
  };
  
  // Add to array
  pickups.push(newPickup);
  
  console.log("%c✅ Pickup successfully added", "color: green");
  console.log("Current pickups array:", pickups.map(p => ({id: p.id, type: p.type, x: p.x, y: p.y})));
  console.log("Total pickups now:", pickups.length);
});

// Handle pickup collected
socket.on("pickupCollected", (data) => {
  // Remove the collected pickup from local array
  pickups = pickups.filter(p => p.id !== data.pickupId);
  
  // If we collected it, activate the effect
  if (data.playerId === socket.id) {
    activatePickup(data.type);
  }
  
  // Visual effect for pickup collection
  const pickupType = PICKUP_TYPES[data.type] || PICKUP_TYPES.SHIELD;
  createPickupCollectionEffect(data.x, data.y, pickupType.color);
});

// Handle pickup despawned
socket.on("pickupDespawned", (pickupId) => {
  // Find the pickup
  const pickup = pickups.find(p => p.id === pickupId);
  if (pickup) {
    // Create a small "fizzle" effect
    const pickupType = PICKUP_TYPES[pickup.type] || PICKUP_TYPES.SHIELD;
    createPickupFizzleEffect(pickup.x, pickup.y, pickupType.color);
    // Remove from array
    pickups = pickups.filter(p => p.id !== pickupId);
  }
});

// Activate pickup effect based on type
function activatePickup(type) {
  // If we already have this pickup active, just refresh the duration
  if (activePickups[type]) {
    clearTimeout(activePickups[type].timeoutId);
  } else {
    // Apply the initial effect
    applyPickupEffect(type, true);
  }
  
  // Set timeout to remove the effect after duration
  activePickups[type] = {
    activatedAt: Date.now(),
    timeoutId: setTimeout(() => {
      applyPickupEffect(type, false);
      delete activePickups[type];
    }, PICKUP_TYPES[type].duration)
  };
  
  // Show pickup effect notification
  showPickupNotification(type);
}

// Apply the actual effect of the pickup
function applyPickupEffect(type, enable) {
  switch(type) {
    case 'SHIELD':
      // Server handles invulnerability
      // Update local visual effect
      if (enable) {
        console.log("Shield activated!");
      } else {
        console.log("Shield deactivated!");
      }
      break;
      
    case 'AUTO_SHOOTER':
      // Server handles auto shooting
      if (enable) {
        console.log("Auto-shooter activated!");
      } else {
        console.log("Auto-shooter deactivated!");
      }
      break;
      
    case 'SPEED_BOOST':
      // Server will handle the actual speed change
      if (enable) {
        console.log("Speed boost activated!");
      } else {
        console.log("Speed boost deactivated!");
      }
      break;
      
    default:
      console.log(`Unknown pickup type ${type} ${enable ? 'activated' : 'deactivated'}!`);
      break;
  }
  
  // Inform server about pickup activation/deactivation
  socket.emit("pickupEffect", {
    type: type,
    active: enable
  });
}

// Visual effect for pickup collection
function createPickupCollectionEffect(x, y, color) {
  const particleCount = 15;
  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 3 + 2;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: color.replace('#', ''),
      life: 40,
      size: Math.random() * 3 + 2,
      alpha: 1
    });
  }
}

// Visual effect for pickup despawning
function createPickupFizzleEffect(x, y, color) {
  const particleCount = 8;
  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 2 + 1;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: color.replace('#', ''),
      life: 20,
      size: Math.random() * 2 + 1,
      alpha: 0.7
    });
  }
}

// Show pickup notification
function showPickupNotification(type) {
  // This can be enhanced with proper UI later
  const pickupType = PICKUP_TYPES[type] || PICKUP_TYPES.SHIELD;
  console.log(`${pickupType.description} activated!`);
}

// Draw all pickups
function drawPickups(ctx) {
  const currentTime = Date.now();
  
  // console.log("drawPickups called with pickups:", pickups.length);
  
  // Don't show the test pickup if there's already a real pickup in the array
  if (pickups.length === 0) {
    // Log but don't create the test pickup if there's already a real pickup
    // console.warn("⚠️ NO PICKUPS FOUND - Pickup system may not be receiving events from server");
    
    // Only for debugging - comment out for production
    // const testPickup = {
    //   id: "test",
    //   x: canvas.width / 2,
    //   y: canvas.height / 2,
    //   type: "SHIELD",
    //   createdAt: Date.now() - 500,
    //   pulsePhase: 0,
    //   rotation: 0,
    //   hoverOffset: 0,
    //   scale: 1
    // };
    // 
    // // Draw a huge marker for the test pickup
    // ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
    // ctx.beginPath();
    // ctx.arc(testPickup.x, testPickup.y, 150, 0, Math.PI * 2);
    // ctx.fill();
    // 
    // ctx.font = "20px Arial";
    // ctx.fillStyle = "#ffffff";
    // ctx.fillText("TEST PICKUP HERE", testPickup.x - 100, testPickup.y - 100);
  }
  
  // Draw each pickup
  pickups.forEach(pickup => {
    const pickupType = PICKUP_TYPES[pickup.type] || PICKUP_TYPES.SHIELD;
    const timeAlive = currentTime - pickup.createdAt;
    const timeRemaining = PICKUP_DESPAWN_TIME - timeAlive;
    
    // Animation for new pickups - grow to full size
    if (pickup.scale < 1) {
      pickup.scale = Math.min(1, pickup.scale + 0.08);
    }
    
    // Pulse effect increases as pickup nears despawn time
    pickup.pulsePhase += 0.1;
    const pulseAmount = Math.sin(pickup.pulsePhase) * 0.2;
    
    // Hovering animation
    pickup.hoverOffset += 0.05;
    const hoverY = Math.sin(pickup.hoverOffset) * 3;
    
    // Fade out as it's about to despawn (last second)
    let alpha = 1;
    if (timeRemaining < 1000) {
      alpha = timeRemaining / 1000;
      if (timeRemaining < 500 && Math.sin(timeAlive * 0.02) > 0) {
        alpha *= 0.5;
      }
    }
    
    ctx.save();
    ctx.globalAlpha = alpha;
    
    // Draw pickup with glow effect
    ctx.shadowBlur = pickupType.glow || 15;
    ctx.shadowColor = pickupType.color;
    
    // Draw at pickup location with hover
    ctx.translate(pickup.x, pickup.y + hoverY);
    
    // Draw outer circle
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Draw the pickup (core)
    ctx.fillStyle = pickupType.color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    
    const scaledRadius = pickupType.radius * pickup.scale * (1 + pulseAmount);
    
    switch(pickup.type) {
      case 'SHIELD':
        // Shield - circle with inner ring
        ctx.beginPath();
        ctx.arc(0, 0, scaledRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        // Inner ring
        ctx.beginPath();
        ctx.arc(0, 0, scaledRadius * 0.7, 0, Math.PI * 2);
        ctx.stroke();
        break;
        
      case 'AUTO_SHOOTER':
        // Auto-shooter - star shape
        drawStar(ctx, 0, 0, 5, scaledRadius, scaledRadius * 0.5);
        ctx.fill();
        ctx.stroke();
        break;
        
      case 'SPEED_BOOST':
        // Speed boost - lightning bolt
        ctx.beginPath();
        ctx.moveTo(-scaledRadius * 0.5, 0);
        ctx.lineTo(0, -scaledRadius);
        ctx.lineTo(scaledRadius * 0.5, 0);
        ctx.lineTo(0, scaledRadius);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      
      default:
        // Default fallback
        ctx.beginPath();
        ctx.arc(0, 0, scaledRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
    }
    
    // Add text label above pickup
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(pickupType.name.toUpperCase(), 0, -35);
    
    ctx.restore();
  });
  
  // Draw active pickup effects on player
  drawActivePickupEffects(ctx);
}

// Draw active pickup effects on player with enhanced visuals
function drawActivePickupEffects(ctx) {
  // Only draw if we have a player
  if (!window.gameState.players[socket.id]) return;
  
  // Get player coordinates (using smooth local position)
  const playerX = window.localPlayer.x;
  const playerY = window.localPlayer.y;
  
  // Draw effects for each active pickup
  Object.entries(activePickups).forEach(([type, data]) => {
    const pickupType = PICKUP_TYPES[type] || PICKUP_TYPES.SHIELD;
    const timeActive = Date.now() - data.activatedAt;
    const pulsePhase = timeActive * 0.005;
    
    // Calculate remaining time
    const duration = pickupType.duration || 5000;
    const timeRemaining = duration - timeActive;
    const timePercentage = Math.max(0, Math.min(1, timeRemaining / duration));
    
    // Warn when about to expire (last 25%)
    const isWarning = timePercentage < 0.25;
    const warningPulse = isWarning ? Math.abs(Math.sin(timeActive * 0.01)) : 1;
    
    ctx.save();
    
    switch(type) {
      case 'SHIELD':
        // Shield effect - glowing circle around player
        ctx.strokeStyle = pickupType.color;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 10 * warningPulse;
        ctx.shadowColor = pickupType.color;
        
        // Pulsing shield
        const shieldSize = 30 + Math.sin(pulsePhase) * 5;
        ctx.globalAlpha = 0.7 * warningPulse;
        ctx.beginPath();
        ctx.arc(playerX, playerY, shieldSize, 0, Math.PI * 2);
        ctx.stroke();
        
        // Inner shield
        ctx.globalAlpha = 0.3 * warningPulse;
        ctx.fillStyle = pickupType.color;
        ctx.beginPath();
        ctx.arc(playerX, playerY, shieldSize - 10, 0, Math.PI * 2);
        ctx.fill();
        
        // Shield timer arc
        drawTimerArc(ctx, playerX, playerY, shieldSize + 5, timePercentage);
        break;
        
      case 'AUTO_SHOOTER':
        // Auto-shooter - orbiting small turrets
        ctx.fillStyle = pickupType.color;
        ctx.shadowBlur = 5 * warningPulse;
        ctx.shadowColor = pickupType.color;
        
        // Timer arc around player
        drawTimerArc(ctx, playerX, playerY, 45, timePercentage);
        
        // Draw 3 orbiting turrets
        for (let i = 0; i < 3; i++) {
          const angle = pulsePhase + (i * Math.PI * 2 / 3);
          const orbitRadius = 40;
          const orbitX = playerX + Math.cos(angle) * orbitRadius;
          const orbitY = playerY + Math.sin(angle) * orbitRadius;
          
          // Draw turret
          ctx.globalAlpha = 0.8 * warningPulse;
          ctx.beginPath();
          ctx.arc(orbitX, orbitY, 5, 0, Math.PI * 2);
          ctx.fill();
          
          // Draw "barrel" pointing outward
          ctx.strokeStyle = pickupType.color;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(orbitX, orbitY);
          ctx.lineTo(
            orbitX + Math.cos(angle) * 10,
            orbitY + Math.sin(angle) * 10
          );
          ctx.stroke();
          
          // Draw targeting lines randomly
          if (Math.random() < 0.1) {
            ctx.globalAlpha = 0.3 * warningPulse;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(orbitX, orbitY);
            const targetAngle = Math.random() * Math.PI * 2;
            const targetDist = 100 + Math.random() * 200;
            ctx.lineTo(
              orbitX + Math.cos(targetAngle) * targetDist,
              orbitY + Math.sin(targetAngle) * targetDist
            );
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        break;
        
      case 'SPEED_BOOST':
        // Speed boost - trailing particles
        ctx.strokeStyle = pickupType.color;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 5 * warningPulse;
        ctx.shadowColor = pickupType.color;
        
        // Timer arc around player
        drawTimerArc(ctx, playerX, playerY, 45, timePercentage);
        
        // Trailing effect
        const trailLength = 8; // More particles
        for (let i = 0; i < trailLength; i++) {
          const fadeFactor = 1 - (i / trailLength);
          ctx.globalAlpha = fadeFactor * 0.7 * warningPulse;
          
          // We don't have past positions stored, so just fake it with offset
          const trailX = playerX - Math.cos(window.localPlayer.angle) * (i * 7);
          const trailY = playerY - Math.sin(window.localPlayer.angle) * (i * 7);
          
          ctx.beginPath();
          ctx.arc(trailX, trailY, 7 * fadeFactor, 0, Math.PI * 2);
          ctx.stroke();
          
          // Add speed lines
          if (i % 2 === 0) {
            const perpAngle = window.localPlayer.angle + Math.PI/2;
            const lineLength = 15 * fadeFactor;
            
            ctx.beginPath();
            ctx.moveTo(
              trailX + Math.cos(perpAngle) * lineLength,
              trailY + Math.sin(perpAngle) * lineLength
            );
            ctx.lineTo(
              trailX - Math.cos(perpAngle) * lineLength,
              trailY - Math.sin(perpAngle) * lineLength
            );
            ctx.stroke();
          }
        }
        
        // Add periodic "boost" effect
        if (timeActive % 500 < 50) {
          ctx.globalAlpha = 0.5 * warningPulse;
          ctx.beginPath();
          ctx.arc(playerX, playerY, 30, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      
      default:
        // Default fallback for unknown pickup types
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.shadowBlur = 5 * warningPulse;
        ctx.shadowColor = "#ffffff";
        
        // Timer arc
        drawTimerArc(ctx, playerX, playerY, 45, timePercentage);
        
        ctx.beginPath();
        ctx.arc(playerX, playerY, 20, 0, Math.PI * 2);
        ctx.stroke();
        break;
    }
    
    ctx.restore();
  });
}

// Helper function to draw a timer arc around the player
function drawTimerArc(ctx, x, y, radius, percentage) {
  ctx.save();
  
  // Red when < 25% time remaining
  const arcColor = percentage < 0.25 ? '#ff0000' : '#ffffff';
  ctx.strokeStyle = arcColor;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.7;
  
  // Draw background arc
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
  
  // Draw filled arc
  ctx.beginPath();
  ctx.arc(x, y, radius, -Math.PI/2, -Math.PI/2 + percentage * Math.PI * 2);
  ctx.stroke();
  
  ctx.restore();
}

// Helper function to draw a star shape
function drawStar(ctx, cx, cy, spikes, outerRadius, innerRadius) {
  let rot = Math.PI / 2 * 3;
  let x = cx;
  let y = cy;
  let step = Math.PI / spikes;

  ctx.beginPath();
  ctx.moveTo(cx, cy - outerRadius);
  
  for (let i = 0; i < spikes; i++) {
    x = cx + Math.cos(rot) * outerRadius;
    y = cy + Math.sin(rot) * outerRadius;
    ctx.lineTo(x, y);
    rot += step;

    x = cx + Math.cos(rot) * innerRadius;
    y = cy + Math.sin(rot) * innerRadius;
    ctx.lineTo(x, y);
    rot += step;
  }
  
  ctx.lineTo(cx, cy - outerRadius);
  ctx.closePath();
}

// Check for pickup collisions
function checkPickupCollisions() {
  // Directly access the window.gameState and window.localPlayer
  const gameState = window.gameState;
  const localPlayer = window.localPlayer;
  
  if (!gameState || !gameState.players || !gameState.players[socket.id]) {
    // Only log warnings occasionally to reduce spam
    if (Math.random() < 0.01) {
      console.warn("Cannot check collisions - player not found in gameState");
    }
    return;
  }
  
  if (!localPlayer) {
    // Only log warnings occasionally to reduce spam
    if (Math.random() < 0.01) {
      console.warn("Cannot check collisions - localPlayer not defined");
    }
    return;
  }
  
  // Log to confirm all references are valid
  if (Math.random() < 0.005) { // Only log very occasionally
    console.log("💎 PICKUP COLLISION CHECK - REFERENCES OK");
    console.log("gameState:", !!gameState);
    console.log("localPlayer:", !!localPlayer);
    console.log("pickups count:", pickups.length);
    console.log("player position:", localPlayer.x, localPlayer.y);
  }
  
  const playerX = localPlayer.x;
  const playerY = localPlayer.y;
  const collisionRadius = 20; // Reduced collision radius
  
  // Only log on rare frames to avoid console spam
  if (Math.random() < 0.01 && pickups.length > 0) {
    console.log(`Player at ${playerX.toFixed(0)}, ${playerY.toFixed(0)}, Pickups: ${pickups.length}`);
  }
  
  // Check each pickup for collision
  for (let i = 0; i < pickups.length; i++) {
    const pickup = pickups[i];
    const dx = pickup.x - playerX;
    const dy = pickup.y - playerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const pickupType = PICKUP_TYPES[pickup.type] || PICKUP_TYPES.SHIELD;
    const pickupRadius = pickupType.radius || 15;
    
    // Log collision distances rarely to help debug
    if (Math.random() < 0.01) {
      // console.log(`Distance to pickup ${pickup.id}: ${distance.toFixed(0)}, threshold: ${collisionRadius + pickupRadius}`);
    }
    
    if (distance < collisionRadius + pickupRadius) {
      console.log(`💥 PICKUP COLLECTED: ${pickup.id}, type: ${pickup.type}`);
      // console.log(`Distance: ${distance.toFixed(0)}, Threshold: ${collisionRadius + pickupRadius}`);
      
      // Send pickup collection to server
      socket.emit("collectPickup", {
        pickupId: pickup.id
      });
      
      // Create collection effect immediately for better feedback
      createPickupCollectionEffect(pickup.x, pickup.y, pickupType.color);
    }
  }
}

// Export functions for use in game loop
window.pickupSystem = {
  drawPickups: drawPickups,
  checkPickupCollisions: checkPickupCollisions,
  pickups: pickups,
  activePickups: activePickups,
  _isFallback: false,
  _isRealSystem: true,
  // Add debug info for troubleshooting
  debug: function() {
    console.log("PICKUP SYSTEM STATUS:");
    console.log(`- Pickups count: ${pickups.length}`);
    console.log(`- Active effects count: ${Object.keys(activePickups).length}`);
    console.log("- Pickup system working properly");
    console.log("- This is the REAL pickup system");
    return true;
  }
};

// Also expose the functions directly on the window object for debugging
window.drawPickups = drawPickups;
window.checkPickupCollisions = checkPickupCollisions;
window.getPickups = function() {
  console.log("Current pickups:", pickups);
  return pickups;
};

// Visual effect for pickup spawning
function createPickupSpawnEffect(x, y, color) {
  // Create expanding ring
  const ringCount = 2;
  for (let i = 0; i < ringCount; i++) {
    setTimeout(() => {
      particles.push({
        x: x,
        y: y,
        vx: 0,
        vy: 0,
        size: 5,
        growing: true,
        maxSize: 40 + i * 15,
        growSpeed: 1.5,
        color: color.replace('#', ''),
        life: 30,
        alpha: 0.7,
        isRing: true
      });
    }, i * 150);
  }
  
  // Create burst particles
  const particleCount = 20;
  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 2 + 3;
    const size = Math.random() * 3 + 2;
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color: color.replace('#', ''),
      life: 30,
      size: size,
      alpha: 1
    });
  }
} 