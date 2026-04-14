type MeshPoint = {
  id: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  bornAt: number;
  lifeMs: number;
  anchored: boolean;
};

type ProjectedPoint = {
  x: number;
  y: number;
  z: number;
  scale: number;
  point: MeshPoint;
};

export type MatrixPointsOptions = {
  mode: 'points_ambient' | 'points_server';
  activeNodes?: number;
};

export type MatrixPointsController = {
  stop: () => void;
};

const TAU = Math.PI * 2;

const randomRange = (min: number, max: number): number => Math.random() * (max - min) + min;

const createAmbientPoint = (id: number, now: number): MeshPoint => ({
  id,
  x: randomRange(-400, 400),
  y: randomRange(-280, 280),
  z: randomRange(-240, 340),
  vx: randomRange(-4, 4),
  vy: randomRange(-2.8, 2.8),
  vz: randomRange(-3.4, 3.4),
  bornAt: now,
  lifeMs: randomRange(650, 240000),
  anchored: false
});

const createUserPoint = (id: number, now: number): MeshPoint => {
  const angle = randomRange(0, TAU);
  const radius = randomRange(90, 240);
  return {
    id,
    x: Math.cos(angle) * radius,
    y: Math.tan(angle) * radius,
    z: Math.sin(angle) * radius,
    vx: randomRange(-8, 8),
    vy: randomRange(-6, 6),
    vz: randomRange(-7, 7),
    bornAt: now,
    lifeMs: Number.POSITIVE_INFINITY,
    anchored: false
  };
};

const makeAnchor = (): MeshPoint => ({
  id: -1,
  x: 0,
  y: 0,
  z: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  bornAt: Date.now(),
  lifeMs: Number.POSITIVE_INFINITY,
  anchored: true
});

const tickPoints = (points: MeshPoint[], dtSeconds: number, now: number): MeshPoint[] => {
  const alive: MeshPoint[] = [];

  for (const point of points) {
    if (point.lifeMs !== Number.POSITIVE_INFINITY && now - point.bornAt >= point.lifeMs) {
      continue;
    }

    point.x += point.vx * dtSeconds;
    point.y += point.vy * dtSeconds;
    point.z += point.vz * dtSeconds;

    if (Math.abs(point.x) > 310) point.vx *= -1;
    if (Math.abs(point.y) > 220) point.vy *= -1;
    if (Math.abs(point.z) > 280) point.vz *= -1;

    alive.push(point);
  }

  return alive;
};

const connectTwoNearest = (points: ProjectedPoint[]): Array<[number, number]> => {
  const pairs = new Set<string>();
  const edges: Array<[number, number]> = [];

  for (let i = 0; i < points.length; i += 1) {
    const distances: Array<{ idx: number; d: number }> = [];
    for (let j = 0; j < points.length; j += 1) {
      if (i === j) continue;
      const dx = points[i]!.point.x - points[j]!.point.x;
      const dy = points[i]!.point.y - points[j]!.point.y;
      const dz = points[i]!.point.z - points[j]!.point.z;
      distances.push({ idx: j, d: dx * dx + dy * dy + dz * dz });
    }
    distances.sort((a, b) => a.d - b.d);

    for (const nearest of distances.slice(0, 2)) {
      const a = Math.min(i, nearest.idx);
      const b = Math.max(i, nearest.idx);
      const key = `${a}-${b}`;
      if (pairs.has(key)) continue;
      pairs.add(key);
      edges.push([a, b]);
    }
  }

  return edges;
};

const connectAllPoints = (points: ProjectedPoint[]): Array<[number, number]> => {
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      edges.push([i, j]);
    }
  }
  return edges;
};

export function startMatrixPoints(canvas: HTMLCanvasElement, options: MatrixPointsOptions): MatrixPointsController {
  const context = canvas.getContext('2d');
  if (!context) {
    return { stop: () => {} };
  }

  const mode = options.mode;
  const perspective = 520;
  let width = window.innerWidth;
  let height = window.innerHeight;
  let animationFrame = 0;
  let rotation = 0;
  let lastTimestamp = performance.now();
  let nextPointId = 1;
  let spawnAccumulatorMs = 0;

  let ambientPoints: MeshPoint[] = [];
  let userPoints: MeshPoint[] = [];
  const anchor = makeAnchor();

  const resize = (): void => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
  };

  const ensureServerPoints = (now: number): void => {
    const desired = Math.min(30, Math.max(0, options.activeNodes ?? 0));

    if (userPoints.length > desired) {
      userPoints = userPoints.slice(0, desired);
      return;
    }

    while (userPoints.length < desired) {
      userPoints.push(createUserPoint(nextPointId, now));
      nextPointId += 1;
    }
  };

  const projectPoint = (point: MeshPoint): ProjectedPoint => {
    const sin = Math.sin(rotation);
    const cos = Math.cos(rotation);

    const rx = point.x * cos - point.z * sin;
    const rz = point.x * sin + point.z * cos;
    const scale = perspective / (perspective + rz + 340);

    return {
      x: width / 2 + rx * scale,
      y: height / 2 + point.y * scale,
      z: rz,
      scale,
      point
    };
  };

  resize();
  window.addEventListener('resize', resize);

  if (mode === 'points_ambient') {
    const now = Date.now();
    ambientPoints = [createAmbientPoint(nextPointId, now), createAmbientPoint(nextPointId + 1, now)];
    nextPointId += 2;
  }

  const drawPoints = (timestamp: number): void => {
    const now = Date.now();
    const dtSeconds = Math.max(0.001, (timestamp - lastTimestamp) / 1000);
    lastTimestamp = timestamp;
    rotation += dtSeconds * 0.2;

    context.clearRect(0, 0, width, height);

    if (mode === 'points_ambient') {
      spawnAccumulatorMs += dtSeconds * 1000;
      if (spawnAccumulatorMs >= 1250) {
        spawnAccumulatorMs = 0;
        ambientPoints.push(createAmbientPoint(nextPointId, now));
        nextPointId += 1;
      }
      ambientPoints = tickPoints(ambientPoints, dtSeconds, now);
    } else {
      ensureServerPoints(now);
      userPoints = tickPoints(userPoints, dtSeconds, now);
    }

    const rawPoints = mode === 'points_ambient' ? ambientPoints : [anchor, ...userPoints];
    const projected = rawPoints.map(projectPoint);
    const edges = mode === 'points_server' ? connectAllPoints(projected) : connectTwoNearest(projected);

    for (const [a, b] of edges) {
      const p1 = projected[a]!;
      const p2 = projected[b]!;
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const alpha =
        mode === 'points_server'
          ? Math.max(0.03, 0.2 - dist / 760)
          : Math.max(0.08, 0.42 - dist / 680);

      context.strokeStyle = `rgba(0, 255, 155, ${alpha})`;
      context.lineWidth = Math.max(0.4, (p1.scale + p2.scale) * 1.2);
      context.beginPath();
      context.moveTo(p1.x, p1.y);
      context.lineTo(p2.x, p2.y);
      context.stroke();
    }

    for (const item of projected) {
      const lifeAlpha =
        item.point.lifeMs === Number.POSITIVE_INFINITY
          ? 1
          : Math.max(0, 1 - (now - item.point.bornAt) / item.point.lifeMs);
      const alpha = mode === 'points_ambient'
        ? Math.max(0.28, Math.min(1, item.scale * 1.7 * lifeAlpha))
        : Math.max(0.16, Math.min(0.95, item.scale * 1.3 * lifeAlpha));
      const radius = item.point.anchored ? 3.8 : Math.max(1.2, item.scale * 2.6);

      context.fillStyle = item.point.anchored
        ? `rgba(140, 255, 220, ${Math.min(1, alpha + 0.2)})`
        : `rgba(40, 255, 180, ${alpha})`;
      context.beginPath();
      context.arc(item.x, item.y, radius, 0, TAU);
      context.fill();
    }

    animationFrame = window.requestAnimationFrame(drawPoints);
  };

  animationFrame = window.requestAnimationFrame(drawPoints);

  return {
    stop: () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', resize);
    }
  };
}
