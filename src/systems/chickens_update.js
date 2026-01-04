import { CFG } from "../config.js";
import { rand } from "../util/rand.js";
import { clamp, norm2 } from "../util/math2d.js";
import { wrapPos, torusDist, torusDistSq, torusDxDy } from "../util/torus.js";
import { 
  startleChicken, 
  triggerPanic, 
  triggerFlee, 
  mutateTemperament, 
  flipTemperament 
} from "./chickens.js";
import { 
  coopCollisionCircles, 
  isInDespawnZone, 
  coopDoorInfo, 
  scheduleRespawn,
  getCoopAvoidanceForce,
  resolveCoopCollision,
  coopBodyContains
} from "./coop.js";
import { findTargetSeed, scatterSeeds } from "./seeds.js";

export function updateChickens(state, dt) {
  const { chickens, respawns, seeds } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;
  const hasAnySeed = seeds.length > 0;

  // Respawns (chickens "come out" of the coop door)
  for (let i = respawns.length - 1; i >= 0; i--) {
    respawns[i].t -= dt;
    if (respawns[i].t <= 0) {
      const entry = respawns[i];
      respawns.splice(i, 1);
      respawnOne(state, entry);
    }
  }

  // Precompute accel so we can add pairwise forces
  const axArr = new Array(chickens.length).fill(0);
  const ayArr = new Array(chickens.length).fill(0);
  const chasingArr = new Array(chickens.length).fill(false);
  const targetSeedArr = new Array(chickens.length).fill(null);
  const panickingArr = new Array(chickens.length).fill(false);
  const fleeingArr = new Array(chickens.length).fill(false);

  // Decide targets (food > panic > wander). Fleeing is computed in a follow-up pass.
  decideTargets(state, dt, axArr, ayArr, chasingArr, targetSeedArr, panickingArr, fleeingArr, hasAnySeed);

  // Pass 2: detect if someone is running toward you (panic mode 3), then flee.
  detectFleeing(state, panickingArr, fleeingArr, chasingArr, hasAnySeed);

  // Apply fleeing targets and recompute chasing flags
  applyFleeing(state, fleeingArr, chasingArr);

  // Temperament timers (only while wandering)
  updateTemperament(state, dt, chasingArr);

  // Socialness + collision avoidance + flocking
  updateSocialForces(state, chasingArr, axArr, ayArr);

  // Temporarily disable new behaviors to fix erratic movement
  // updateNaturalBehaviors(state, dt, chasingArr);
  // updatePersonalityBehaviors(state, dt, chasingArr);
  
  // Main movement
  updateMovement(state, dt, axArr, ayArr, chasingArr, panickingArr, fleeingArr, targetSeedArr);

  // Scatter seeds if many chickens converge
  scatterSeeds(state, dt);

  // Handle startle collisions
  handleStartleCollisions(state, hasAnySeed);
  
  // Check for coop evacuation conditions
  updateCoopEvacuation(state, dt);
}

function updateCoopEvacuation(state, dt) {
  const { chickens } = state;
  
  // Count currently panicked chickens
  let panickedCount = 0;
  for (const chicken of chickens) {
    if (chicken.panicTimer > 0) {
      panickedCount++;
    }
  }
  
  // Trigger evacuation if too many chickens are panicked
  if (panickedCount >= CFG.PANIC_THRESHOLD && !state.coop.evacuated) {
    state.coop.evacuated = true;
    state.coop.evacuationTimer = CFG.COOP_EVACUATION_DURATION;
    
    // Force all chickens to flee away from coop
    const circle = coopCollisionCircles(state);
    for (const chicken of chickens) {
      const dx = chicken.x - circle.centerX;
      const dy = chicken.y - circle.centerY;
      const distance = Math.hypot(dx, dy);
      
      // If chicken is near coop, force it away
      if (distance < circle.outerRadius + 50) {
        const angle = Math.atan2(dy, dx);
        const fleeDistance = 150;
        chicken.fleeX = chicken.x + Math.cos(angle) * fleeDistance;
        chicken.fleeY = chicken.y + Math.sin(angle) * fleeDistance;
        chicken.fleeTimer = 2.0;
        chicken.panicTimer = 0; // Override panic with flee
      }
    }
  }
  
  // Update evacuation timer
  if (state.coop.evacuated) {
    state.coop.evacuationTimer = Math.max(0, state.coop.evacuationTimer - dt);
    
    // Reset evacuation when timer expires
    if (state.coop.evacuationTimer <= 0) {
      state.coop.evacuated = false;
    }
  }
}

function respawnOne(state, entry) {
  const { chickens } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;
  const s = entry.chicken;
  const di = coopDoorInfo(state);
  s.x = wrapPos(di.outX + rand(-10, 10), W);
  s.y = wrapPos(di.outY + rand(-6, 6), H);

  const ang = rand(Math.PI * 0.25, Math.PI * 0.75);
  const sp = rand(120, 260);
  s.vx = Math.cos(ang) * sp + rand(-40, 40);
  s.vy = -Math.abs(Math.sin(ang) * sp) + rand(-30, 10);

  s.tx = wrapPos(s.x + rand(-W * 0.20, W * 0.20), W);
  s.ty = wrapPos(s.y + rand(-H * 0.20, H * 0.20), H);
  s.nextTargetIn = rand(0.25, 1.4) * s.targetTempo;

  s.seedId = null;
  s.noticeTimer = s.noticeDelay;
  s.skidTimer = 0;
  s.peckTimer = 0;
  s.panicTimer = 0;
  s.panicMode = 0;
  s.panicTargetIdx = -1;
  s.panicT = 0;
  s.fleeTimer = 0;
  s.fleeFromIdx = -1;

  // Reset fatigue system after "resting" in coop
  s.fatigue = 0;
  s.restPhase = 'none';
  s.restTimer = 0;

  chickens.push(s);
}

function decideTargets(state, dt, axArr, ayArr, chasingArr, targetSeedArr, panickingArr, fleeingArr, hasAnySeed) {
  const { chickens } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;
  const cx = W * 0.5;
  const cy = H * 0.5;

  for (let i = 0; i < chickens.length; i++) {
    const s = chickens[i];
    if (s.startleCooldown > 0) s.startleCooldown = Math.max(0, s.startleCooldown - dt);
    if (s.peckTimer > 0) s.peckTimer = Math.max(0, s.peckTimer - dt);

    if (Math.random() < CFG.MUTATION_CHANCE_PER_SEC * dt) {
      mutateTemperament(s);
    }

    if (s.panicTimer <= 0 && !hasAnySeed && Math.random() < CFG.PANIC_CHANCE_PER_SEC * dt) {
      triggerPanic(state, s);
    }

    if (s.noticeTimer > 0) s.noticeTimer = Math.max(0, s.noticeTimer - dt);
    if (s.panicTimer > 0) {
      s.panicTimer = Math.max(0, s.panicTimer - dt);
      s.panicT += dt;

      if (s.panicTimer === 0) {
        s.nextTargetIn = 0; // replan immediately after panic
      }
    }
    if (s.fleeTimer > 0) {
      s.fleeTimer = Math.max(0, s.fleeTimer - dt);
    }

    // Update fatigue system
    if (s.restPhase === 'inside' && s.restTimer > 0) {
      s.restTimer = Math.max(0, s.restTimer - dt);
      s.fatigue = Math.max(0, s.fatigue - CFG.FATIGUE_RECOVERY_RATE * dt);
      
      // Done resting
      if (s.restTimer <= 0) {
        s.restPhase = 'none';
        s.fatigue = 0;
        s.nextTargetIn = 0; // immediately choose new target
      }
    }

    // Check if chicken should go to coop (immediate override)
    const tired = (s.panicTimer <= 0 && s.restPhase === 'none' && s.fatigue >= s.maxFatigue * 0.9);
    if (tired || s.restPhase === 'going') {
      // Don't despawn immediately - force chicken to walk to coop
      const circle = coopCollisionCircles(state);
      
      // point just outside the door (below the coop)
      const doorOuterX = circle.centerX;
      const doorOuterY = circle.centerY + circle.outerRadius + 10;

      const M = 24; // bypass margin

      // If we're "behind" coop (above it) and lined up in X, go around a side first.
      if (s.y < circle.centerY - M && Math.abs(s.x - circle.centerX) < circle.outerRadius + M) {
        const leftX = circle.centerX - circle.outerRadius - M;
        const rightX = circle.centerX + circle.outerRadius + M;
        const goRight = (s.x > circle.centerX);
        s.tx = goRight ? rightX : leftX;
        s.ty = circle.centerY; // slide to the side
      } else {
        s.tx = doorOuterX;
        s.ty = doorOuterY;
      }

      s.nextTargetIn = 999; // prevent re-targeting
      s.seedId = null;
      s.restPhase = 'going';
    } else if (!s.isResting && s.panicTimer <= 0 && s.restPhase === 'none') {
      // Accumulate fatigue when active (but not when eating or panicking)
      s.fatigue = Math.min(s.maxFatigue, s.fatigue + CFG.FATIGUE_RATE * dt);
    }

    let targetSeed = null;

    // Only look for seeds if not going to coop
    if (s.restPhase !== 'going' && hasAnySeed && s.noticeTimer <= 0 && s.restPhase === 'none' && s.fatigue < s.maxFatigue * 0.9) {
      targetSeed = findTargetSeed(state, s);
      
      // Set target to seed location
      if (targetSeed) {
        s.tx = targetSeed.x;
        s.ty = targetSeed.landed ? targetSeed.y : targetSeed.groundY;
        s.nextTargetIn = 999; // prevent re-targeting while chasing seed
      }
    }

    const isPanicking = (s.panicTimer > 0);

    if (!targetSeed && !isPanicking && s.restPhase !== 'going') {
      s.seedId = null;
      s.nextTargetIn -= dt;
      if (s.nextTargetIn <= 0) {
        // Check if chicken is tired and should go to coop
        if (s.fatigue >= s.maxFatigue * 0.9 && s.restPhase === 'none') {
          // Go to coop to rest
          const circle = coopCollisionCircles(state);
          s.tx = circle.centerX;
          s.ty = circle.centerY + circle.outerRadius;
          s.nextTargetIn = 999;
          s.restPhase = 'going';
        } else {
          // Normal wandering
          const gx = (rand(-1,1) + rand(-1,1) + rand(-1,1)) / 3;
          const gy = (rand(-1,1) + rand(-1,1) + rand(-1,1)) / 3;
          s.tx = wrapPos(cx + gx * W * s.targetSpread, W);
          s.ty = wrapPos(cy + gy * H * s.targetSpread, H);
          s.nextTargetIn = rand(0.25, 1.9) * s.targetTempo;
        }
      }
    }

    // directed behaviors: seed chase, panic, going-to-coop (flee gets OR'd in later)
    const chasing = !!targetSeed || isPanicking || (s.restPhase === 'going');

    targetSeedArr[i] = targetSeed;
    panickingArr[i] = isPanicking;
    chasingArr[i] = chasing;
  }
}

function detectFleeing(state, panickingArr, fleeingArr, chasingArr, hasAnySeed) {
  const { chickens } = state;

  for (let i = 0; i < chickens.length; i++) {
    const victim = chickens[i];
    if (hasAnySeed) { victim.fleeTimer = 0; continue; }
    if (victim.fleeTimer > 0) continue;

    let bestJ = -1;
    let bestD = Infinity;
    for (let j = 0; j < chickens.length; j++) {
      if (i === j) continue;
      const pursuer = chickens[j];
      if (!(panickingArr[j] && pursuer.panicMode === 3 && pursuer.panicTargetIdx === i)) continue;
      const d = torusDist(pursuer.x, pursuer.y, victim.x, victim.y, state.canvas.W, state.canvas.H);
      if (d < bestD) { bestD = d; bestJ = j; }
    }

    if (bestJ >= 0 && bestD <= CFG.FLEE_DETECT_RADIUS) {
      triggerFlee(state, victim, chickens[bestJ]);
    }
  }
}

function applyFleeing(state, fleeingArr, chasingArr) {
  const { chickens } = state;

  for (let i = 0; i < chickens.length; i++) {
    const s = chickens[i];
    const isFleeing = (s.fleeTimer > 0);
    if (isFleeing) {
      s.tx = s.fleeX;
      s.ty = s.fleeY;
      s.nextTargetIn = 999;
    }
    fleeingArr[i] = isFleeing;
    chasingArr[i] = chasingArr[i] || isFleeing;
  }
}

function updateTemperament(state, dt, chasingArr) {
  const { chickens } = state;

  for (let i = 0; i < chickens.length; i++) {
    const s = chickens[i];
    if (s.temperamentCooldown > 0) s.temperamentCooldown = Math.max(0, s.temperamentCooldown - dt);

    if (!chasingArr[i]) {
      let neighIso = 0;
      let neighCluster = 0;
      for (let j = 0; j < chickens.length; j++) {
        if (i === j) continue;
        const o = chickens[j];
        const d = torusDist(s.x, s.y, o.x, o.y, state.canvas.W, state.canvas.H);
        if (d < CFG.ISOLATED_NEIGHBOR_RADIUS) neighIso++;
        if (d < CFG.CLUSTER_RADIUS) neighCluster++;
      }

      if (neighIso === 0) s.isolatedTime += dt; else s.isolatedTime = 0;
      if (neighCluster >= CFG.CLUSTER_NEIGHBORS) s.clusteredTime += dt; else s.clusteredTime = 0;

      if (s.temperamentCooldown <= 0) {
        if (s.isolatedTime >= CFG.ISOLATED_FOR) {
          flipTemperament(s, 'isolated');
        } else if (s.clusteredTime >= CFG.CLUSTERED_FOR) {
          flipTemperament(s, 'clustered');
        }
      }
    } else {
      s.isolatedTime = 0;
      s.clusteredTime = 0;
    }
  }
}

function updateSocialForces(state, chasingArr, axArr, ayArr) {
  const { chickens } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;

  for (let i = 0; i < chickens.length; i++) {
    for (let j = i + 1; j < chickens.length; j++) {
      const a = chickens[i];
      const b = chickens[j];
      const chasingPair = (chasingArr[i] || chasingArr[j]);

      const v = torusDxDy(a.x, a.y, b.x, b.y, W, H);
      let dx = v.dx;
      let dy = v.dy;
      let dSq = dx * dx + dy * dy;
      if (dSq < 0.00000001) {
        dx = rand(-1,1);
        dy = rand(-1,1);
        dSq = dx * dx + dy * dy;
      }
      const d = Math.sqrt(dSq);
      const nx = dx / d;
      const ny = dy / d;

      // Hard separation
      const sepDistSq = chasingPair ? CFG.SEPARATION_DIST_CHASE * CFG.SEPARATION_DIST_CHASE : CFG.SEPARATION_DIST_WANDER * CFG.SEPARATION_DIST_WANDER;
      const sepDist = Math.sqrt(sepDistSq);
      const sepStrength = chasingPair ? CFG.SEPARATION_STRENGTH_CHASE : CFG.SEPARATION_STRENGTH_WANDER;
      if (dSq < sepDistSq) {
        const push = (sepDist - d) / sepDist;
        const f = sepStrength * push;
        axArr[i] -= nx * f;
        ayArr[i] -= ny * f;
        axArr[j] += nx * f;
        ayArr[j] += ny * f;
        continue;
      }

      // Soft personal space bubble (wandering only)
      const personalSpaceSq = CFG.PERSONAL_SPACE * CFG.PERSONAL_SPACE;
      if (!chasingArr[i] && !chasingArr[j] && dSq < personalSpaceSq) {
        const push = (CFG.PERSONAL_SPACE - d) / CFG.PERSONAL_SPACE;
        const f = CFG.PERSONAL_SPACE_STRENGTH * push;
        axArr[i] -= nx * f;
        ayArr[i] -= ny * f;
        axArr[j] += nx * f;
        ayArr[j] += ny * f;
      }

      // Socialness force (wandering only)
      const socialMinSq = CFG.SOCIAL_MIN * CFG.SOCIAL_MIN;
      const socialRangeSq = CFG.SOCIAL_RANGE * CFG.SOCIAL_RANGE;
      if (!chasingArr[i] && !chasingArr[j] && dSq < socialRangeSq && dSq > socialMinSq) {
        const pairMood = (a.socialness + b.socialness) * 0.5;
        const t = 1.0 - (d - CFG.SOCIAL_MIN) / (CFG.SOCIAL_RANGE - CFG.SOCIAL_MIN);
        const f = CFG.SOCIAL_STRENGTH * pairMood * t;
        axArr[i] += nx * f;
        ayArr[i] += ny * f;
        axArr[j] -= nx * f;
        ayArr[j] -= ny * f;
      }

      // Light boids-like flocking (wandering only)
      const flockRangeSq = CFG.FLOCK_RANGE * CFG.FLOCK_RANGE;
      if (!chasingArr[i] && !chasingArr[j] && dSq < flockRangeSq) {
        // Alignment: nudge velocities toward each other
        const dvx = b.vx - a.vx;
        const dvy = b.vy - a.vy;
        const af = CFG.ALIGN_STRENGTH * 0.8;
        axArr[i] += dvx * af;
        ayArr[i] += dvy * af;
        axArr[j] -= dvx * af;
        ayArr[j] -= dvy * af;

        // Cohesion: tiny pull toward midpoint
        const cf = CFG.COHESION_STRENGTH * (1.0 - d / CFG.FLOCK_RANGE);
        axArr[i] += nx * cf;
        ayArr[i] += ny * cf;
        axArr[j] -= nx * cf;
        ayArr[j] -= ny * cf;
      }
    }
  }
}

function updateNaturalBehaviors(state, dt, chasingArr) {
  const { chickens } = state;
  
  for (let i = 0; i < chickens.length; i++) {
    const s = chickens[i];
    
    // Only apply natural behaviors when not actively chasing or panicking
    if (chasingArr[i] || s.panicTimer > 0 || s.restPhase !== 'none') continue;
    
    // Random direction changes for more organic wandering
    if (Math.random() < CFG.WANDER_CHANGE_CHANCE) {
      s.wanderAngle = rand(0, Math.PI * 2);
    }
    
    // Occasional pauses to "look around"
    if (Math.random() < CFG.RESTLESSNESS && s.pauseTimer <= 0) {
      s.pauseTimer = CFG.PAUSE_DURATION;
      s.wanderAngle = rand(0, Math.PI * 2);
    }
    
    // Update pause timer
    if (s.pauseTimer > 0) {
      s.pauseTimer = Math.max(0, s.pauseTimer - dt);
    }
    
    // Investigate interesting areas (curiosity) - much less frequent
    if (Math.random() < 0.001) { // Reduced from 0.005
      // Pick a random point within curiosity range
      const angle = rand(0, Math.PI * 2);
      const distance = rand(30, 80); // Reduced range
      s.tx = s.x + Math.cos(angle) * distance;
      s.ty = s.y + Math.sin(angle) * distance;
    }
  }
}

function updatePersonalityBehaviors(state, dt, chasingArr) {
  const { chickens } = state;
  
  for (let i = 0; i < chickens.length; i++) {
    const s = chickens[i];
    
    // Only apply personality behaviors when not actively chasing or panicking
    if (chasingArr[i] || s.panicTimer > 0 || s.restPhase !== 'none') continue;
    
    // Personality-based movement modifications
    if (s.personality === 'curious') {
      // Curious chickens explore more and investigate things
      if (Math.random() < 0.002) { // Reduced from 0.008
        // Investigate random nearby point
        const angle = rand(0, Math.PI * 2);
        const distance = rand(20, 80); // Reduced range
        s.tx = s.x + Math.cos(angle) * distance;
        s.ty = s.y + Math.sin(angle) * distance;
      }
      // Slightly faster wandering (reduced)
      s.wander *= 1.03;
      
    } else if (s.personality === 'cautious') {
      // Cautious chickens move more slowly and pause more
      if (Math.random() < 0.005) { // Reduced from 0.015
        s.pauseTimer = CFG.PAUSE_DURATION * 1.2; // Reduced multiplier
      }
      // Slightly slower wandering (reduced)
      s.wander *= 0.95;
      
    } else if (s.personality === 'bold') {
      // Bold chickens move more confidently and take more direct paths
      if (Math.random() < 0.004) { // Reduced from 0.012
        // Make more decisive movements
        const angle = rand(0, Math.PI * 2);
        const distance = rand(40, 100); // Reduced range
        s.tx = s.x + Math.cos(angle) * distance;
        s.ty = s.y + Math.sin(angle) * distance;
      }
      // Slightly faster wandering (reduced)
      s.wander *= 1.05;
    }
    
    // Occasional personality changes (much rarer)
    if (Math.random() < 0.0001) { // Reduced from 0.0005
      const personalities = ['curious', 'cautious', 'bold'];
      s.personality = personalities[Math.floor(Math.random() * personalities.length)];
    }
  }
}

function updateMovement(state, dt, axArr, ayArr, chasingArr, panickingArr, fleeingArr, targetSeedArr) {
  const { chickens } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;
  const cx = W * 0.5;
  const cy = H * 0.5;

  for (let i = chickens.length - 1; i >= 0; i--) {
    const s = chickens[i];
    const targetSeed = targetSeedArr[i];
    const chasing = chasingArr[i];
    const panicking = panickingArr[i];
    const fleeing = fleeingArr[i];

    // Always compute shortest torus vector to target
    const tv = torusDxDy(s.x, s.y, s.tx, s.ty, W, H);
    const dx = tv.dx;
    const dy = tv.dy;
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq);

    // zigzag
    s.zigzagPhase += dt * (s.zigzagFreq * Math.PI * 2) * (0.9 + 0.2 * Math.random());

    // Base accel
    let ax = axArr[i] + rand(-1, 1) * s.wander;
    let ay = ayArr[i] + rand(-1, 1) * s.wander;

    // Add coop avoidance force (but not when going to coop for rest)
    if (s.restPhase !== 'going') {
      const avoidForce = getCoopAvoidanceForce(state, s.x, s.y);
      ax += avoidForce.x;
      ay += avoidForce.y;
    }

    if (s.skidTimer > 0) s.skidTimer = Math.max(0, s.skidTimer - dt);

    // Pecking slows and jitters a bit
    const pecking = s.peckTimer > 0;

    if (chasing) {
      const spSq = s.vx * s.vx + s.vy * s.vy;
      const spNow = Math.sqrt(spSq);

      let speedCap = s.maxSpeed * 1.4;
      if (panicking) speedCap *= CFG.PANIC_SPEED_MULT;
      if (fleeing) speedCap *= CFG.FLEE_SPEED_MULT;
      if (s.restPhase === 'going') speedCap *= 0.8; // tired chickens walk slowly to coop
      const speedCapSq = speedCap * speedCap;

      if (s.skidTimer <= 0 && distSq < CFG.SKID_TRIGGER * CFG.SKID_TRIGGER && spSq > speedCapSq * 0.3025) { // 0.55^2
        s.skidTimer = rand(CFG.SKID_TIME_MIN, CFG.SKID_TIME_MAX);
      }

      const dirx = distSq > 0.000001 ? (dx / dist) : 0;
      const diry = distSq > 0.000001 ? (dy / dist) : 0;
      const px = -diry;
      const py = dirx;
      const zig = Math.sin(s.zigzagPhase);

      const dvx = dirx * speedCap + px * zig * speedCap * CFG.ZIGZAG_AMP_CHASE;
      const dvy = diry * speedCap + py * zig * speedCap * CFG.ZIGZAG_AMP_CHASE;

      const steerMult = (s.skidTimer > 0) ? 0.40 : 1.0;
      ax += (dvx - s.vx) * (CFG.CHASE_VEL_GAIN * s.chaseBoost * steerMult);
      ay += (dvy - s.vy) * (CFG.CHASE_VEL_GAIN * s.chaseBoost * steerMult);

      ax *= 0.40;
      ay *= 0.40;

    } else {
      ax += (dx / Math.max(1, W)) * (s.centerPull * 220);
      ay += (dy / Math.max(1, H)) * (s.centerPull * 220);

      if (distSq > 0.000001) {
        const dirx = dx / dist;
        const diry = dy / dist;
        const px = -diry;
        const py = dirx;
        const zig = Math.sin(s.zigzagPhase);
        ax += px * zig * s.wander * CFG.ZIGZAG_AMP_WANDER;
        ay += py * zig * s.wander * CFG.ZIGZAG_AMP_WANDER;
      }

      if (Math.random() < s.impulseChance * dt) {
        ax += rand(-1, 1) * 240 * s.impulseScale;
        ay += rand(-1, 1) * 240 * s.impulseScale;
      }
    }

    const effectiveDamping = (chasing && s.skidTimer > 0) ? CFG.SKID_DAMPING : s.damping;
    s.vx = (s.vx + ax * dt) * effectiveDamping;
    s.vy = (s.vy + ay * dt) * effectiveDamping;

    if (pecking) {
      s.vx *= CFG.PECK_SLOW;
      s.vy *= CFG.PECK_SLOW;
    }

    const spSq = s.vx * s.vx + s.vy * s.vy;
    let spCap = chasing ? (s.maxSpeed * 1.4) : s.maxSpeed;
    if (panicking) spCap *= CFG.PANIC_SPEED_MULT;
    if (fleeing) spCap *= CFG.FLEE_SPEED_MULT;
    const spCapSq = spCap * spCap;
    if (spSq > spCapSq) {
      const k = spCap / Math.sqrt(spSq);
      s.vx *= k;
      s.vy *= k;
    }

    const prevX = s.x;
    const prevY = s.y;

    s.x = wrapPos(s.x + s.vx * dt, W);
    s.y = wrapPos(s.y + s.vy * dt, H);

    // Proximity-based despawn for chickens going to coop
    if (s.restPhase === 'going') {
      const tv2 = torusDxDy(s.x, s.y, s.tx, s.ty, W, H);
      const distToTargetSq = tv2.dx * tv2.dx + tv2.dy * tv2.dy;
      if (distToTargetSq < 36) { // 6^2
        chickens.splice(i, 1);
        scheduleRespawn(state, s);
        continue;
      }
    }

    // Despawn zone check (backup)
    if (isInDespawnZone(state, s.x, s.y)) {
      chickens.splice(i, 1);
      scheduleRespawn(state, s);
      continue;
    }

    // Coop collision (walls block, doorway is open)
    resolveCoopCollision(state, s);

    // Safety: if chicken ends up inside coop body (should never happen), despawn immediately
    if (coopBodyContains(state, s.x, s.y)) {
      chickens.splice(i, 1);
      scheduleRespawn(state, s);
      continue;
    }

    // Eating + peck animation
    if (targetSeed && targetSeed.landed) {
      const ddSq = torusDistSq(s.x, s.y, targetSeed.x, targetSeed.y, W, H);
      const eatRadiusSq = CFG.EAT_RADIUS * CFG.EAT_RADIUS;
      if (ddSq <= eatRadiusSq) {
        s.peckTimer = CFG.PECK_TIME;
        targetSeed.amount -= (dt / Math.max(0.05, CFG.SEED_EAT_TIME)) * s.eatRate;
        if (targetSeed.amount <= 0) {
          const idx = state.seeds.findIndex(v => v.id === targetSeed.id);
          if (idx >= 0) state.seeds.splice(idx, 1);
          s.seedId = null;
        }
      }
    }
  }
}

function handleStartleCollisions(state, hasAnySeed) {
  const { chickens } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;

  // If a running chicken runs over (or near) another chicken, the other gets startled too.
  for (let i = 0; i < chickens.length; i++) {
    const a = chickens[i];
    const sa = Math.hypot(a.vx, a.vy);
    for (let j = i + 1; j < chickens.length; j++) {
      const b = chickens[j];
      const d = torusDist(a.x, a.y, b.x, b.y, W, H);
      if (d > CFG.STARTLE_COLLISION_DIST) continue;

      const sb = Math.hypot(b.vx, b.vy);
      const aRunning = sa >= CFG.RUN_STARTLE_SPEED;
      const bRunning = sb >= CFG.RUN_STARTLE_SPEED;

      if (aRunning && !bRunning) {
        startleChicken(state, b, hasAnySeed);
      } else if (bRunning && !aRunning) {
        startleChicken(state, a, hasAnySeed);
      } else if (aRunning && bRunning) {
        startleChicken(state, a, hasAnySeed);
        startleChicken(state, b, hasAnySeed);
      }
    }
  }
}
