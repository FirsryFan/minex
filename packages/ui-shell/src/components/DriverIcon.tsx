/**
 * 驱动图标渲染：图片（data URI / URL / 相对路径）优先，emoji 兜底。
 * 图标来自驱动 manifest.icon——驱动内图片文件经 Vite 解析为 URL。
 */
export function DriverIcon({ icon, size = 18 }: { icon?: string; size?: number }) {
  if (!icon) return <span className="driver-icon">📦</span>;
  const isImage = icon.startsWith("data:") || icon.startsWith("http") || icon.startsWith("/");
  if (isImage) {
    return (
      <img
        className="driver-icon-img"
        src={icon}
        alt=""
        width={size}
        height={size}
        style={{ borderRadius: 4, objectFit: "contain" }}
      />
    );
  }
  // emoji / 文本兜底
  return <span className="driver-icon">{icon}</span>;
}
