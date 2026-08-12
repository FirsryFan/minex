import { createContext, useContext } from "react";
import type { MinexKernel } from "@minex/kernel";

/** 内核宿主视图注入 React 树 */
export const KernelContext = createContext<MinexKernel | null>(null);

export function useKernel(): MinexKernel {
  const k = useContext(KernelContext);
  if (!k) throw new Error("KernelContext 未提供——UI 必须先 bootstrap 内核");
  return k;
}
