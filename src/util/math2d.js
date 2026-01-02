export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function norm2(x, y) {
  const m = Math.hypot(x, y);
  return m > 1e-6 ? { x: x / m, y: y / m } : { x: 1, y: 0 };
}

export function rotate(x, y, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: x * c - y * s, y: x * s + y * c };
}

export function resolveCircleCircle(x1, y1, r1, x2, y2, r2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  const dist = Math.hypot(dx, dy);
  const minDist = r1 + r2;
  
  if (dist >= minDist) return { x: x1, y: y1, hit: false };
  
  // Circles overlap, push first circle out
  const push = minDist - dist;
  const nx = dist > 0 ? dx / dist : 1;
  const ny = dist > 0 ? dy / dist : 0;
  
  return { x: x1 + nx * push, y: y1 + ny * push, hit: true };
}
