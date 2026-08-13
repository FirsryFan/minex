import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * 通用浮窗容器（S3）：标题栏拖拽移动、右下角缩放、关闭。
 * 停靠/浮起切换由外壳管理（关闭 → 回 defaultDock；双击 dock 标题可浮起）。
 */
export function FloatingPanel({
  title,
  x,
  y,
  w,
  h,
  onMove,
  onResize,
  onClose,
  children,
}: {
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const resizeRef = useRef<{ px: number; py: number; w: number; h: number } | null>(null);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (dragRef.current) {
        onMove(dragRef.current.x + (e.clientX - dragRef.current.px), dragRef.current.y + (e.clientY - dragRef.current.py));
      } else if (resizeRef.current) {
        onResize(
          Math.max(220, resizeRef.current.w + (e.clientX - resizeRef.current.px)),
          Math.max(160, resizeRef.current.h + (e.clientY - resizeRef.current.py)),
        );
      }
    };
    const up = () => {
      dragRef.current = null;
      resizeRef.current = null;
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [onMove, onResize]);

  return (
    <div className="floating-panel" style={{ left: x, top: y, width: w, height: h }}>
      <div
        className="floating-panel-header"
        onMouseDown={(e) => {
          dragRef.current = { px: e.clientX, py: e.clientY, x, y };
        }}
      >
        <span className="floating-panel-title">{title}</span>
        <button className="icon-btn" title="关闭（回停靠）" onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      <div className="floating-panel-body">{children}</div>
      <div
        className="floating-panel-resize"
        onMouseDown={(e) => {
          resizeRef.current = { px: e.clientX, py: e.clientY, w, h };
        }}
      />
    </div>
  );
}
