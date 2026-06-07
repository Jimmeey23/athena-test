import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const Spline = lazy(() => import('@splinetool/react-spline'));

interface InteractiveRobotSplineProps {
  scene: string;
  className?: string;
  headObjectName?: string;
  smile?: boolean;
}

interface SplineObjectLike {
  rotation?: {
    x: number;
    y: number;
  };
}

interface SplineAppLike {
  findObjectByName?: (name: string) => SplineObjectLike | undefined;
}

export default function InteractiveRobotSpline({
  scene,
  className,
  headObjectName = 'Head',
  smile = false,
}: InteractiveRobotSplineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const splineRef = useRef<SplineAppLike | null>(null);
  const frameRef = useRef<number | null>(null);
  const [canMountSpline, setCanMountSpline] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateReadiness = () => {
      const rect = node.getBoundingClientRect();
      setCanMountSpline(rect.width >= 24 && rect.height >= 24);
    };

    updateReadiness();
    const observer = new ResizeObserver(updateReadiness);
    observer.observe(node);
    const frame = requestAnimationFrame(updateReadiness);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 15;
      const y = ((event.clientY - rect.top) / rect.height - 0.5) * 15;
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        const headObject = splineRef.current?.findObjectByName?.(headObjectName);
        if (!headObject?.rotation) return;
        headObject.rotation.y = (x * Math.PI) / 180;
        headObject.rotation.x = (-y * Math.PI) / 180;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [headObjectName]);

  return (
    <div ref={containerRef} className={cn('relative min-h-6 min-w-6', className)}>
      {canMountSpline ? (
        <Suspense
          fallback={
            <div className="flex h-full w-full items-center justify-center bg-transparent">
              <Loader2 className="h-8 w-8 animate-spin text-slate-500/70" />
            </div>
          }
        >
          <Spline scene={scene} onLoad={(spline: SplineAppLike) => { splineRef.current = spline; }} />
        </Suspense>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-transparent">
          <Loader2 className="h-8 w-8 animate-spin text-slate-500/60" />
        </div>
      )}
      {smile && <span className="pointer-events-none absolute left-1/2 top-[58%] h-2.5 w-5 -translate-x-1/2 rounded-b-full border-b-2 border-blue-500/80" />}
    </div>
  );
}
