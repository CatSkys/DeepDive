import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import css from "./Bots.module.css";
import rowsCss from "../settings/SettingsRows.module.css";
import { Dropdown, Toggle } from "../components/controls";
import { api, type ImAccessScope, type ImAccessUser, type ImBot, type ImSnapshot } from "../api";
import { useT } from "../i18n";

// 机器人访问策略：谁能用这个机器人（私聊 / 群聊 各一套）。
//
// 契约（取自插件源码，勿猜）：`bot.access-policy.set {botId, policy}`，policy 是
// `{direct, group}` —— **两边必须齐全、键必须精确**（shared/access-policy.mjs 的
// validateAccessPolicy 用 hasExactKeys 校验），所以每次改动都**整份发回**。
// 形状与 wire 一致（ImAccessPolicy），中间不做扁平化，少一层表示少一类错。
//
// 读不到整份策略就整块不渲染：拿不准当前状态时摆一套默认值等于说谎。

const SCOPES = [
  { key: "direct", label: "私聊" },
  { key: "group", label: "群聊" },
] as const;

type ScopeKey = (typeof SCOPES)[number]["key"];

export function BotAccessPolicy({ channel, bot, onSaved, onError }: {
  channel: string;
  bot: ImBot;
  onSaved: (snapshot: ImSnapshot) => void;
  onError: (message: string) => void;
}) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const policy = bot.accessPolicy;

  if (!policy) return null;

  const saveScope = (key: ScopeKey, scope: ImAccessScope) => {
    const next = { ...policy, [key]: scope };
    setBusy(true);
    void api.im.setBotAccessPolicy(channel, bot.botId, next)
      .then(onSaved)
      .catch((e: Error) => onError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <div className={css.settings} data-busy={busy || undefined}>
      <div className={css.settingRow}>
        <span className={css.settingLabel}>{t("访问策略")}</span>
        <span className={css.settingHint}>{t("决定谁能让这个机器人干活。")}</span>
      </div>
      {SCOPES.map(({ key, label }) => {
        const scope = policy[key];
        return (
          <div key={key} className={css.scopeBlock}>
            <div className={css.settingRow}>
              <span className={css.settingLabel}>{t(label)}</span>
              <span className={css.settingControl}>
                <Dropdown
                  options={[
                    { v: "allowlist", label: t("仅白名单用户") },
                    { v: "open", label: t("所有用户") },
                  ]}
                  value={scope.mode}
                  onChange={(v) => saveScope(key, {
                    ...scope,
                    mode: v === "open" ? "open" : "allowlist",
                  })}
                />
              </span>
            </div>

            {scope.mode === "allowlist" ? (
              <UserList
                title={t("白名单用户")}
                emptyHint={t("当前没有白名单用户，保存后普通用户将无法使用机器人。")}
                users={scope.allowlist.users}
                onChange={(users) => saveScope(key, { ...scope, allowlist: { users } })}
              />
            ) : (
              <>
                <div className={css.settingRow}>
                  <span className={css.settingLabel}>{t("默认命令权限")}</span>
                  <span className={css.settingControl}>
                    <Toggle
                      on={scope.open.defaultCanExecuteCommands}
                      onChange={(on) => saveScope(key, {
                        ...scope,
                        open: { ...scope.open, defaultCanExecuteCommands: on },
                      })}
                    />
                  </span>
                </div>
                <UserList
                  title={t("命令权限例外")}
                  emptyHint={t("没有例外：命令权限按上面的默认值。")}
                  users={scope.open.commandPermissionOverrides}
                  onChange={(users) => saveScope(key, { ...scope, open: { ...scope.open, commandPermissionOverrides: users } })}
                />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 用户清单：一行一个 id + 该用户能否执行命令 + 删除；底部一行加新用户。
 *  白名单与"命令权限例外"同形状，共用这一份（插件的 validate 也是同一个用户形状）。 */
function UserList({ title, emptyHint, users, onChange }: {
  title: string;
  emptyHint: string;
  users: ImAccessUser[];
  onChange: (users: ImAccessUser[]) => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState("");

  const add = () => {
    const id = draft.trim();
    if (!id || users.some((u) => u.id === id)) return; // 重复 id 插件会拒，这里先挡
    onChange([...users, { id, canExecuteCommands: false }]);
    setDraft("");
  };

  return (
    <div className={css.userList}>
      <div className={css.userListTitle}>{title}</div>
      {users.length === 0 && <div className={css.userListEmpty}>{emptyHint}</div>}
      {users.map((user) => (
        <div key={user.id} className={css.userRow}>
          <span className={css.userId} title={user.id}>{user.id}</span>
          <Toggle
            on={user.canExecuteCommands}
            onChange={(on) => onChange(users.map((u) => (u.id === user.id ? { ...u, canExecuteCommands: on } : u)))}
          />
          <button
            className={rowsCss.dangerButton}
            aria-label={t("删除")}
            onClick={() => onChange(users.filter((u) => u.id !== user.id))}
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <div className={css.userRow}>
        <input
          className={`${rowsCss.textField} ${css.userInput}`}
          placeholder={t("用户标识（对方的 id）")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        />
        <button className={rowsCss.secondaryButton} disabled={!draft.trim()} onClick={add}>
          <Plus size={12} />
          {t("添加")}
        </button>
      </div>
    </div>
  );
}
