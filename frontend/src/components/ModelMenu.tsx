import { useEffect, useMemo, useRef, useState } from "react";
import { Cpu, Search } from "lucide-react";

export interface ModelOption {
  provider: string;
  model: string;
  label: string;
  providerLabel: string;
}

/** Change-Model sheet (reference: big-radius glass, title, provider groups,
 *  provider captions on rows, bottom search). */
export function ModelMenu({
  options,
  current,
  onPick,
  onClose,
}: {
  options: ModelOption[];
  current: string;
  onPick: (m: ModelOption) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [onClose]);

  const groups = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    for (const m of options) {
      if (query && !m.label.toLowerCase().includes(query.toLowerCase())) continue;
      if (!map.has(m.providerLabel)) map.set(m.providerLabel, []);
      map.get(m.providerLabel)!.push(m);
    }
    return [...map.entries()];
  }, [options, query]);

  return (
    <div className="model-menu" ref={ref}>
      <div className="model-menu-title">更换模型…</div>
      <div className="model-menu-body">
        {groups.map(([provider, rows]) => (
          <div key={provider}>
            <div className="model-menu-group">{provider}</div>
            {rows.map((m) => (
              <button
                key={`${m.provider}/${m.model}`}
                className={`model-menu-row${m.label === current ? " active" : ""}`}
                onClick={() => onPick(m)}
              >
                <Cpu size={16} />
                <span className="name">{m.label}</span>
                <span className="provider">{m.providerLabel}</span>
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && <div className="model-menu-empty">无匹配模型</div>}
      </div>
      <div className="model-menu-search">
        <Search size={13} />
        <input autoFocus placeholder="搜索模型…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
    </div>
  );
}
