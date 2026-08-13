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
  // 用 ref 存回调，让 window 监听常驻（挂载一次）——否则依赖内联 onMove/onResize 会在每次渲染重建监听，
  // 且 up 若移除监听，第一次拖拽后监听消失，第二次无法再拖（严重 bug）。
  const onMoveRef = useRef(onMove);
  const onResizeRef = useRef(onResize);
  useEffect(() => {
    onMoveRef.current = onMove;
  });
  useEffect(() => {
    onResizeRef.current = onResize;
  });

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (dragRef.current) {
        onMoveRef.current(dragRef.current.x + (e.clientX - dragRef.current.px), dragRef.current.y + (e.clientY - dragRef.current.py));
      } else if (resizeRef.current) {
        onResizeRef.current(
          Math.max(220, resizeRef.current.w + (e.clientX - resizeRef.current.px)),
          Math.max(160, resizeRef.current.h + (e.clientY - resizeRef.current.py)),
        );
      }
    };
    const up = () => {
      // 只清理拖拽/缩放状态，不移除监听——监听常驻，保证可反复拖拽
      dragRef.current = null;
      resizeRef.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("blur", up); // 窗口失焦视为释放：拖拽中切走不「卡住」（审查 M1，对比 Resizer）
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("blur", up);
    };
  }, []);

  return (
    <div className="floating-panel" style={{ left: x, top: y, width: w, height: h }}>
      <div
        className="floating-panel-header"
        onMouseDown={(e) => {
          e.preventDefault(); // 阻止拖拽标题时文本选择
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
          e.preventDefault(); // 阻止缩放拖拽时文本选择
          resizeRef.current = { px: e.clientX, py: e.clientY, w, h };
        }}
      />
    </div>
  );
}
