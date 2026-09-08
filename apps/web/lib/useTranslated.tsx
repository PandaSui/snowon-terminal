"use client";

import { apiUrl } from "@/lib/apiBase";
import { useQuery } from "@tanstack/react-query";
import { readJson } from "@/lib/http";
import { useLocale } from "@/lib/locale";

/** 把若干字符串译成当前界面语言;失败则回原文。不译 ticker。 */
export function useTranslatedTexts(texts: string[]): string[] {
  const [locale] = useLocale();
  const cleaned = texts.map((s) => (s ?? "").trim());
  const need = locale !== "zh" && cleaned.some(Boolean);
  const { data } = useQuery({
    queryKey: ["translate", locale, cleaned],
    enabled: need,
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/translate"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: locale, texts: cleaned }),
      });
      const body = await readJson<{ texts?: string[] }>(res);
      if (!Array.isArray(body.texts) || body.texts.length !== cleaned.length) return cleaned;
      return body.texts.map((t, i) => (t && t.trim() ? t : cleaned[i]));
    },
  });
  return data ?? cleaned;
}

export function useTranslatedText(text: string | null | undefined): string {
  const src = text ?? "";
  return useTranslatedTexts([src])[0] ?? src;
}

export function TranslatedText({ text }: { text: string }) {
  const out = useTranslatedText(text);
  return <>{out || text}</>;
}
