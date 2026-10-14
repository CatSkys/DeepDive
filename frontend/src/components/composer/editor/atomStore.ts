// 附件原子的数据面。编辑器的 widget 是**独立的 React 根**（CodeMirror 自己建的 DOM，
// 拿不到外层 context），所以附件对象与三个动作放在这里：编排方每次渲染推一份最新的，
// widget 订阅它重画。为什么必须订阅而不是画一次就完——上传进度、大小、失败原因都会变
// （只画一次的 widget 会永远停在"上传中 0%"）。
import type { Attachment, ImageAttachment } from "../useComposerAttachments";

/** 编排方给的接线：按附件 id 取当前对象与三个动作。 */
export interface AtomHost {
  /** 词典：原子画在独立 React 根里，拿不到顶层 context（见 AttachmentPill 的注释）。 */
  t: (zh: string) => string;
  attachment(id: string): Attachment | undefined;
  onRemove(id: string): void;
  onRetry(id: string): void;
  /** 点开大图（图片部件的胶囊）。 */
  onOpenImage(att: ImageAttachment): void;
}

let host: AtomHost = {
  t: (zh) => zh,
  attachment: () => undefined,
  onRemove: () => {},
  onRetry: () => {},
  onOpenImage: () => {},
};
let version = 0;
const listeners = new Set<() => void>();

/** 编排方每次渲染推最新值（附件集合与回调都随之更新）。 */
export function setAtomHost(next: AtomHost): void {
  host = next;
  version += 1;
  for (const listener of listeners) listener();
}

export function atomHost(): AtomHost {
  return host;
}

export function subscribeAtoms(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function atomsVersion(): number {
  return version;
}
