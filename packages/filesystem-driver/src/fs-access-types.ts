/**
 * File System Access API 的全局类型补充（仅编译期，运行时无副作用）。
 * TS 5.6 的 lib.dom 已有 FileSystemHandle / FileSystemDirectoryHandle / FileSystemFileHandle，
 * 但缺 showDirectoryPicker（Picker 方法）与 FileSystemDirectoryHandle.entries()。
 *
 * 被 fs.ts side-effect import，因此 filesystem 包自身与 ui-shell（经 drivers.ts import fs.ts）
 * 两个编译上下文都能加载这些全局声明——单一来源，无需在 ui-shell 重复声明。
 */
export {};

declare global {
  function showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
  interface DirectoryPickerOptions {
    mode?: "read" | "readwrite";
    id?: string;
    startIn?: string;
  }
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
  }
}
