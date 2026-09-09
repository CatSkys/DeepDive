// @ 候选统一 hook（0.1.2 原生化，TODO §0-3）：文件与候选两会话引用各一支。
// 会话内（sessionId 有）走引擎 RPC——文件候选是 cwd 亲和的整库递归索引
//（fileReferences/list，斜杠查询退化为目录列举），会话候选自带 cwd 亲和
// 排序与规范 mention（sessionReferenceResolver/candidates）；草稿页无
// agent 作用域，回落壳侧 listDir / 本地会话表（旧行为，兜底面）。
// 查询防抖 140ms + 世代序号防迟到回包串台；引擎未就绪时空候选不弹错。

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { listDir } from "./host";
import { sessionMentionCandidates, type SessionMentionCandidate } from "./session/sessionMention";
import type { SessionSummary } from "./types";

const DEBOUNCE_MS = 140;

export interface AtEntry {
  name: string;
  path: string;
  isDir: boolean;
}

const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** 文件/目录候选：会话内引擎索引，草稿页壳侧目录列举。 */
export function useFileCandidates(args: { query: string; sessionId: string | null; wsPath: string | undefined }): AtEntry[] {
  const { query, sessionId, wsPath } = args;
  const [entries, setEntries] = useState<AtEntry[]>([]);
  const [dirRows, setDirRows] = useState<AtEntry[]>([]);
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    if (!sessionId) {
      setEntries([]);
      return;
    }
    const timer = setTimeout(() => {
      void api.fileCandidates(sessionId, query)
        .then((list) => {
          if (seqRef.current === seq) setEntries(list.map((c) => ({ name: baseName(c.path), path: c.path, isDir: c.kind === "directory" })));
        })
        .catch(() => {
          // engine 未就绪/繁忙：空候选（菜单不出现该节），不弹错
          if (seqRef.current === seq) setEntries([]);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [sessionId, query]);

  // 草稿页壳侧列举：查询串按最后一个 / 拆 目录前缀/文件名过滤段。
  // 绝对查询直列该目录；相对查询拼工作空间根。
  const slash = query.lastIndexOf("/");
  const dirPart = slash >= 0 ? query.slice(0, slash + 1) : "";
  const namePart = (slash >= 0 ? query.slice(slash + 1) : query).toLowerCase();
  useEffect(() => {
    if (sessionId) {
      setDirRows([]);
      return;
    }
    const basePath = !wsPath ? undefined : dirPart.startsWith("/") ? dirPart : `${wsPath}/${dirPart}`;
    if (!basePath) {
      setDirRows([]);
      return;
    }
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      void listDir(basePath).then((rows) => {
        if (seqRef.current === seq) setDirRows(rows);
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [sessionId, wsPath, dirPart]);

  const local = useMemo(
    () => dirRows.filter((e) => e.name.toLowerCase().startsWith(namePart)),
    [dirRows, namePart],
  );
  return sessionId ? entries : local;
}

/** 统一会话引用候选行（引擎/本地同形）。 */
export interface SessionCandidate {
  sessionId: string;
  label: string;
  at: number;
  mention: string;
}

/** 会话引用候选：会话内引擎排序（cwd 亲和 + 规范 mention），草稿页本地表。 */
export function useSessionCandidates(args: {
  sessionId: string | null;
  query: string;
  sessions: SessionSummary[];
  lang: "zh" | "en";
}): SessionCandidate[] {
  const { sessionId, query, sessions, lang } = args;
  const [remote, setRemote] = useState<SessionCandidate[]>([]);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!sessionId) {
      setRemote([]);
      return;
    }
    const seq = ++seqRef.current;
    const timer = setTimeout(() => {
      void api.sessionCandidates(sessionId, query)
        .then((list) => {
          if (seqRef.current === seq) {
            setRemote(list.map((c) => ({ sessionId: c.sessionId, label: c.label, at: c.createdAt ?? 0, mention: c.mention })));
          }
        })
        .catch(() => {
          // engine 未就绪/繁忙：空候选，不弹错
          if (seqRef.current === seq) setRemote([]);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [sessionId, query]);

  const local = useMemo<SessionCandidate[]>(
    () => (sessionId ? [] : sessionMentionCandidates(sessions, null, query, lang)
      .map((c: SessionMentionCandidate) => ({ sessionId: c.sessionId, label: c.label, at: c.updatedAt, mention: c.mention }))),
    [sessionId, sessions, query, lang],
  );
  return sessionId ? remote : local;
}
