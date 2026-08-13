/**
 * markdown ↔ filesystem 驱动间的事件协议。
 * 事件 topic 与 payload 形状为驱动间约定（字面量，避免跨包运行时依赖）；
 * 生产端（filesystem sidebar）emit，消费端（markdown workspace）守卫校验。
 */

/** 文件树点击文件 → 通知编辑器打开（payload: OpenFilePayload） */
export const OPEN_FILE_TOPIC = "filesystem:openFile";
/** 编辑器保存 → 通知文件树刷新（payload: FileSavedPayload） */
export const FILE_SAVED_TOPIC = "filesystem:fileSaved";

export interface OpenFilePayload {
  path: string;
}

export interface FileSavedPayload {
  path: string;
}

/** 守卫：filesystem:openFile 的 payload 是否为 `{ path: string }`（消费方防御脏数据）。 */
export function isOpenFilePayload(x: unknown): x is OpenFilePayload {
  return typeof x === "object" && x !== null && typeof (x as { path?: unknown }).path === "string";
}
