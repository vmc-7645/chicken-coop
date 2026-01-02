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

grassImg.onload = () => {
  grassImageLoaded = true;
};

grassImg.onerror = () => {
  console.error('Failed to load grass.png');
  grassImageLoaded = true;
};

grassImg.src = 'src/assets/grass.png';

export function draw(state, ctx) {
  drawBackground(state, ctx);
  drawCoop(state, ctx);
  drawSeeds(state, ctx);
  drawFeathers(state, ctx);
  drawChickens(state, ctx);
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
    const grassCount = 40; // Number of grass patches
    const grassSize = 16; // Half the original size
    
    for (let i = 0; i < grassCount; i++) {
      // Use a deterministic seed based on grass index for consistent placement
      const seed = i * 1337 + 42;
      const x = Math.abs(Math.sin(seed) * 0.5 + 0.5) * (state.canvas.width - grassSize);
      const y = Math.abs(Math.cos(seed * 1.3) * 0.5 + 0.5) * (state.canvas.height - grassSize);
      
      ctx.save();
      ctx.translate(x + grassSize/2, y + grassSize/2);
      
      // Randomly flip horizontally
      if (Math.sin(seed * 2.7) > 0) {
        ctx.scale(-1, 1);
      }
      
      ctx.drawImage(grassImg, -grassSize/2, -grassSize/2, grassSize, grassSize);
      ctx.restore();
    }
  }
}

function drawCoop(state, ctx) {
  const circle = coopCollisionCircles(state);

  // Draw outer circle (coop walls)
  ctx.fillStyle = CFG.COOP_FILL;
  ctx.beginPath();
  ctx.arc(circle.centerX, circle.centerY, circle.outerRadius, 0, Math.PI * 2);
  ctx.fill();

  // Draw inner circle (coop interior)
  ctx.fillStyle = CFG.GREEN;
  ctx.beginPath();
  ctx.arc(circle.centerX, circle.centerY, circle.innerRadius, 0, Math.PI * 2);
  ctx.fill();

  // Draw door opening (arc at bottom)
  ctx.fillStyle = CFG.GREEN;
  ctx.beginPath();
  const doorStart = circle.doorAngle - circle.doorAngleWidth * 0.5;
  const doorEnd = circle.doorAngle + circle.doorAngleWidth * 0.5;
  ctx.arc(circle.centerX, circle.centerY, circle.outerRadius, doorStart, doorEnd);
  ctx.arc(circle.centerX, circle.centerY, circle.innerRadius, doorEnd, doorStart, true);
  ctx.closePath();
  ctx.fill();

  // Draw outline
  ctx.strokeStyle = CFG.COOP_STROKE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(circle.centerX, circle.centerY, circle.outerRadius, 0, Math.PI * 2);
  ctx.stroke();
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

function applyPixelFilter(state, ctx) {
  const pixelSize = 4; // How much to pixelate (higher = more pixelated)
  const { width, height } = state.canvas;
  
  // Get the current canvas image data
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  
  // Create a pixelated effect using mean color of each block
  for (let y = 0; y < height; y += pixelSize) {
    for (let x = 0; x < width; x += pixelSize) {
      let r = 0, g = 0, b = 0, a = 0;
      let count = 0;
      
      // Calculate the mean color of this pixel block
      for (let dy = 0; dy < pixelSize && y + dy < height; dy++) {
        for (let dx = 0; dx < pixelSize && x + dx < width; dx++) {
          const sourceIndex = ((y + dy) * width + (x + dx)) * 4;
          r += data[sourceIndex];
          g += data[sourceIndex + 1];
          b += data[sourceIndex + 2];
          a += data[sourceIndex + 3];
          count++;
        }
      }
      
      // Calculate average
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);
      a = Math.round(a / count);
      
      // Fill the entire pixel block with the mean color
      for (let dy = 0; dy < pixelSize && y + dy < height; dy++) {
        for (let dx = 0; dx < pixelSize && x + dx < width; dx++) {
          const targetIndex = ((y + dy) * width + (x + dx)) * 4;
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
  
  // Apply convolution
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let r = 0, g = 0, b = 0;
      
      // Apply kernel to surrounding pixels
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const kernelIndex = (ky + 1) * 3 + (kx + 1);
          const pixelIndex = ((y + ky) * width + (x + kx)) * 4;
          const weight = kernel[kernelIndex];
          
          r += data[pixelIndex] * weight;
          g += data[pixelIndex + 1] * weight;
          b += data[pixelIndex + 2] * weight;
        }
      }
      
      // Set the output pixel
      const outputIndex = (y * width + x) * 4;
      output[outputIndex] = Math.min(255, Math.max(0, r));
      output[outputIndex + 1] = Math.min(255, Math.max(0, g));
      output[outputIndex + 2] = Math.min(255, Math.max(0, b));
      output[outputIndex + 3] = data[outputIndex + 3]; // Keep original alpha
    }
  }
  
  // Create new image data with sharpened result
  const sharpenedImageData = new ImageData(output, width, height);
  ctx.putImageData(sharpenedImageData, 0, 0);
}
