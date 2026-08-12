import type { ReactNode } from "react";

/** 浮窗：遮罩变暗 + 内容高层显示，宽最多 61.8vw，非全屏时左右留白 */
export function FloatingWindow({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="floating-mask" onClick={onClose}>
      <div className="floating" onClick={(e) => e.stopPropagation()}>
        <div className="floating-head">
          <strong>{title}</strong>
          <button className="icon-btn" onClick={onClose}>
            关闭
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
