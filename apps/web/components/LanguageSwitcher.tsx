"use client";

import { LOCALES, useLocale } from "@/lib/locale";

/** 中 / EN / 한 — 控制全站文案与代币名/介绍/推特预览的翻译目标语 */
export function LanguageSwitcher() {
  const [locale, setLocale] = useLocale();
  return (
    <span
      title="Language / 语言 / 언어"
      style={{
        display: "inline-flex", alignItems: "center",
        border: "1px solid #2b3139", borderRadius: 6, overflow: "hidden", flexShrink: 0,
      }}
    >
      {LOCALES.map((l, i) => (
        <button
          key={l.id}
          type="button"
          onClick={() => setLocale(l.id)}
          style={{
            padding: "4px 8px", fontSize: 11, fontWeight: 800, cursor: "pointer",
            border: 0, borderLeft: i === 0 ? 0 : "1px solid #2b3139",
            background: locale === l.id ? "#f0b90b" : "transparent",
            color: locale === l.id ? "#000" : "#848e9c",
          }}
        >
          {l.label}
        </button>
      ))}
    </span>
  );
}
