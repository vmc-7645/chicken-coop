import { CFG } from "../config.js";
import { clamp } from "../util/math2d.js";
import { torusDxDy, torusDist } from "../util/torus.js";
import { rand } from "../util/rand.js";

export function placeCoop(state) {
  const { coop } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;
  
  // Small square coop, kept away from edges.
  const base = Math.min(CFG.COOP_SIZE, Math.max(84, Math.min(W, H) * 0.14));
  coop.w = base;
  coop.h = base;
  coop.wall = clamp(CFG.COOP_WALL, 6, 12);
  coop.doorW = Math.min(CFG.COOP_DOOR_W, coop.w * 0.46);
  coop.doorDepth = Math.min(CFG.COOP_DOOR_DEPTH, coop.wall + 10);
  coop.x = W * 0.62;
  coop.y = H * 0.33;
  const pad = 18 + coop.w * 0.5;
  coop.x = clamp(coop.x, pad, W - pad);
  coop.y = clamp(coop.y, pad, H - pad);
}

export function coopCollisionCircles(state) {
  const { coop } = state;
  const radius = coop.w * 0.5; // Use width as the radius for a circular coop
  const wallThickness = coop.wall;
  const innerRadius = radius - wallThickness;
  
  return { 
    centerX: coop.x, 
    centerY: coop.y, 
    outerRadius: radius, 
    innerRadius: innerRadius,
    wallThickness: wallThickness,
    doorAngle: Math.PI * 0.5, // Door at bottom (90 degrees)
    doorAngleWidth: coop.doorW / radius // Angular width of doorway
  };
}

export function coopWallRects(state) {
  // For circular coop, this returns the collision circles
  return coopCollisionCircles(state);
}

export function resolveCoopCollision(state, chicken) {
  const { coop } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;
  const r = chicken.size * 0.5;
  const circle = coopCollisionCircles(state);
  let x = chicken.x, y = chicken.y;

  
  for (let k = 0; k < 3; k++) {
    // Check if chicken is inside the outer circle (coop boundary)
    const dx = x - circle.centerX;
    const dy = y - circle.centerY;
    const dist = Math.hypot(dx, dy);
    
    // If outside the outer boundary, wrap around (toroidal world)
    if (dist > circle.outerRadius + r) {
      x = x % W;
      if (x < 0) x += W;
      y = y % H;
      if (y < 0) y += H;
      break;
    }
    
    // Check collision with circular walls (between inner and outer radius)
    if (dist < circle.outerRadius - r && dist > circle.innerRadius + r) {
      // Check if chicken is at the door opening
      const angle = Math.atan2(dy, dx);
      let doorAngle = circle.doorAngle;
      let normalizedAngle = angle;
      
      // Normalize angle to be in same range as door
      while (normalizedAngle < doorAngle - circle.doorAngleWidth * 0.5) normalizedAngle += Math.PI * 2;
      while (normalizedAngle > doorAngle + circle.doorAngleWidth * 0.5) normalizedAngle -= Math.PI * 2;
      
      // If not in door opening, treat as wall collision
      if (Math.abs(normalizedAngle - doorAngle) > circle.doorAngleWidth * 0.5) {
        // Push chicken away from wall center
        const pushDist = dist < (circle.outerRadius + circle.innerRadius) * 0.5 ? 
          circle.innerRadius + r + CFG.COOP_PAD : 
          circle.outerRadius - r - CFG.COOP_PAD;
        const nx = dx / dist;
        const ny = dy / dist;
        x = circle.centerX + nx * pushDist;
        y = circle.centerY + ny * pushDist;
        
        // Dampen velocity on collision
        chicken.vx *= 0.82;
        chicken.vy *= 0.82;
      }
    }
    
    // If inside inner radius (in coop), push out through door
    if (dist < circle.innerRadius - r) {
      const nx = dx / dist;
      const ny = dy / dist;
      x = circle.centerX + nx * (circle.innerRadius + r + CFG.COOP_PAD);
      y = circle.centerY + ny * (circle.innerRadius + r + CFG.COOP_PAD);
      
      chicken.vx *= 0.82;
      chicken.vy *= 0.82;
    }
  }

  chicken.x = chicken.x % W;
  if (chicken.x < 0) chicken.x += W;
  chicken.y = chicken.y % H;
  if (chicken.y < 0) chicken.y += H;
}

export function isInDespawnZone(state, x, y) {
  const circle = coopCollisionCircles(state);
  const doorX = circle.centerX;
  const doorY = circle.centerY + circle.outerRadius;
  const W = state.canvas.width;
  const H = state.canvas.height;
  const v = torusDxDy(x, y, doorX, doorY, W, H);
  return Math.hypot(v.dx, v.dy) < CFG.DESPAWN_RADIUS;
}

export function isInSpawnZone(state, x, y) {
  const circle = coopCollisionCircles(state);
  const dx = x - circle.centerX;
  const dy = y - (circle.centerY + circle.outerRadius + CFG.ZONE_SPACING);
  return Math.hypot(dx, dy) < CFG.SPAWN_RADIUS;
}

export function coopBodyContains(state, x, y) {
  const circle = coopCollisionCircles(state);
  const dx = x - circle.centerX;
  const dy = y - circle.centerY;
  const dist = Math.hypot(dx, dy);
  return dist < circle.innerRadius;
}

export function coopDoorInfo(state) {
  const circle = coopCollisionCircles(state);
  return { 
    outX: circle.centerX, 
    outY: circle.centerY + circle.outerRadius + CFG.ZONE_SPACING + CFG.SPAWN_RADIUS + 10,
    centerX: circle.centerX,
    centerY: circle.centerY,
    outerRadius: circle.outerRadius
  };
}

export function getCoopAvoidanceForce(state, x, y) {
  const { coop } = state;
  const dx = x - coop.x;
  const dy = y - coop.y;
  const dist = Math.hypot(dx, dy);
  
  if (dist < CFG.COOP_AVOID_RADIUS && dist > 0) {
    // Push chicken away from coop center
    const pushStrength = (1 - dist / CFG.COOP_AVOID_RADIUS) * CFG.COOP_AVOID_STRENGTH;
    const nx = dx / dist;
    const ny = dy / dist;
    return { x: nx * pushStrength, y: ny * pushStrength };
  }
  return { x: 0, y: 0 };
}

export function scheduleRespawn(state, chicken) {
  // Schedule respawn after rest period - chicken stays in coop
  const restDuration = rand(CFG.REST_DURATION_MIN, CFG.REST_DURATION_MAX);
  chicken.restPhase = 'inside';
  chicken.restTimer = restDuration;
  state.respawns.push({ t: restDuration, chicken });
}

export function respawnOne(state, entry) {
  const { chickens } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;
  const s = entry.chicken;
  const di = coopDoorInfo(state);
  s.x = s.x % W;
  if (s.x < 0) s.x += W;
  s.y = s.y % H;
  if (s.y < 0) s.y += H;

  const ang = rand(Math.PI * 0.25, Math.PI * 0.75);
  const sp = rand(120, 260);
  s.vx = Math.cos(ang) * sp + rand(-40, 40);
  s.vy = -Math.abs(Math.sin(ang) * sp) + rand(-30, 10);

  s.tx = s.x % W;
  if (s.tx < 0) s.tx += W;
  s.tx = s.tx + rand(-W * 0.20, W * 0.20);
  if (s.tx < 0) s.tx += W;
  if (s.tx >= W) s.tx -= W;

  s.ty = s.y % H;
  if (s.ty < 0) s.ty += H;
  s.ty = s.ty + rand(-H * 0.20, H * 0.20);
  if (s.ty < 0) s.ty += H;
  if (s.ty >= H) s.ty -= H;

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
