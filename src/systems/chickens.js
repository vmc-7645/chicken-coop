import { CFG } from "../config.js";
import { rand, randInt } from "../util/rand.js";
import { clamp, norm2, rotate } from "../util/math2d.js";
import { wrapPos, torusDist, torusDxDy } from "../util/torus.js";
import { emitFeatherPuff } from "./vfx_feathers.js";
import { 
  coopCollisionCircles, 
  isInDespawnZone, 
  coopDoorInfo, 
  scheduleRespawn,
  getCoopAvoidanceForce,
  coopBodyContains
} from "./coop.js";
import { findTargetSeed, findSeedById } from "./seeds.js";

export function chooseRole() {
  const r = Math.random();
  if (r < CFG.P_CHICK) return 'chick';
  if (r < CFG.P_CHICK + CFG.P_ROOSTER) return 'rooster';
  return 'hen';
}

export function roleSizeDelta(role) {
  if (role === 'chick') return CFG.CHICK_SIZE_DELTA;
  if (role === 'rooster') return CFG.ROOSTER_SIZE_DELTA;
  return 0;
}

export function initChickens(state, n) {
  const { chickens } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;
  
  chickens.length = 0;
  const cx = W * 0.5;
  const cy = H * 0.5;
  const di = coopDoorInfo(state);

  for (let i = 0; i < n; i++) {
    const role = chooseRole();
    const size = clamp(CFG.SIZE + roleSizeDelta(role), 10, 26);

    const speediness = rand(0.75, 1.25) * (role === 'chick' ? 0.92 : (role === 'rooster' ? 1.08 : 1.0));
    const wanderiness = rand(0.75, 1.45);
    const patience = rand(0.7, 1.8);
    const socialness = rand(-1.0, 1.0);

    const temperament = {
      wander: CFG.WANDER * rand(0.60, 1.55) * wanderiness,
      centerPull: CFG.CENTER_PULL * rand(0.5, 1.35),
      damping: clamp(CFG.DAMPING * rand(0.93, 1.02), 0.84, 0.95),
      maxSpeed: CFG.MAX_SPEED * rand(0.65, 1.20) * speediness,
      impulseChance: CFG.IMPULSE_CHANCE * rand(0.45, 2.2),
      impulseScale: CFG.IMPULSE_SCALE * rand(0.7, 1.9),
      targetSpread: rand(0.22, 0.48),
      targetTempo: rand(0.80, 1.75),

      chaseBoost: rand(2.2, 4.2) * speediness,
      eatRate: rand(0.75, 1.5) * (role === 'chick' ? 1.05 : 1.0),

      patience,
      noticeDelay: rand(0.0, CFG.REACTION_MAX) * patience,

      socialness
    };

    // Spawn OUTSIDE near the coop door so you never see chickens inside the coop.
    const x = wrapPos(di.outX + rand(-30, 30), W);
    const y = wrapPos(di.outY + rand(10, 70), H);

    chickens.push({
      role,
      size,
      x,
      y,
      vx: rand(-60, 60),
      vy: rand(-60, 60),
      size,
      role,
      socialness: rand(0.2, 1.0),
      wander: rand(CFG.WANDER * 0.5, CFG.WANDER * 1.5),
      maxSpeed: CFG.MAX_SPEED * rand(0.8, 1.2),
      maxFatigue: rand(25, 45),
      fatigue: 0,
      restPhase: 'none',
      restT: 0,
      noticeTimer: 0,
      noticeDelay: rand(0.1, 0.3),
      peckTimer: 0,
      eyeX: 0,
      eyeY: 0,
      temperament: rand() < 0.5 ? 'calm' : 'nervous',
      temperamentT: 0,
      panicTimer: 0,
      panicT: 0,
      panicMode: 0,
      panicX: 0,
      panicY: 0,
      panicCircleAmp: 0,
      panicCircleFreq: 0,
      panicCirclePhase: 0,
      panicWaveAmp: 0,
      panicWaveFreq: 0,
      panicWavePhase: 0,
      fleeTimer: 0,
      fleeT: 0,
      fleeTargetIdx: -1,
      fleeX: 0,
      fleeY: 0,
      skidTimer: 0,
      tx: wrapPos(cx + rand(-W * 0.30, W * 0.30), W),
      ty: wrapPos(cy + rand(-H * 0.30, H * 0.30), H),
      nextTargetIn: rand(0.15, 0.8) * temperament.targetTempo,

      eatState: 0,        // 0 none, 1 pause, 2 pecking
      eatPauseT: 0,
      eatPecksLeft: 0,
      eatPeckT: 0,        // time until next peck pulse

      // New natural behavior properties
      wanderAngle: rand(0, Math.PI * 2),
      pauseTimer: 0,
      curiosityTimer: rand(0, 2),
      personality: rand() < 0.33 ? 'curious' : (rand() < 0.5 ? 'cautious' : 'bold'),

      // zigzag
      zigzagPhase: rand(0, Math.PI * 2),
      zigzagFreq: rand(CFG.ZIGZAG_FREQ_MIN, CFG.ZIGZAG_FREQ_MAX),

      // social/cluster state
      isolatedTime: 0,
      clusteredTime: 0,
      temperamentCooldown: 0,
      lastFlipReason: '',

      // panic run
      panicTargetIdx: -1,


      // startle
      startleCooldown: 0,

      // cached eye offset (updated at draw)
      eyeX: 0,
      eyeY: 0,

      ...temperament
    });
  }
}

export function startleChicken(state, chicken, hasAnySeed, srcX = null, srcY = null) {
  if (chicken.startleCooldown > 0) return;
  chicken.startleCooldown = CFG.STARTLE_COOLDOWN;

  emitFeatherPuff(state, chicken.x, chicken.y, srcX, srcY);

  // If food exists, keep them on-task but add a quick jolt + skid
  if (hasAnySeed) {
    chicken.vx += rand(-1, 1) * CFG.STARTLE_IMPULSE;
    chicken.vy += rand(-1, 1) * CFG.STARTLE_IMPULSE;
    chicken.skidTimer = Math.max(chicken.skidTimer, rand(CFG.SKID_TIME_MIN, CFG.SKID_TIME_MAX));
    return;
  }

  triggerPanic(state, chicken);
  chicken.panicTimer = Math.min(chicken.panicTimer, rand(0.25, 0.60));
}

export function triggerPanic(state, s) {
  const W = state.canvas.width;
  const H = state.canvas.height;
  
  s.panicTimer = rand(CFG.PANIC_DURATION_MIN, CFG.PANIC_DURATION_MAX);
  s.panicT = 0;

  const r = Math.random();
  const p0 = CFG.PANIC_P_LINEAR;
  const p1 = p0 + CFG.PANIC_P_CIRCULAR;
  const p2 = p1 + CFG.PANIC_P_WAVY;
  if (r < p0) s.panicMode = 0;
  else if (r < p1) s.panicMode = 1;
  else if (r < p2) s.panicMode = 2;
  else s.panicMode = 3;

  // Default target
  s.panicX = wrapPos(s.x + rand(-W * 0.55, W * 0.55), W);
  s.panicY = wrapPos(s.y + rand(-H * 0.55, H * 0.55), H);

  // Circular params
  s.panicCx = s.x;
  s.panicCy = s.y;
  s.panicR = rand(CFG.PANIC_CIRCLE_RADIUS_MIN, CFG.PANIC_CIRCLE_RADIUS_MAX);
  s.panicOmega = (Math.random() < 0.5 ? -1 : 1) * rand(CFG.PANIC_CIRCLE_OMEGA_MIN, CFG.PANIC_CIRCLE_OMEGA_MAX);

  // Wavy params
  s.panicWaveAmp = rand(CFG.PANIC_WAVE_AMP_MIN, CFG.PANIC_WAVE_AMP_MAX);
  s.panicWaveFreq = rand(CFG.PANIC_WAVE_FREQ_MIN, CFG.PANIC_WAVE_FREQ_MAX);

  // Toward-chicken target
  if (s.panicMode === 3) {
    // This will be handled in the main update function where we have access to all chickens
    s.panicTargetIdx = -1;
  } else {
    s.panicTargetIdx = -1;
  }
}

export function triggerFlee(state, victim, pursuer) {
  const { chickens } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;
  
  // True torus "away" direction from pursuer -> victim
  const vv = torusDxDy(pursuer.x, pursuer.y, victim.x, victim.y, W, H);
  const d = Math.hypot(vv.dx, vv.dy) || 1;
  const ux = vv.dx / d;
  const uy = vv.dy / d;

  const dist = rand(CFG.FLEE_TARGET_DIST_MIN, CFG.FLEE_TARGET_DIST_MAX);
  victim.fleeTimer = rand(CFG.FLEE_DURATION_MIN, CFG.FLEE_DURATION_MAX);
  victim.fleeFromIdx = chickens.indexOf(pursuer);

  victim.fleeX = wrapPos(victim.x + ux * dist + rand(-40, 40), W);
  victim.fleeY = wrapPos(victim.y + uy * dist + rand(-40, 40), H);

  // Flee overrides the victim's panic
  victim.panicTimer = 0;
  victim.panicMode = 0;
  victim.panicTargetIdx = -1;
  victim.panicT = 0;

  victim.tx = victim.fleeX;
  victim.ty = victim.fleeY;
  victim.nextTargetIn = 999;
}

export function snapshotTemperament(s) {
  return {
    wander: +s.wander.toFixed(3),
    centerPull: +s.centerPull.toFixed(3),
    damping: +s.damping.toFixed(3),
    maxSpeed: +s.maxSpeed.toFixed(3),
    impulseChance: +s.impulseChance.toFixed(3),
    impulseScale: +s.impulseScale.toFixed(3),
    targetSpread: +s.targetSpread.toFixed(3),
    targetTempo: +s.targetTempo.toFixed(3),
    chaseBoost: +s.chaseBoost.toFixed(3),
    eatRate: +s.eatRate.toFixed(3),
    patience: +s.patience.toFixed(3),
    noticeDelay: +s.noticeDelay.toFixed(3),
    socialness: +s.socialness.toFixed(3),
    zigzagFreq: +s.zigzagFreq.toFixed(3)
  };
}

export function mutateTemperament(s) {
  const metrics = [
    'wander','centerPull','damping','maxSpeed','impulseChance','impulseScale',
    'targetSpread','targetTempo','chaseBoost','eatRate','patience','socialness','zigzagFreq'
  ];
  const k = Math.floor(rand(1, 3.999));

  for (let i = 0; i < k; i++) {
    const m = metrics[Math.floor(Math.random() * metrics.length)];
    const r = (Math.random() * 2 - 1) * CFG.MUTATION_SCALE;

    if (m === 'damping') {
      s.damping = clamp(s.damping + r * 0.10, 0.82, 0.97);
    } else if (m === 'centerPull') {
      s.centerPull = clamp(s.centerPull + r * 0.35, 0.02, 0.45);
    } else if (m === 'wander') {
      s.wander = clamp(s.wander * (1 + r), 0.6, 6.0);
    } else if (m === 'maxSpeed') {
      s.maxSpeed = clamp(s.maxSpeed * (1 + r), 180, 900);
    } else if (m === 'impulseChance') {
      s.impulseChance = clamp(s.impulseChance * (1 + r), 0.01, 0.35);
    } else if (m === 'impulseScale') {
      s.impulseScale = clamp(s.impulseScale * (1 + r), 0.4, 4.0);
    } else if (m === 'targetSpread') {
      s.targetSpread = clamp(s.targetSpread * (1 + r), 0.14, 0.65);
    } else if (m === 'targetTempo') {
      s.targetTempo = clamp(s.targetTempo * (1 + r), 0.55, 2.4);
    } else if (m === 'chaseBoost') {
      s.chaseBoost = clamp(s.chaseBoost * (1 + r), 0.9, 7.0);
    } else if (m === 'eatRate') {
      s.eatRate = clamp(s.eatRate * (1 + r), 0.35, 2.5);
    } else if (m === 'patience') {
      s.patience = clamp(s.patience * (1 + r), 0.55, 2.4);
      s.noticeDelay = clamp(rand(0.0, CFG.REACTION_MAX) * s.patience, 0, CFG.REACTION_MAX * 2.2);
    } else if (m === 'socialness') {
      s.socialness = clamp(s.socialness + r * 1.6, -1, 1);
    } else if (m === 'zigzagFreq') {
      s.zigzagFreq = clamp(s.zigzagFreq * (1 + r), 0.6, 6.0);
    }
  }

  if (Math.random() < 0.4) {
    s.nextTargetIn = 0;
  }
}

export function flipTemperament(s, reason) {
  s.socialness = clamp(-s.socialness, -1, 1);

  const newPat = clamp(1.6 - s.patience, 0.7, 1.8);
  s.patience = newPat;
  s.noticeDelay = clamp(rand(0.0, CFG.REACTION_MAX) * s.patience, 0, CFG.REACTION_MAX * 2.2);

  if (reason === 'clustered') {
    s.wander = clamp(s.wander * 1.18, 0.6, 5.5);
    s.targetSpread = clamp(s.targetSpread * 1.12, 0.18, 0.60);
    s.targetTempo = clamp(s.targetTempo * 0.92, 0.60, 2.2);
  } else {
    s.wander = clamp(s.wander * 0.92, 0.6, 5.5);
    s.targetSpread = clamp(s.targetSpread * 0.92, 0.18, 0.60);
    s.targetTempo = clamp(s.targetTempo * 1.06, 0.60, 2.2);
  }

  s.temperamentCooldown = CFG.TEMPERAMENT_COOLDOWN;
  s.isolatedTime = 0;
  s.clusteredTime = 0;
  s.lastFlipReason = reason;
}
