// 「打开方式」选择器（全屏预览页右上）：App 图标胶囊 + 下拉，列出能打开
// 当前文件的 App（图标 + 名称，当前项打勾），选一个就请壳用该 App 打开。
// 数据源是壳桥（OpenWithCatalog），纯浏览器/无候选时整个入口隐藏。
// 下拉的弹出、定位、外部点击/Esc 收起都复用 components/controls 的 Dropdown，
// 不另开一份菜单。

import { useEffect, useState } from "react";
import { Dropdown, type DropdownOption } from "../controls";
import { openWith, openWithList, type OpenWithApp } from "../../host";
import { t } from "../../i18n";

/** 图标节点：壳给的 PNG dataURL，行内 15px（与 Lucide 行图标同档）。 */
function appIcon(app: OpenWithApp) {
  return <img src={app.icon} alt="" width={15} height={15} />;
}

export function OpenWithMenu({ path }: { path: string }) {
  const [apps, setApps] = useState<OpenWithApp[]>([]);
  /** 用户在本页选过的 App；未选过时跟壳给的默认项。 */
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setApps([]);
    setPicked(null);
    void openWithList(path).then((listing) => {
      if (!alive) return;
      setApps(listing.apps);
      setPicked(listing.defaultId || listing.apps[0]?.id || null);
    });
    return () => { alive = false; };
  }, [path]);

  if (apps.length === 0 || picked === null) return null;

  const options: DropdownOption[] = apps.map((app) => ({
    v: app.id,
    label: app.name,
    iconNode: appIcon(app),
  }));

  return (
    <span className="open-with">
      <Dropdown
        options={options}
        value={picked}
        iconOnly
        ariaLabel={t("打开方式")}
        onChange={(id) => {
          setPicked(id);
          openWith(path, id);
        }}
      />
    </span>
  );
}
