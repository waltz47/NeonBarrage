// Server-side pickup system for Neon Barrage
// Handles spawning, collecting, and applying effects of pickups

const { profiler } = require('./profiler');

// Pickup types
const PICKUP_TYPES = {
  SHIELD: 'SHIELD',
  AUTO_SHOOTER: 'AUTO_SHOOTER',
  SPEED_BOOST: 'SPEED_BOOST'
};

// Probability of pickup spawning when an enemy is destroyed (100% for testing)
const PICKUP_SPAWN_CHANCE = 0.2;

// Pickup despawn time (5 seconds)
const PICKUP_DESPAWN_TIME = 5000;

// Effect durations (in milliseconds)
const EFFECT_DURATIONS = {
  [PICKUP_TYPES.SHIELD]: 5000,
  [PICKUP_TYPES.AUTO_SHOOTER]: 8000,
  [PICKUP_TYPES.SPEED_BOOST]: 7000
};

// Speed boost multiplier
const SPEED_BOOST_MULTIPLIER = 1.5;

// Auto-shooter settings
const AUTO_SHOOTER_RANGE = 400; // Range to detect enemies
const AUTO_SHOOTER_COOLDOWN = 200; // Reduced from 500ms to 200ms for faster firing
const AUTO_SHOOTER_SPEED = 6; // Bullet speed for auto-shooter

class PickupSystem {
  constructor(io, gameState) {
    this.io = io;
    this.gameState = gameState;
    this.pickups = [];
    this.playerEffects = {}; // Track active effects for each player
    
    // Store reference to setTimeout ids for cleanup
    this.despawnTimers = {};
    this.effectTimers = {};
  }

  // Initialize system
  init() {
    // Nothing special needed for initialization
  }
  
  // Try to spawn a pickup when a bot is destroyed
  trySpawnPickup(position) {
    profiler.startProfile('pickup-spawn');
    // console.log("⭐ ATTEMPTING TO SPAWN PICKUP AT:", position);
    // console.log("PICKUP_SPAWN_CHANCE:", PICKUP_SPAWN_CHANCE);
    const shouldSpawn = Math.random() < PICKUP_SPAWN_CHANCE;
    // console.log("Random roll result:", shouldSpawn);
    
    let result = false;
    if (shouldSpawn) {
      const pickup = this.spawnPickup(position);
      // console.log("✅ PICKUP SPAWNED SUCCESSFULLY:", pickup);
      result = true;
    } else {
      // console.log("❌ PICKUP SPAWN FAILED - Random check failed");
    }
    profiler.endProfile('pickup-spawn');
    return result;
  }
  
  // Spawn a pickup at the given position
  spawnPickup(position) {
    // Randomly select pickup type
    const pickupTypes = Object.values(PICKUP_TYPES);
    const type = pickupTypes[Math.floor(Math.random() * pickupTypes.length)];
    // console.log("Selected pickup type:", type);
    
    // Create pickup with unique ID
    const pickup = {
      id: Math.random().toString(36).substr(2, 9),
      x: position.x,
      y: position.y,
      type: type,
      createdAt: Date.now()
    };
    
    // Add to pickups array
    this.pickups.push(pickup);
    // console.log("Total pickups in system:", this.pickups.length);
    
    // Set despawn timer
    this.despawnTimers[pickup.id] = setTimeout(() => {
      this.despawnPickup(pickup.id);
    }, PICKUP_DESPAWN_TIME);
    
    // Broadcast to clients
    // console.log("📢 EMITTING PICKUP_SPAWNED EVENT:", pickup);
    this.io.emit('pickupSpawned', pickup);
    
    return pickup;
  }
  
  // Despawn a pickup
  despawnPickup(pickupId) {
    // Find the pickup
    const pickupIndex = this.pickups.findIndex(p => p.id === pickupId);
    if (pickupIndex !== -1) {
      // Remove from array
      this.pickups.splice(pickupIndex, 1);
      
      // Clear the despawn timer
      clearTimeout(this.despawnTimers[pickupId]);
      delete this.despawnTimers[pickupId];
      
      // Broadcast to clients
      this.io.emit('pickupDespawned', pickupId);
    }
  }
  
  // Handle player collecting a pickup
  collectPickup(playerId, pickupId) {
    // Find the pickup
    const pickup = this.pickups.find(p => p.id === pickupId);
    if (!pickup) return false;
    
    // Make sure player exists
    if (!this.gameState.players[playerId]) return false;
    
    // Apply effect
    this.applyPickupEffect(playerId, pickup.type);
    
    // Broadcast collection to all clients
    this.io.emit('pickupCollected', {
      pickupId: pickup.id,
      playerId: playerId,
      type: pickup.type,
      x: pickup.x,
      y: pickup.y
    });
    
    // Remove pickup
    this.despawnPickup(pickup.id);
    
    return true;
  }
  
  // Apply pickup effect to player
  applyPickupEffect(playerId, type) {
    // Initialize effects object for this player if it doesn't exist
    if (!this.playerEffects[playerId]) {
      this.playerEffects[playerId] = {};
    }
    
    // If effect is already active, clear the timeout
    if (this.playerEffects[playerId][type]) {
      clearTimeout(this.effectTimers[`${playerId}-${type}`]);
    }
    
    // Apply the effect
    const player = this.gameState.players[playerId];
    if (!player) return false;

    // Initialize player's activePickups if needed
    if (!player.activePickups) {
      player.activePickups = {};
    }
    
    // Update player's activePickups state
    player.activePickups[type] = {
      activatedAt: Date.now(),
      duration: EFFECT_DURATIONS[type]
    };
    
    switch (type) {
      case PICKUP_TYPES.SHIELD:
        player.invulnerableUntil = Date.now() + EFFECT_DURATIONS[type];
        break;
        
      case PICKUP_TYPES.AUTO_SHOOTER:
        this.playerEffects[playerId][type] = {
          active: true,
          lastShot: 0
        };
        break;
        
      case PICKUP_TYPES.SPEED_BOOST:
        // Store original speed if not already stored
        if (!this.playerEffects[playerId][type] || 
            !this.playerEffects[playerId][type].originalSpeed) {
          this.playerEffects[playerId][type] = {
            originalSpeed: player.speed || 5
          };
        }
        
        // Apply speed boost
        player.speed = this.playerEffects[playerId][type].originalSpeed * SPEED_BOOST_MULTIPLIER;
        break;
    }
    
    // Set timeout to remove the effect
    this.effectTimers[`${playerId}-${type}`] = setTimeout(() => {
      this.removePickupEffect(playerId, type);
    }, EFFECT_DURATIONS[type]);
    
    return true;
  }
  
  // Remove pickup effect from player
  removePickupEffect(playerId, type) {
    // Make sure player exists
    const player = this.gameState.players[playerId];
    if (!player) {
      // Clean up if player left
      delete this.playerEffects[playerId];
      return false;
    }
    
    // Remove effect based on type
    switch (type) {
      case PICKUP_TYPES.SHIELD:
        // Remove invulnerability
        delete player.invulnerableUntil;
        break;
        
      case PICKUP_TYPES.AUTO_SHOOTER:
        // Just mark as inactive, actual cleanup happens in update
        if (this.playerEffects[playerId][type]) {
          this.playerEffects[playerId][type].active = false;
        }
        break;
        
      case PICKUP_TYPES.SPEED_BOOST:
        // Restore original speed
        if (this.playerEffects[playerId][type]) {
          player.speed = this.playerEffects[playerId][type].originalSpeed;
        }
        break;
    }
    
    // Remove effect from player's activePickups
    if (player.activePickups) {
      delete player.activePickups[type];
    }
    
    // Remove effect from tracking
    if (this.playerEffects[playerId]) {
      delete this.playerEffects[playerId][type];
      
      // Clean up player entry if no effects left
      if (Object.keys(this.playerEffects[playerId]).length === 0) {
        delete this.playerEffects[playerId];
      }
    }
    
    // Clear timer reference
    delete this.effectTimers[`${playerId}-${type}`];
    
    // Notify client that effect has ended
    this.io.to(playerId).emit('pickupEffectEnded', { type });
    
    return true;
  }
  
  // Process auto-shooter for all players
  processAutoShooters() {
    profiler.startProfile('pickup-auto-shooter');
    const now = Date.now();
    
    Object.entries(this.playerEffects).forEach(([playerId, effects]) => {
      // Skip if player doesn't exist
      if (!this.gameState.players[playerId]) return;
      
      // Process auto-shooter effect
      const autoShooter = effects[PICKUP_TYPES.AUTO_SHOOTER];
      if (autoShooter && autoShooter.active) {
        // Check cooldown
        if (now - autoShooter.lastShot > AUTO_SHOOTER_COOLDOWN) {
          // Find closest bot
          const player = this.gameState.players[playerId];
          let closestBot = null;
          let closestDistance = AUTO_SHOOTER_RANGE * AUTO_SHOOTER_RANGE;
          
          for (const bot of this.gameState.bots) {
            const dx = bot.x - player.x;
            const dy = bot.y - player.y;
            const distSquared = dx * dx + dy * dy;
            
            if (distSquared < closestDistance) {
              closestDistance = distSquared;
              closestBot = bot;
            }
          }
          
          // Fire at closest bot if found
          if (closestBot) {
            const angle = Math.atan2(
              closestBot.y - player.y,
              closestBot.x - player.x
            );
            
            // Create bullet using bullet pool
            const bullet = this.gameState.bullets.obtain();
            bullet.x = player.x;
            bullet.y = player.y;
            bullet.angle = angle;
            bullet.color = '#ffea00'; // Yellow for auto-shooter bullets
            bullet.owner = playerId;
            bullet.fromAutoShooter = true;
            bullet.speed = AUTO_SHOOTER_SPEED;
            
            // Update last shot time
            autoShooter.lastShot = now;
            
            // Visual feedback to client
            this.io.emit('autoShot', {
              playerId,
              x: player.x,
              y: player.y,
              targetX: closestBot.x,
              targetY: closestBot.y
            });
          }
        }
      }
    });
    profiler.endProfile('pickup-auto-shooter');
  }
  
  // Update function called each game tick
  update() {
    profiler.startProfile('pickup-system-update');
    // Process auto-shooters
    this.processAutoShooters();
    
    // Check for any collisions
    this.checkCollisions();
    profiler.endProfile('pickup-system-update');
  }
  
  // Check for collisions between players and pickups
  checkCollisions() {
    // This is handled client-side to reduce latency
    // Clients send collectPickup event when they detect collision
  }
  
  // Cleanup for a player who disconnected
  cleanupPlayer(playerId) {
    // Remove all effects for this player
    if (this.playerEffects[playerId]) {
      // Clear all timers
      Object.keys(PICKUP_TYPES).forEach(type => {
        const timerId = this.effectTimers[`${playerId}-${type}`];
        if (timerId) {
          clearTimeout(timerId);
          delete this.effectTimers[`${playerId}-${type}`];
        }
      });
      
      // Remove player from effects tracking
      delete this.playerEffects[playerId];
    }
  }
  
  // Cleanup all resources
  cleanup() {
    // Clear all despawn timers
    Object.values(this.despawnTimers).forEach(timer => {
      clearTimeout(timer);
    });
    
    // Clear all effect timers
    Object.values(this.effectTimers).forEach(timer => {
      clearTimeout(timer);
    });
    
    // Reset data structures
    this.pickups = [];
    this.despawnTimers = {};
    this.effectTimers = {};
    this.playerEffects = {};
  }
}

module.exports = {
  PickupSystem,
  PICKUP_TYPES
}; 