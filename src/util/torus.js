export function wrapPos(v, size) {
  v = v % size;
  if (v < 0) v += size;
  return v;
}

export function torusDelta(d, size) {
  d = ((d % size) + size) % size; // [0, size)
  if (d > size * 0.5) d -= size;   // (-size/2, size/2]
  return d;
}

export function torusDxDy(ax, ay, bx, by, W, H) {
  return {
    dx: torusDelta(bx - ax, W),
    dy: torusDelta(by - ay, H)
  };
}

export function torusDist(ax, ay, bx, by, W, H) {
  const v = torusDxDy(ax, ay, bx, by, W, H);
  return Math.hypot(v.dx, v.dy);
}

export function torusDistSq(ax, ay, bx, by, W, H) {
  const v = torusDxDy(ax, ay, bx, by, W, H);
  return v.dx * v.dx + v.dy * v.dy;
}
