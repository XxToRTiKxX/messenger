import { startMatrixPoints } from './matrixPoints';

export type MatrixRainController = {
  stop: () => void;
};

export type MatrixRainOptions = {
  mode?: 'matrix_rain' | 'points_ambient' | 'points_server';
  activeNodes?: number;
};

const DEFAULT_GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZqwertyuiopasdfghjklzxcvbnm';

export function startMatrixRain(
  canvas: HTMLCanvasElement,
  options: MatrixRainOptions = {}
): MatrixRainController {
  const mode = options.mode ?? 'matrix_rain';
  if (mode !== 'matrix_rain') {
    return startMatrixPoints(canvas, {
      mode,
      activeNodes: options.activeNodes
    });
  }

  const context = canvas.getContext('2d');
  if (!context) {
    return { stop: () => {} };
  }

  let width = window.innerWidth;
  let height = window.innerHeight;
  let animationFrame = 0;

  const resize = (): void => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
  };

  resize();
  window.addEventListener('resize', resize);

  const fontSize = 14;
  const fadeAlpha = 0.08;
  const glyphColor = '0, 255, 110';
  const glyphOpacity = 0.28;
  const speed = 0.42;
  const respawnChance = 0.985;

  let columns = Math.max(1, Math.floor(width / fontSize));
  let drops = new Array(columns).fill(0);

  const resetColumns = (): void => {
    columns = Math.max(1, Math.floor(width / fontSize));
    drops = new Array(columns).fill(0);
  };

  const onResize = (): void => {
    resize();
    resetColumns();
  };

  window.removeEventListener('resize', resize);
  window.addEventListener('resize', onResize);

  const drawMatrix = (): void => {
    context.fillStyle = `rgba(0, 0, 0, ${fadeAlpha})`;
    context.fillRect(0, 0, width, height);

    context.fillStyle = `rgba(${glyphColor}, ${glyphOpacity})`;
    context.font = `${fontSize}px "JetBrains Mono", monospace`;

    for (let i = 0; i < drops.length; i += 1) {
      const text = DEFAULT_GLYPHS.charAt(Math.floor(Math.random() * DEFAULT_GLYPHS.length));
      const drop = drops[i] ?? 0;
      context.fillText(text, i * fontSize, drop * fontSize);

      const shouldRespawn = drop * fontSize > height && Math.random() > respawnChance;
      drops[i] = shouldRespawn ? 0 : drop + speed;
    }

    animationFrame = window.requestAnimationFrame(drawMatrix);
  };

  animationFrame = window.requestAnimationFrame(drawMatrix);

  return {
    stop: () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', onResize);
    }
  };
}
