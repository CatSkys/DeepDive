// 模型基准详情卡（ModelMenu ⓘ 开关的内容体）：只管展示。
// 三条 0–4 刻度（速度/智能——登记表 modelFacts 的榜单抄录；成本——引擎目录
// peak 牌价折合，套餐行走登记表手工档，推导口径 costMeter），
// 无速度/智能数据的模型显示「暂无基准数据」占位框；上下文行按引擎目录
// contextWindow 原样格式化（tokens，不换算 words——单位诚实）；
// 能力行只画已知为「支持」的（视觉/工具/推理），未知的省行，不画否定态。
// 不管选模型、不管档位、不管开关——那是 ModelMenu 的事。
import { Brain, Eye, Wrench } from "lucide-react";
import { useT } from "../i18n";
import { fmtContext } from "../settings/ModelsManage";
import { costMeter } from "../modelFacts";
import type { ModelOption } from "./ModelMenu";

/** 一条刻度：标签行 + 五段轨道（fill 按刻度 0–4 占 0–100%；段界圆点画在轨道上）。 */
function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="model-detail-meter">
      <span className="lbl">{label}</span>
      <span className="track">
        <span className="fill" style={{ width: `${value * 25}%` }} />
      </span>
    </div>
  );
}

export function ModelDetailCard({ option }: { option: ModelOption }) {
  const { t } = useT();
  const f = option.facts;
  const hasBench = f?.speed !== undefined || f?.intelligence !== undefined;
  const vision = option.inputModalities?.includes("image") === true;
  const reasoning = (option.efforts?.length ?? 0) > 0;
  // 工具行只在登记表收录该模型时渲染：引擎没有工具能力事实，未收录即未知。
  const tools = f === undefined ? undefined : f.tools !== false;
  const costValue = costMeter(option);
  return (
    <div className="model-detail-view">
      <div className="model-detail-name">{option.label}</div>
      {f?.speed !== undefined && <Meter label={t("速度")} value={f.speed} />}
      {f?.intelligence !== undefined && <Meter label={t("智能")} value={f.intelligence} />}
      {!hasBench && <div className="model-detail-nobench">{t("暂无基准数据")}</div>}
      {costValue !== undefined && <Meter label={t("成本")} value={costValue} />}
      {option.contextWindow !== undefined && (
        <div className="model-detail-context">
          <span className="lbl">{t("上下文")}</span>
          <span className="val">{fmtContext(option.contextWindow)} | {Math.round(option.contextWindow / 10_000)}万</span>
        </div>
      )}
      <div className="model-detail-caps">
        {vision && <span className="cap"><Eye size={13} />{t("视觉")}</span>}
        {tools === false && <span className="cap off"><Wrench size={13} />{t("不支持工具调用")}</span>}
        {tools && <span className="cap"><Wrench size={13} />{t("工具调用")}</span>}
        {reasoning && <span className="cap"><Brain size={13} />{t("支持推理")}</span>}
      </div>
    </div>
  );
}
