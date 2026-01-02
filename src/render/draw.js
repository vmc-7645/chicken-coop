import { CFG } from "../config.js";
import { wrapPos } from "../util/torus.js";
import { rand } from "../util/rand.js";
import { coopCollisionCircles } from "../systems/coop.js";
import { drawFeathers } from "../systems/vfx_feathers.js";

// Load chicken sprite
const chickenImg = new Image();
let imageLoaded = false;

chickenImg.onload = () => {
  imageLoaded = true;
};

chickenImg.onerror = () => {
  console.error('Failed to load chicken.png');
  imageLoaded = true;
};

chickenImg.src = 'src/assets/chicken.png';

// Load grass sprite
const grassImg = new Image();
let grassImageLoaded = false;
let grassPositions = null; // Cache grass positions

grassImg.onload = () => {
  grassImageLoaded = true;
};

grassImg.onerror = () => {
  console.error('Failed to load grass.png');
  grassImageLoaded = true;
};

grassImg.src = 'src/assets/grass.png';

// Grass animation state
let grassTime = 0;

// Load coop sprite
const coopImg = new Image();
let coopImageLoaded = false;

coopImg.onload = () => {
  coopImageLoaded = true;
};

coopImg.onerror = () => {
  console.error('Failed to load coop.png');
  coopImageLoaded = true;
};

coopImg.src = 'src/assets/coop.png';

// Dust particle system
let dustParticles = [];

export function draw(state, ctx) {
  // Update grass animation time
  grassTime += 0.016; // ~60fps timing
  
  drawBackground(state, ctx);
  drawCoop(state, ctx);
  drawSeeds(state, ctx);
  drawFeathers(state, ctx);
  drawChickens(state, ctx);
  drawDust(state, ctx);
  drawUI(state, ctx);
  
  // Apply pixel-art filter effect
  applyPixelFilter(state, ctx);
}

function drawBackground(state, ctx) {
  ctx.fillStyle = CFG.GREEN;
  ctx.fillRect(0, 0, state.canvas.width, state.canvas.height);
  
  // Draw random grass patches
  if (grassImageLoaded) {
    ctx.imageSmoothingEnabled = false;
    
    // Generate grass positions once and cache them
    if (!grassPositions || grassPositions.canvasWidth !== state.canvas.width || grassPositions.canvasHeight !== state.canvas.height) {
      const grassCount = 40;
      const grassSize = 16;
      grassPositions = {
        canvasWidth: state.canvas.width,
        canvasHeight: state.canvas.height,
        patches: []
      };
      
      for (let i = 0; i < grassCount; i++) {
        const seed = i * 1337 + 42;
        grassPositions.patches.push({
          x: Math.abs(Math.sin(seed) * 0.5 + 0.5) * (state.canvas.width - grassSize),
          y: Math.abs(Math.cos(seed * 1.3) * 0.5 + 0.5) * (state.canvas.height - grassSize),
          flipped: Math.sin(seed * 2.7) > 0,
          size: grassSize
        });
      }
    }
    
    // Draw cached grass positions with animation
    for (const patch of grassPositions.patches) {
      ctx.save();
      ctx.translate(patch.x + patch.size/2, patch.y + patch.size/2);
      
      // Calculate wind effect
      const windStrength = Math.sin(grassTime * 2 + patch.x * 0.01) * 0.15;
      
      // Calculate chicken interaction effect
      let chickenEffect = 0;
      for (const chicken of state.chickens) {
        const dx = chicken.x - patch.x;
        const dy = chicken.y - patch.y;
        const distance = Math.hypot(dx, dy);
        const chickenSpeed = Math.hypot(chicken.vx, chicken.vy);
        
        // Chicken affects grass when nearby and moving fast
        if (distance < 60 && chickenSpeed > 50) {
          const influence = (1 - distance / 60) * (chickenSpeed / 200);
          chickenEffect += influence * Math.sign(dx);
        }
      }
      
      // Combine wind and chicken effects
      const totalEffect = windStrength + chickenEffect * 0.3;
      
      // Apply rotation based on effects
      ctx.rotate(totalEffect);
      
      if (patch.flipped) {
        ctx.scale(-1, 1);
      }
      
      ctx.drawImage(grassImg, -patch.size/2, -patch.size/2, patch.size, patch.size);
      ctx.restore();
    }
  }
}

function drawCoop(state, ctx) {
  const circle = coopCollisionCircles(state);

  // Draw coop sprite if loaded, otherwise fallback to circles
  if (coopImageLoaded) {
    ctx.imageSmoothingEnabled = false;
    
    // Calculate coop size based on the outer radius
    const coopWidth = circle.outerRadius * 2;
    const coopHeight = coopWidth * (32 / 20); // Maintain 20:32 ratio
    
    // Center the coop sprite over the circle
    const x = circle.centerX - coopWidth / 2;
    const y = circle.centerY - coopHeight / 2;
    
    ctx.drawImage(coopImg, x, y, coopWidth, coopHeight);
  } else {
    // Fallback to original circle drawing
    ctx.fillStyle = CFG.COOP_FILL;
    ctx.beginPath();
    ctx.arc(circle.centerX, circle.centerY, circle.outerRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = CFG.COOP_ENTRANCE;
    ctx.beginPath();
    ctx.arc(circle.centerX, circle.centerY, circle.innerRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = CFG.COOP_STROKE;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(circle.centerX, circle.centerY, circle.outerRadius, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawSeeds(state, ctx) {
  const { seeds } = state;
  const W = state.canvas.width;

  ctx.fillStyle = CFG.TAN;
  for (const sd of seeds) {
    const x = Math.round(wrapPos(sd.x, W) - CFG.SEED_SIZE * 0.5);
    const y = Math.round(sd.y - CFG.SEED_SIZE * 0.5);
    // If seed y is above 0 (because it spawned above its ground), still draw it
    ctx.fillRect(x, y, CFG.SEED_SIZE, CFG.SEED_SIZE);
  }
}

function drawChickens(state, ctx) {
  const { chickens } = state;
  const { W } = state.canvas;

  for (const s of chickens) {
    const half = s.size * 0.5;
    let x = s.x - half;
    let y = s.y - half;

    // Peck visual jitter
    if (s.peckTimer > 0) {
      x += rand(-CFG.PECK_JITTER, CFG.PECK_JITTER);
      y += rand(-CFG.PECK_JITTER, CFG.PECK_JITTER);
    }

    const rx = Math.round(x);
    const ry = Math.round(y);
    const sz = Math.round(s.size);

    // Save context state
    ctx.save();
    
    // Flip chicken horizontally to face right direction
    ctx.translate(rx + sz/2, ry + sz/2);
    
    // Determine if chicken should be flipped based on velocity
    const sp = Math.hypot(s.vx, s.vy);
    let facingRight = true;
    if (sp > 0.001) {
      // Chicken should face the direction it's moving
      facingRight = s.vx >= 0;
    }
    
    if (!facingRight) {
      ctx.scale(-1, 1);
    }
    
    // Generate dust particles if moving quickly
    const speed = Math.hypot(s.vx, s.vy);
    if (speed > 100 && Math.random() < 0.3) {
      // Create dust cloud behind chicken
      for (let i = 0; i < 2; i++) {
        dustParticles.push({
          x: s.x - s.vx * 0.02 + rand(-4, 4),
          y: s.y - s.vy * 0.02 + rand(-2, 2),
          vx: rand(-20, 20) - s.vx * 0.1,
          vy: rand(-30, -10),
          size: rand(2, 4),
          life: rand(0.3, 0.8),
          maxLife: rand(0.3, 0.8)
        });
      }
    }

    // Draw chicken sprite only if image is loaded
    if (imageLoaded) {
      // Enable crisp pixel rendering
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(chickenImg, -sz/2, -sz/2, sz, sz);
    } else {
      // Fallback to white rectangle if image not loaded
      ctx.fillStyle = CFG.WHITE;
      ctx.fillRect(rx, ry, sz, sz);
    }
    
    // Restore context state
    ctx.restore();

    // // Eye dot (one pixel) based on velocity direction
    // let ex = 1, ey = 0;
    // if (sp > 0.001) { ex = s.vx / sp; ey = s.vy / sp; }
    // const ox = Math.round(ex * (s.size * 0.22));
    // const oy = Math.round(ey * (s.size * 0.22));
    // s.eyeX = ox;
    // s.eyeY = ey;

    // const cxp = rx + Math.floor(sz * 0.5) + ox;
    // const cyp = ry + Math.floor(sz * 0.5) + oy;
    // ctx.fillStyle = CFG.BLACK;
    // ctx.fillRect(cxp, cyp, 1, 1);
  }
}

function drawUI(state, ctx) {
  // Currently no UI elements, but placeholder for future additions
}

function drawDust(state, ctx) {
  const dt = 0.016; // ~60fps timing
  
  // Update and draw dust particles
  for (let i = dustParticles.length - 1; i >= 0; i--) {
    const dust = dustParticles[i];
    
    // Update physics
    dust.x += dust.vx * dt;
    dust.y += dust.vy * dt;
    dust.vy += 200 * dt; // Gravity
    dust.vx *= 0.98; // Air resistance
    dust.life -= dt;
    
    // Remove dead particles
    if (dust.life <= 0) {
      dustParticles.splice(i, 1);
      continue;
    }
    
    // Draw dust particle
    const alpha = Math.max(0, dust.life / dust.maxLife);
    ctx.fillStyle = `rgba(120, 120, 120, ${alpha * 0.6})`; // Brown dust color
    ctx.fillRect(dust.x - dust.size/2, dust.y - dust.size/2, dust.size, dust.size);
  }
}

function applyPixelFilter(state, ctx) {
  const pixelSize = 4; // How much to pixelate (higher = more pixelated)
  const { width, height } = state.canvas;
  
  // Get the current canvas image data
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  // Create a pixelated effect using mean color of each block
  // Optimized: pre-calculate indices and use single loop
  const pixelCount = Math.floor(width / pixelSize) * Math.floor(height / pixelSize);
  const blockArea = pixelSize * pixelSize;
  
  for (let y = 0; y < height; y += pixelSize) {
    for (let x = 0; x < width; x += pixelSize) {
      let r = 0, g = 0, b = 0, a = 0;
      let count = 0;
      
      // Calculate the mean color of this pixel block
      const maxY = Math.min(y + pixelSize, height);
      const maxX = Math.min(x + pixelSize, width);
      
      for (let dy = y; dy < maxY; dy++) {
        for (let dx = x; dx < maxX; dx++) {
          const sourceIndex = (dy * width + dx) * 4;
          r += data[sourceIndex];
          g += data[sourceIndex + 1];
          b += data[sourceIndex + 2];
          a += data[sourceIndex + 3];
          count++;
        }
      }
      
      // Calculate average
      const invCount = 1 / count;
      r = Math.round(r * invCount);
      g = Math.round(g * invCount);
      b = Math.round(b * invCount);
      a = Math.round(a * invCount);
      
      // Fill the entire pixel block with the mean color
      for (let dy = y; dy < maxY; dy++) {
        for (let dx = x; dx < maxX; dx++) {
          const targetIndex = (dy * width + dx) * 4;
          data[targetIndex] = r;
          data[targetIndex + 1] = g;
          data[targetIndex + 2] = b;
          data[targetIndex + 3] = a;
        }
      }
    }
  }
  
  // Put the modified image data back
  ctx.putImageData(imageData, 0, 0);
  
  // Apply sharpening filter
  applySharpenFilter(state, ctx);
}

function applySharpenFilter(state, ctx) {
  const { width, height } = state.canvas;
  
  // Get the pixelated image data
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const output = new Uint8ClampedArray(data);
  
  // Sharpening kernel (3x3) - milder version
  const kernel = [
    0, -0.25, 0,
    -0.25, 2, -0.25,
    0, -0.25, 0
  ];
  
  // Optimized: pre-calculate kernel weights and use single loop
  const width4 = width * 4;
  const heightMinus1 = height - 1;
  const widthMinus1 = width - 1;
  
  // Apply convolution
  for (let y = 1; y < heightMinus1; y++) {
    const yWidth = y * width;
    const yMinus1Width = (y - 1) * width;
    const yPlus1Width = (y + 1) * width;
    
    for (let x = 1; x < widthMinus1; x++) {
      const xMinus1 = x - 1;
      const xPlus1 = x + 1;
      
      // Calculate indices once
      const centerIndex = (yWidth + x) * 4;
      const topIndex = (yMinus1Width + x) * 4;
      const bottomIndex = (yPlus1Width + x) * 4;
      const leftIndex = (yWidth + xMinus1) * 4;
      const rightIndex = (yWidth + xPlus1) * 4;
      
      // Apply kernel directly (unrolled for performance)
      let r = data[centerIndex] * 2 
              - data[topIndex] * 0.25 
              - data[bottomIndex] * 0.25 
              - data[leftIndex] * 0.25 
              - data[rightIndex] * 0.25;
      
      let g = data[centerIndex + 1] * 2 
              - data[topIndex + 1] * 0.25 
              - data[bottomIndex + 1] * 0.25 
              - data[leftIndex + 1] * 0.25 
              - data[rightIndex + 1] * 0.25;
      
      let b = data[centerIndex + 2] * 2 
              - data[topIndex + 2] * 0.25 
              - data[bottomIndex + 2] * 0.25 
              - data[leftIndex + 2] * 0.25 
              - data[rightIndex + 2] * 0.25;
      
      // Clamp values
      output[centerIndex] = Math.min(255, Math.max(0, r));
      output[centerIndex + 1] = Math.min(255, Math.max(0, g));
      output[centerIndex + 2] = Math.min(255, Math.max(0, b));
      output[centerIndex + 3] = data[centerIndex + 3]; // Keep original alpha
    }
  }
  
  // Create new image data with sharpened result
  const sharpenedImageData = new ImageData(output, width, height);
  ctx.putImageData(sharpenedImageData, 0, 0);
}
