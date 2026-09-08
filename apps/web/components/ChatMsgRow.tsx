"use client";

import { EmojiAvatar } from "./EmojiAvatar";
import { useT } from "@/lib/locale";

export function isMineMsg(userId: string | undefined, myId: string | undefined | null): boolean {
  if (!userId || !myId) return false;
  return userId.toLowerCase() === myId.toLowerCase();
}

/** 聊天气泡:自己的靠右,别人的靠左。 */
export function ChatMsgRow({
  mine,
  userId,
  username,
  content,
  holdingShareBps,
  avatarSize = 16,
}: {
  mine: boolean;
  userId: string;
  username: string;
  content: string;
  holdingShareBps?: number | null;
  avatarSize?: number;
}) {
  const tr = useT();
  return (
    <div
      style={{
        marginBottom: 8,
        display: "flex",
        flexDirection: mine ? "row-reverse" : "row",
        alignItems: "flex-start",
        gap: 6,
      }}
    >
      <EmojiAvatar seed={userId || username} size={avatarSize} />
      <div
        style={{
          minWidth: 0,
          maxWidth: "78%",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          alignItems: mine ? "flex-end" : "flex-start",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, maxWidth: "100%" }}>
          <span
            style={{
              color: mine ? "#f0b90b" : "#848e9c",
              fontWeight: 700,
              fontSize: 11,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {username}
          </span>
          {holdingShareBps != null && holdingShareBps > 0 && (
            <span style={{ flexShrink: 0, fontSize: 10, color: "#0ecb81" }}>
              {tr("holdShare", { pct: (holdingShareBps / 100).toFixed(2) })}
            </span>
          )}
        </span>
        <span
          style={{
            display: "inline-block",
            padding: "6px 10px",
            borderRadius: mine ? "10px 2px 10px 10px" : "2px 10px 10px 10px",
            background: mine ? "rgba(240,185,11,0.18)" : "#161b22",
            color: "#eaecef",
            wordBreak: "break-word",
            lineHeight: 1.45,
          }}
        >
          {content}
        </span>
      </div>
    </div>
  );
}
