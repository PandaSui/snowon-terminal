"use client";

import { useEffect, useState } from "react";

/** 窄屏判定(<900px 进入移动布局)。初始恒为 false 保证 SSR/水合一致,useEffect 里再按真实视口修正 */
export function useIsMobile(breakpoint = 900): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);
  return mobile;
}
