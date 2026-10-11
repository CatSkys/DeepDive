// DeepDiving（深潜）浮层壳（横版穿越）：App 根部挂 Host；流末 loader「Deep diving...」与命令面板
// 都经 openDeepDiving() 打开。RAF 循环在 ready（浮动）与 run（物理）两个相位跑，暂停=
// 定格；关闭只卸浮层，世界保留在 store——再开从原地继续。键盘焦点收在面板上
// （tabIndex=-1）：空格/方向键只在这里当推力，焦点离开/切窗即自动暂停；
// Esc=暂停，暂停/结束态 Esc=关闭。相位的生命周期转换归本组件与 store，world 只管物理。
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import { Volume2, VolumeX, X } from "lucide-react";
import { DD_EVENTS, dispatchAppEvent } from "../events";
import { tt, useT } from "../i18n";
import { blipStart, pingMilestone, pingRecord, primeAudio, thudDeath } from "./audio";
import {
  bestDepth,
  currentWorld,
  pauseWorld,
  registerDeepDiving,
  replaceWorld,
  resumeWorld,
  setSoundOn,
  soundOn,
  submitDepth,
} from "./store";
import { drawFrame } from "./render";
import { DeadOverlay, PausedOverlay } from "./Overlays";
import { createWorld, distanceM, randomSeed, step, VIEW_H, VIEW_W, type Phase } from "./world";
import css from "./DeepDiving.module.css";

/** App 根部挂一次：消费 openDeepDiving 请求。 */
export function DeepDivingHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    registerDeepDiving(() => setOpen(true));
    return () => registerDeepDiving(null);
  }, []);
  // 浮层在静止指针下打开：hover 复位走命令面板同一条事件（同一通道，语义都是
  // 「浮层出现，指针停着的那处不算选」）
  useEffect(() => {
    if (open) dispatchAppEvent(DD_EVENTS.commandPalette);
  }, [open]);
  return open ? <DeepDiving onClose={() => setOpen(false)} /> : null;
}

const THRUST_KEYS = new Set([" ", "ArrowUp", "ArrowDown"]);

function DeepDiving({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [phase, setPhase] = useState<Phase>(currentWorld().phase);
  const [best, setBest] = useState(() => bestDepth());
  const [sound, setSound] = useState(() => soundOn());
  const panelRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const depthRef = useRef<HTMLSpanElement | null>(null);
  const thrustRef = useRef(false);
  const recordRef = useRef(false); // 本局是否已破过纪录（破纪录音只响一次）
  // 初值取当前世界的百米档：关了再开（世界保留）时不重放已过百米的 ping
  const milestoneRef = useRef(Math.floor(distanceM(currentWorld()) / 100));

  const syncHud = () => {
    setPhase(currentWorld().phase);
    if (depthRef.current) depthRef.current.textContent = `${Math.floor(distanceM(currentWorld()))}m`;
  };

  const doPause = () => {
    if (currentWorld().phase !== "run") return;
    pauseWorld();
    syncHud();
  };

  const retry = () => {
    replaceWorld(createWorld(randomSeed()));
    milestoneRef.current = 0;
    recordRef.current = false;
    setBest(bestDepth());
    syncHud();
  };

  const startRun = () => {
    replaceWorld({ ...currentWorld(), phase: "run" });
    milestoneRef.current = 0;
    recordRef.current = false;
    blipStart();
    syncHud();
  };

  const close = () => {
    pauseWorld();
    onClose();
  };

  // 面板固定尺寸：dpr 只在挂载时设一次；焦点收进面板，键盘才归游戏
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = VIEW_W * dpr;
    canvas.height = VIEW_H * dpr;
    canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    panelRef.current?.focus();
  }, []);

  // RAF 循环：ready 画浮动、run 跑物理；paused/dead 不起循环（定格帧由下面的静态
  // effect 画）。死亡在帧内判出：响一声、记分、落最高纪录，然后停表。
  useEffect(() => {
    if (phase !== "run" && phase !== "ready") return;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const next = step(currentWorld(), { thrust: thrustRef.current }, now - last);
      last = now;
      replaceWorld(next);
      if (depthRef.current) depthRef.current.textContent = `${Math.floor(distanceM(next))}m`;
      if (next.phase === "dead") {
        thudDeath();
        submitDepth(distanceM(next));
        setBest(bestDepth());
        setPhase("dead");
        drawFrame(canvasRef.current, next);
        return;
      }
      const m = Math.floor(distanceM(next) / 100);
      if (m > milestoneRef.current) {
        milestoneRef.current = m;
        pingMilestone();
      }
      if (!recordRef.current && best > 0 && distanceM(next) > best) {
        recordRef.current = true;
        pingRecord();
      }
      drawFrame(canvasRef.current, next);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase, best]);

  // 非 ready/run 相位画一帧定格（暂停/结束/重开都经这里）
  useEffect(() => {
    if (phase !== "run" && phase !== "ready") drawFrame(canvasRef.current, currentWorld());
  }, [phase]);

  // 主题切换补一次定格重画（themeColors 按 data-theme 缓存，切换后这里触发重读）
  useEffect(() => {
    const obs = new MutationObserver(() => drawFrame(canvasRef.current, currentWorld()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  // 随时暂停的另一半：焦点离开面板或窗口隐藏都定格
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) doPause();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onThrustDown = () => {
    primeAudio();
    if (currentWorld().phase === "dead") {
      retry();
      return;
    }
    if (currentWorld().phase === "ready") startRun();
    thrustRef.current = true;
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (currentWorld().phase === "run") doPause();
      else close();
      return;
    }
    if (!THRUST_KEYS.has(e.key)) return;
    e.preventDefault();
    if (e.repeat) return;
    if (currentWorld().phase === "paused") {
      resumeWorld();
      syncHud();
      return;
    }
    onThrustDown();
  };

  const onKeyUp = (e: ReactKeyboardEvent) => {
    if (THRUST_KEYS.has(e.key)) thrustRef.current = false;
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (currentWorld().phase === "paused") {
      resumeWorld();
      syncHud();
      return;
    }
    onThrustDown();
  };

  const onPointerUp = () => {
    thrustRef.current = false;
  };

  return (
    <div
      ref={panelRef}
      className={css.panel}
      role="dialog"
      aria-label="DeepDiving"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={doPause}
    >
      <canvas
        ref={canvasRef}
        className={css.canvas}
        aria-hidden
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className={css.hud}>
        <div className={css.hudTop}>
          <span ref={depthRef} className={css.hudDepth}>0m</span>
          <div className={css.hudBtns}>
            <button
              type="button"
              className={css.hudBtn}
              aria-label={t("提示音")}
              aria-pressed={sound}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const on = !sound;
                setSoundOn(on);
                setSound(on);
              }}
            >
              {sound ? <Volume2 size={14} /> : <VolumeX size={14} />}
            </button>
            <button
              type="button"
              className={css.hudBtn}
              aria-label={t("关闭")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={close}
            >
              <X size={14} />
            </button>
          </div>
        </div>
        <div className={css.hudBest}>{tt("最佳 {m} 米", "Best {m} m", { m: best })}</div>
        {phase === "ready" && (
          <div className={css.hint}>{t("按住上浮，松开下潜")}</div>
        )}
        {phase === "paused" && (
          <PausedOverlay
            onResume={() => {
              resumeWorld();
              syncHud();
            }}
            onClose={close}
          />
        )}
        {phase === "dead" && (
          <DeadOverlay
            meters={Math.floor(distanceM(currentWorld()))}
            best={best}
            onRetry={retry}
            onClose={close}
          />
        )}
        {phase === "dead" && (
          <div className={css.ov}>
            <div className={css.ovDepth}>{Math.floor(distanceM(currentWorld()))}m</div>
            <div className={css.ovBest}>{tt("最佳 {m} 米", "Best {m} m", { m: best })}</div>
            <div className={css.ovRow}>
              <button
                type="button"
                className={css.ovBtn}
                onMouseDown={(e) => e.preventDefault()}
                onClick={retry}
              >
                {t("再来")}
              </button>
              <button
                type="button"
                className={css.ovBtn}
                onMouseDown={(e) => e.preventDefault()}
                onClick={close}
              >
                {t("关闭")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
