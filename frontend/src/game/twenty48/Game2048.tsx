// 2048 游戏面板（经典黑白）：命令面板入口（流末 loader 是 DeepDiving 的），挂载壳
// Game2048Host 挂 App 根部。键盘焦点收在面板（tabIndex=-1）：方向键/WASD 走子，
// Esc 直接关（回合制无暂停概念）；棋局在 store——关了再开续局。分数/最高分落
// store（localStorage）。RAF 只在浮层开着时跑：每帧重画棋盘，滑动补间由 render
// 按 moveAt 时间戳算（回合制不需要暂停循环）。
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Volume2, VolumeX, X } from "lucide-react";
import { tt, useT } from "../../i18n";
import { DD_EVENTS, dispatchAppEvent } from "../../events";
import { blipMerge, pingRecord, primeAudio, thudDeath } from "../audio";
import { setSoundOn, soundOn } from "../soundPref";
import { bestScore, currentGame, newGame, register2048, replaceGame, submitScore } from "./store";
import { drawBoard, BOARD_PX } from "./render";
import { step, type Dir, type GameState, type Move } from "./world";
import css from "./Game2048.module.css";
import { GlassLayer } from "../../components/GlassLayer";

/** App 根部挂一次：消费 openGame2048 请求；浮层出现时复位 hover（命令面板同一条事件）。 */
export function Game2048Host() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    register2048(() => setOpen(true));
    return () => register2048(null);
  }, []);
  useEffect(() => {
    if (open) dispatchAppEvent(DD_EVENTS.commandPalette);
  }, [open]);
  return open ? <Game2048 onClose={() => setOpen(false)} /> : null;
}

// 方向键 + WASD 走子（bare 键与全局键位无冲突——useAppKeybinds 只派发组合键）
const DIR_KEYS = new Map<string, Dir>([
  ["ArrowLeft", "left"], ["ArrowRight", "right"], ["ArrowUp", "up"], ["ArrowDown", "down"],
  ["a", "left"], ["d", "right"], ["w", "up"], ["s", "down"],
]);

export function Game2048({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const [game, setGame] = useState<GameState>(() => currentGame());
  const [sound, setSound] = useState(() => soundOn());
  const [wonOpen, setWonOpen] = useState(false);
  const [moved, setMoved] = useState(false); // 开局操作提示只到第一步
  const panelRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const moveAtRef = useRef(0);
  const movesRef = useRef<Move[]>([]);
  const spawnRef = useRef<{ at: number; value: number } | null>(null);

  const dpr = useRef(1);

  // 面板固定尺寸：dpr 只在挂载时设一次；焦点收进面板，键盘才归游戏
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    dpr.current = window.devicePixelRatio || 1;
    canvas.width = BOARD_PX * dpr.current;
    canvas.height = BOARD_PX * dpr.current;
    canvas.getContext("2d")?.setTransform(dpr.current, 0, 0, dpr.current, 0, 0);
    panelRef.current?.focus();
  }, []);

  // RAF：浮层开着就每帧重画（补间由 render 按 moveAt 算，静止时零成本重复画）
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      drawBoard(canvasRef.current, {
        board: currentGame().board,
        moves: movesRef.current,
        spawn: spawnRef.current,
        moveAt: moveAtRef.current,
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const doNewGame = () => {
    newGame();
    setGame(currentGame());
    setWonOpen(false);
    moveAtRef.current = 0;
    movesRef.current = [];
    spawnRef.current = null;
    setMoved(false);
  };

  const move = (dir: Dir) => {
    const cur = currentGame();
    if (cur.status === "over") return;
    const res = step(cur, dir);
    if (!res.changed) return;
    replaceGame(res.next);
    setGame(res.next);
    submitScore(res.next.score);
    moveAtRef.current = performance.now();
    movesRef.current = res.moves;
    spawnRef.current = res.spawn;
    setMoved(true);
    if (res.gained > 0) blipMerge();
    if (res.next.status === "over") thudDeath();
    if (res.next.won && !cur.won) {
      pingRecord();
      setWonOpen(true);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    const dir = DIR_KEYS.get(e.key);
    if (!dir) return;
    e.preventDefault();
    primeAudio();
    move(dir);
  };

  return (
    <div
      ref={panelRef}
      className={css.panel}
      role="dialog"
      aria-label="2048"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <GlassLayer />
      <div className={css.hud}>
        <div className={css.scores}>
          <div className={css.scoreCol}>
            <span className={css.scoreLabel}>{t("分数")}</span>
            <span className={css.scoreValue}>{game.score}</span>
          </div>
          <div className={css.scoreCol}>
            <span className={css.scoreLabel}>{t("最佳")}</span>
            <span className={css.scoreValue}>{bestScore()}</span>
          </div>
        </div>
        <div className={css.hudBtns}>
          <button
            type="button"
            className={css.newBtn}
            aria-label={t("新的一局")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={doNewGame}
          >
            {t("新的一局")}
          </button>
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
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <canvas ref={canvasRef} className={css.board} aria-hidden />
      {!moved && (
        <div className={css.hint}>{t("方向键或 WASD 滑动，同数相合，凑出 2048")}</div>
      )}
      {game.status === "over" && (
        <div className={css.ov}>
          <div className={css.ovTitle}>{tt("本局 {s} 分", "Score {s}", { s: game.score })}</div>
          <div className={css.ovBest}>{tt("最佳 {s} 分", "Best {s}", { s: Math.max(bestScore(), game.score) })}</div>
          <div className={css.ovRow}>
            <button
              type="button"
              className={css.ovBtn}
              onMouseDown={(e) => e.preventDefault()}
              onClick={doNewGame}
            >
              {t("再来")}
            </button>
            <button
              type="button"
              className={css.ovBtn}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onClose}
            >
              {t("关闭")}
            </button>
          </div>
        </div>
      )}
      {wonOpen && game.status !== "over" && (
        <div className={css.ov}>
          <div className={css.ovTitle}>2048</div>
          <div className={css.ovBest}>{t("成 2048 了，还能继续")}</div>
          <div className={css.ovRow}>
            <button
              type="button"
              className={css.ovBtn}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setWonOpen(false)}
            >
              {t("继续")}
            </button>
            <button
              type="button"
              className={css.ovBtn}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onClose}
            >
              {t("关闭")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
