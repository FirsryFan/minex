import { useEffect, useRef } from "react";
import { X } from "lucide-react";

/**
 * 通用浮窗容器（S3/S4）：标题栏拖拽移动、右下角缩放、关闭。
 * 拖拽结束（mouseup/blur）上报 onDrop(x,y)，供外壳做「贴靠 dock」吸附判断（S4 m2）。
 * 监听常驻 + ref 存回调，保证可反复拖拽、失焦不卡（审查 M1）。
 */
export function FloatingPanel({
  title,
  x,
  y,
  w,
  h,
  onMove,
  onResize,
  onDrop,
  onClose,
  children,
}: {
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  onMove: (x: number, y: number, w: number, h: number) => void;
  onResize: (w: number, h: number) => void;
  onDrop: (x: number, y: number) => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const dragRef = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const resizeRef = useRef<{ px: number; py: number; w: number; h: number } | null>(null);
  const movedRef = useRef(false); // 是否真拖动过（mouseup 时区分「点击」与「拖动结束」）
  const posRef = useRef({ x, y, w, h });
  const onMoveRef = useRef(onMove);
  const onResizeRef = useRef(onResize);
  const onDropRef = useRef(onDrop);

  useEffect(() => {
    posRef.current = { x, y, w, h };
  });
  useEffect(() => {
    onMoveRef.current = onMove;
  });
  useEffect(() => {
    onResizeRef.current = onResize;
  });
  useEffect(() => {
    onDropRef.current = onDrop;
  });

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (dragRef.current) {
        const nx = dragRef.current.x + (e.clientX - dragRef.current.px);
        const ny = dragRef.current.y + (e.clientY - dragRef.current.py);
        movedRef.current = true;
        onMoveRef.current(nx, ny, posRef.current.w, posRef.current.h);
      } else if (resizeRef.current) {
        onResizeRef.current(
          Math.max(220, resizeRef.current.w + (e.clientX - resizeRef.current.px)),
          Math.max(160, resizeRef.current.h + (e.clientY - resizeRef.current.py)),
        );
      }
    };
    const up = () => {
      if (movedRef.current) onDropRef.current(posRef.current.x, posRef.current.y);
      // 只清理拖拽/缩放状态，不移除监听——监听常驻，保证可反复拖拽
      dragRef.current = null;
      resizeRef.current = null;
      movedRef.current = false;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("blur", up); // 窗口失焦视为释放（拖拽中切走不「卡住」，审查 M1）
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
          movedRef.current = false;
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
