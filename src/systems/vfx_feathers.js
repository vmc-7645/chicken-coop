import { CFG } from "../config.js";
import { rand, randInt } from "../util/rand.js";
import { norm2, rotate } from "../util/math2d.js";
import { torusDxDy, wrapPos } from "../util/torus.js";

// Load feather sprite
const featherImg = new Image();
let featherImageLoaded = false;

featherImg.onload = () => {
  featherImageLoaded = true;
};

featherImg.onerror = () => {
  console.error('Failed to load feather.png');
  featherImageLoaded = true;
};

featherImg.src = 'src/assets/feather.png';

export function emitFeatherPuff(state, chX, chY, srcX, srcY) {
  const { featherPuffs } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;
  
  // Direction away from source (torus-aware)
  let dir = { x: rand(-1, 1), y: rand(-1, 1) };

  if (srcX != null && srcY != null) {
    // vector from source -> chicken, so puff goes "away"
    const v = torusDxDy(srcX, srcY, chX, chY, W, H);
    dir = norm2(v.dx, v.dy);
  } else {
    dir = norm2(dir.x, dir.y);
  }

  // Add some randomness but keep bias
  const jitter = norm2(rand(-1, 1), rand(-1, 1));
  dir = norm2(
    dir.x * CFG.PUFF_BIAS + jitter.x * (1 - CFG.PUFF_BIAS),
    dir.y * CFG.PUFF_BIAS + jitter.y * (1 - CFG.PUFF_BIAS)
  );

  // Tiny white down particles
  const nDown = randInt(CFG.PUFF_DOWN_COUNT[0], CFG.PUFF_DOWN_COUNT[1]);
  for (let i = 0; i < nDown; i++) {
    const a = rand(-CFG.PUFF_SPREAD, CFG.PUFF_SPREAD);
    const d2 = rotate(dir.x, dir.y, a);
    const sp = rand(CFG.PUFF_SPEED_DOWN[0], CFG.PUFF_SPEED_DOWN[1]);
    const life0 = rand(CFG.PUFF_LIFE_DOWN[0], CFG.PUFF_LIFE_DOWN[1]);

    featherPuffs.push({
      x: chX, y: chY,
      vx: d2.x * sp + rand(-40, 40),
      vy: d2.y * sp + rand(-40, 40),
      life: life0, life0,
      type: 'down',
      ang: 0,
      angVel: 0,
      size: rand(1.0, 2.2),
      settled: false,
    });
  }

  // 1 to 2 larger tan feathers that spin
  const nF = randInt(CFG.PUFF_FEATHER_COUNT[0], CFG.PUFF_FEATHER_COUNT[1]);
  for (let i = 0; i < nF; i++) {
    const a = rand(-CFG.PUFF_SPREAD * 0.7, CFG.PUFF_SPREAD * 0.7);
    const d2 = rotate(dir.x, dir.y, a);
    const sp = rand(CFG.PUFF_SPEED_FEATHER[0], CFG.PUFF_SPEED_FEATHER[1]);
    const life0 = rand(CFG.PUFF_LIFE_FEATHER[0], CFG.PUFF_LIFE_FEATHER[1]);

    featherPuffs.push({
      x: chX, y: chY,
      vx: d2.x * sp + rand(-20, 20),
      vy: d2.y * sp + rand(-20, 20),
      life: life0, life0,
      type: 'feather',
      ang: rand(0, Math.PI * 2),
      angVel: rand(-10, 10),
      size: rand(3.5, 5.5),
      settled: false,
    });
  }
}

export function updateFeathers(state, dt) {
  const { featherPuffs } = state;
  const W = state.canvas.width;
  const H = state.canvas.height;

  for (let i = featherPuffs.length - 1; i >= 0; i--) {
    const p = featherPuffs[i];

    // fade timing changes once settled
    const lifeRate = p.settled ? (1 / CFG.PUFF_SETTLE_LIFE_MULT) : 1;
    p.life -= dt * lifeRate;
    if (p.life <= 0) { 
      featherPuffs.splice(i, 1); 
      continue; 
    }

    // motion
    const drag = Math.pow(CFG.PUFF_DRAG, dt * 60);
    p.vx *= drag;
    p.vy *= drag;

    // "settle" feel: a mild downward pull only while moving
    if (!p.settled) {
      p.vy += CFG.PUFF_GRAV * dt;
    }

    p.x = wrapPos(p.x + p.vx * dt, W);
    p.y = wrapPos(p.y + p.vy * dt, H);

    if (p.type === 'feather' && !p.settled) {
      p.ang += p.angVel * dt;
      p.angVel *= Math.pow(0.86, dt * 60);
    }

    const sp = Math.hypot(p.vx, p.vy);
    if (!p.settled && sp < CFG.PUFF_SETTLE_SPEED) {
      p.settled = true;
      p.vx = 0;
      p.vy = 0;
      p.angVel = 0;
    }
  }
}

export function drawFeathers(state, ctx) {
  const { featherPuffs } = state;
  
  for (const p of featherPuffs) {
    const a = Math.max(0, Math.min(1, p.life / p.life0));

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.ang);
    
    if (featherImageLoaded) {
      // Use feather sprite with crisp pixel rendering
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = p.type === 'down' ? (0.8 * a) : (0.9 * a);
      ctx.drawImage(featherImg, -p.size, -p.size, p.size * 2, p.size * 2);
    }
    
    ctx.restore();
  }
}
