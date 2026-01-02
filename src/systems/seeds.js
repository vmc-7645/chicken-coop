import { CFG } from "../config.js";
import { rand } from "../util/rand.js";
import { wrapPos, torusDist, torusDxDy } from "../util/torus.js";
import { coopBodyContains, coopDoorInfo, coopCollisionCircles } from "./coop.js";

export function updateSeeds(state, dt) {
  const { seeds } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;

  for (let i = seeds.length - 1; i >= 0; i--) {
    const sd = seeds[i];
    if (!sd.landed) {
      sd.vy += CFG.GRAVITY * dt;
      sd.x = wrapPos(sd.x + sd.vx * dt, W);
      sd.y += sd.vy * dt;

      sd.vx *= 0.995;
      sd.vy *= 0.995;

      // land on local groundY (may be anywhere in [0,H))
      if (sd.y >= sd.groundY) {
        sd.y = sd.groundY;
        sd.vx *= 0.15;
        sd.vy = 0;
        sd.landed = true;
      }
    } else {
      // Landed seeds can slide a bit due to "kicks" (scatter)
      sd.x = wrapPos(sd.x + sd.vx * dt, W);
      sd.y = wrapPos(sd.y + sd.vy * dt, H);
      sd.groundY = sd.y;

      // friction
      const fr = Math.pow(CFG.SEED_FRICTION, dt * 60);
      sd.vx *= fr;
      sd.vy *= fr;
      
      // Remove seeds that get too close to coop
      const circle = coopCollisionCircles(state);
      const dx = sd.x - circle.centerX;
      const dy = sd.y - circle.centerY;
      const distance = Math.hypot(dx, dy);
      
      // Remove seed if it's within the coop radius plus some buffer
      if (distance < circle.outerRadius + 20) {
        seeds.splice(i, 1);
        continue;
      }
    }
  }
}

export function spawnSeed(state, x, y, opts = {}) {
  const { seeds } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;
  
  // Limit to max 100 seeds on screen
  if (seeds.length >= 100) return;
  
  let x0 = wrapPos(x, W);
  let y0 = wrapPos(y, H);

  // If you click inside the coop, drop the seed just outside the door instead.
  if (coopBodyContains(state, x0, y0)) {
    const di = coopDoorInfo(state);
    x0 = wrapPos(di.outX + rand(-18, 18), W);
    y0 = wrapPos(di.outY + rand(18, 60), H);
  }

  // Pick a few cluster centers near the click, grid-aligned
  const centers = [];
  for (let k = 0; k < CFG.SEED_CLUSTERS; k++) {
    const cx = Math.round((x0 + rand(-CFG.SEED_SPREAD, CFG.SEED_SPREAD)) / CFG.SEED_SIZE) * CFG.SEED_SIZE;
    const cy = Math.round((y0 + rand(-CFG.SEED_SPREAD, CFG.SEED_SPREAD)) / CFG.SEED_SIZE) * CFG.SEED_SIZE;
    centers.push({
      x: wrapPos(cx, W),
      y: wrapPos(cy, H)
    });
  }

  for (let i = 0; i < CFG.SEEDS_PER_DROP; i++) {
    const c = centers[Math.floor(Math.random() * centers.length)];
    // triangular-ish distribution around the cluster center, grid-aligned
    const ox = Math.round(((rand(-1, 1) + rand(-1, 1) + rand(-1, 1)) / 3) * CFG.SEED_CLUSTER_RADIUS / CFG.SEED_SIZE) * CFG.SEED_SIZE;
    const oy = Math.round(((rand(-1, 1) + rand(-1, 1) + rand(-1, 1)) / 3) * CFG.SEED_CLUSTER_RADIUS / CFG.SEED_SIZE) * CFG.SEED_SIZE;

    const sx = c.x + ox;
    const groundY = c.y + oy;
    
    // Apply wrap after grid alignment
    const wrappedSx = wrapPos(sx, W);
    const wrappedGroundY = wrapPos(groundY, H);
    
    // Don't allow seeds to spawn on coop tiles
    if (coopBodyContains(state, wrappedSx, wrappedGroundY)) {
      continue; // Skip this seed
    }

    // Start above local ground and fall down to it
    const startY = wrappedGroundY - rand(40, 140);

    seeds.push({
      id: state.nextSeedId++,
      x: wrappedSx,
      y: startY,
      vx: rand(-50, 50),
      vy: rand(-40, 40),
      landed: false,
      amount: 1.0,
      groundY: wrappedGroundY
    });
  }

  // Reset chicken eating states when new seeds are dropped
  for (const s of state.chickens) {
    s.eatState = 0;
    s.eatPauseT = 0;
    s.eatPecksLeft = 0;
    s.eatPeckT = 0;
    s.noticeTimer = s.noticeDelay;
    s.skidTimer = 0;
    s.peckTimer = 0;
    // food overrides panic
    s.panicTimer = 0;
    s.panicMode = 0;
    s.panicTargetIdx = -1;
    s.panicT = 0;
    // food overrides flee
    s.fleeTimer = 0;
    s.fleeFromIdx = -1;
  }
}

export function findTargetSeed(state, chicken) {
  const { seeds } = state;
  
  let targetSeed = null;
  if (chicken.seedId) {
    targetSeed = findSeedById(state, chicken.seedId);
  }
  
  if (!targetSeed) {
    targetSeed = pickNearestSeed(state, chicken.x, chicken.y);
    chicken.seedId = targetSeed ? targetSeed.id : null;
  }
  
  return targetSeed;
}

export function findSeedById(state, id) {
  if (!id) return null;
  for (const sd of state.seeds) {
    if (sd.id === id) return sd;
  }
  return null;
}

export function pickNearestSeed(state, x, y) {
  const { seeds } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;
  
  let best = null;
  let bestD = Infinity;
  for (const sd of seeds) {
    // Anticipation: target where it will land (groundY) while falling
    const sy = sd.landed ? sd.y : sd.groundY;
    const d = torusDist(x, y, sd.x, sy, W, H);
    if (d < bestD) { 
      bestD = d; 
      best = sd; 
    }
  }
  return best;
}

export function scatterSeeds(state, dt) {
  const { seeds, chickens } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;

  // Scatter: if many chickens converge on a seed, some seeds get kicked outward
  if (seeds.length > 0) {
    for (const sd of seeds) {
      if (!sd.landed) continue;
      let cnt = 0;
      let ax = 0, ay = 0;
      for (const ch of chickens) {
        const v = torusDxDy(ch.x, ch.y, sd.x, sd.y, W, H);
        const d = Math.hypot(v.dx, v.dy);
        if (d <= CFG.SCATTER_RADIUS) {
          cnt++;
          // accumulate chicken position relative to seed (to push away from crowd)
          ax += -v.dx;
          ay += -v.dy;
        }
      }
      if (cnt >= CFG.SCATTER_MIN_CHICKENS && Math.random() < CFG.SCATTER_CHANCE_PER_SEC * dt) {
        // Direction: away from crowd centroid; if ambiguous, random
        let nx = ax, ny = ay;
        const mag = Math.hypot(nx, ny);
        if (mag < 0.001) {
          const ang = rand(0, Math.PI * 2);
          nx = Math.cos(ang);
          ny = Math.sin(ang);
        } else {
          nx /= mag;
          ny /= mag;
        }
        const imp = rand(CFG.SCATTER_IMPULSE_MIN, CFG.SCATTER_IMPULSE_MAX) * (0.65 + 0.12 * cnt);
        sd.vx += nx * imp;
        sd.vy += ny * imp;
      }
    }
  }
}
