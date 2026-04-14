import { useEffect, useRef } from 'react';
import { startMatrixRain } from '../../shared/matrixRain';

type Props = {
  enabled: boolean;
  mode: 'matrix_rain' | 'points_ambient' | 'points_server';
  activeNodes?: number;
};

export function MatrixRainCanvas({ enabled, mode, activeNodes = 0 }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const canvas = ref.current;
    if (!canvas) return;
    const controller = startMatrixRain(canvas, { mode, activeNodes });

    return () => {
      controller.stop();
    };
  }, [enabled, mode, activeNodes]);

  if (!enabled) return null;

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-0 opacity-55" aria-hidden="true" />;
}
