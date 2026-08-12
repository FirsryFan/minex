/**
 * 右栏 = 空槽位。命令面板等具体视图属于驱动，外壳不实现。
 */
export function RightBar() {
  return (
    <aside className="rightbar">
      <div className="section-title">右栏</div>
      <div className="muted">（空槽位——驱动视图将在此贡献）</div>
    </aside>
  );
}
