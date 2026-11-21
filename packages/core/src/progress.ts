/**
 * 长任务进度模型（Goal 31）。
 *
 * 导入 / 合并 / 导出都是"多个阶段串起来的长任务"：解压、读包、写库、打包……
 * 每个阶段能给出的细分粒度不同（有的按条目、有的按语句、有的只能给"完成/未完成"）。
 * 这里把各阶段按权重合成一条总进度，并用"进度速率"推剩余时间：
 *
 *   rate = fraction / elapsed      // 每毫秒推进多少
 *   eta  = (1 - fraction) / rate   // 剩下的还要多久
 *
 * 速率做指数平滑（EMA），避免某一阶段瞬间冲刺把 ETA 抖成 0；样本不足时返回 null，
 * UI 就只显示进度条不显示剩余时间——比给一个假数字诚实。
 */

export type ProgressKind = 'import' | 'merge' | 'export' | 'download';

export interface ProgressUpdate {
  /** 任务种类，UI 用来选图标/标题 */
  readonly kind: ProgressKind;
  /** 当前阶段的人类可读描述，例如「正在解压」 */
  readonly label: string;
  /** 阶段内的细分说明，例如「128 / 1024 个文件」 */
  readonly detail?: string;
  /** 总进度 0..1 */
  readonly fraction: number;
  /** 已经过去的时间（毫秒） */
  readonly elapsedMs: number;
  /** 预计剩余时间（毫秒）；样本不足时为 null */
  readonly etaMs: number | null;
}

export type ProgressListener = (update: ProgressUpdate) => void;

export interface ProgressOptions {
  onProgress?: ProgressListener;
}

export interface ProgressPhase {
  /** 阶段标识，`ProgressRun#begin` 用它切阶段 */
  readonly key: string;
  /** 展示给用户的阶段名 */
  readonly label: string;
  /** 相对权重（正数）；总和不必是 1 */
  readonly weight: number;
}

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

/** 最小更新间隔：几十毫秒一次足够让进度条动得顺滑，又不会把 React 拖进每帧重渲染。 */
const EMIT_INTERVAL_MS = 90;
/** 进度太小时推出来的 ETA 全是噪声，直接不给。 */
const MIN_FRACTION_FOR_ETA = 0.03;
/** 刚开始那一下的速率样本同样不可信。 */
const MIN_ELAPSED_FOR_ETA_MS = 400;
/** 速率 EMA 的平滑系数：越大越跟手，越小越稳。 */
const RATE_SMOOTHING = 0.3;

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/**
 * 一次长任务的进度汇报器。
 *
 * 用法：
 * ```ts
 * const run = new ProgressRun('import', IMPORT_PHASES, opts.onProgress);
 * run.begin('extract');
 * await platform.zip.extractAll(zip, dir, { onProgress: (d, t) => run.progress(d, t) });
 * run.begin('write');
 * ...
 * run.finish();
 * ```
 */
export class ProgressRun {
  private readonly startedAt = now();
  private readonly phases: readonly ProgressPhase[];
  private readonly totalWeight: number;
  private readonly listener: ProgressListener | undefined;
  private readonly kind: ProgressKind;

  private index = 0;
  private sub = 0;
  private detailText: string | undefined;
  private lastEmitAt = 0;
  private lastFraction = 0;
  private rate: number | null = null;
  private etaMs: number | null = null;
  private finished = false;

  constructor(
    kind: ProgressKind,
    phases: readonly ProgressPhase[],
    listener: ProgressListener | undefined,
    /** 初始阶段 key；默认第一阶段 */
    startKey?: string,
  ) {
    const usable = phases.filter((phase) => phase.weight > 0);
    this.kind = kind;
    this.phases = usable.length > 0 ? usable : [{ key: 'work', label: '处理中', weight: 1 }];
    this.totalWeight = this.phases.reduce((sum, phase) => sum + phase.weight, 0);
    this.listener = listener;
    if (startKey !== undefined) {
      const found = this.phases.findIndex((phase) => phase.key === startKey);
      if (found >= 0) this.index = found;
    }
  }

  /** 总进度 0..1 */
  get fraction(): number {
    return this.fractionAt(this.index, this.sub);
  }

  get elapsedMs(): number {
    return now() - this.startedAt;
  }

  /** 切到某个阶段（传 phase key），并把该阶段进度归零。 */
  begin(key: string, detail?: string): void {
    const found = this.phases.findIndex((phase) => phase.key === key);
    if (found >= 0) {
      this.index = found;
      this.sub = 0;
    }
    this.detailText = detail;
    this.publish(true);
  }

  /** 阶段内进度 0..1（读包、写库这类能按条目/语句数上报的阶段用）。 */
  set(part: number): void {
    const next = clamp01(part);
    // 进度只前进不后退：同一阶段里 done 偶尔回退（重试条目）不该让进度条倒着走
    this.sub = Math.max(this.sub, next);
    this.publish(false);
  }

  /** `set(done / total)` 的语法糖；total 为 0 时当作不确定进度。 */
  progress(done: number, total: number): void {
    if (total <= 0) return;
    this.set(done / total);
  }

  /** 阶段内的细分说明；相同文本不会触发重发。 */
  detail(text: string): void {
    if (this.detailText === text) return;
    this.detailText = text;
    this.publish(false);
  }

  /** 当前进度快照（不触发回调），UI 需要立刻读一次时用。 */
  snapshot(): ProgressUpdate {
    return {
      kind: this.kind,
      label: this.phases[this.index]?.label ?? '处理中',
      ...(this.detailText !== undefined ? { detail: this.detailText } : {}),
      fraction: this.fraction,
      elapsedMs: this.elapsedMs,
      etaMs: this.etaMs,
    };
  }

  /** 收尾：强制推到 100%，并把剩余时间归零。 */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.index = this.phases.length - 1;
    this.sub = 1;
    this.etaMs = 0;
    this.detailText = undefined;
    this.lastFraction = 1;
    this.listener?.({
      kind: this.kind,
      label: this.phases[this.index]?.label ?? '完成',
      fraction: 1,
      elapsedMs: this.elapsedMs,
      etaMs: 0,
    });
  }

  private fractionAt(index: number, sub: number): number {
    let before = 0;
    for (let i = 0; i < index && i < this.phases.length; i += 1) {
      before += this.phases[i]?.weight ?? 0;
    }
    const weight = this.phases[index]?.weight ?? 0;
    return clamp01((before + weight * clamp01(sub)) / this.totalWeight);
  }

  /** 用当前进度刷新速率样本与 ETA，然后按节流窗口决定要不要推给 UI。 */
  private publish(force: boolean): void {
    if (!this.listener) return;
    const elapsed = this.elapsedMs;
    const fraction = this.fraction;
    if (elapsed >= MIN_ELAPSED_FOR_ETA_MS && fraction >= MIN_FRACTION_FOR_ETA) {
      const instant = fraction / elapsed;
      this.rate = this.rate === null ? instant : this.rate + (instant - this.rate) * RATE_SMOOTHING;
      this.etaMs = this.rate > 0 ? Math.max(0, (1 - fraction) / this.rate) : null;
    }
    this.lastFraction = fraction;

    if (!force && now() - this.lastEmitAt < EMIT_INTERVAL_MS) return;
    this.lastEmitAt = now();
    this.listener(this.snapshot());
  }
}

/** ETA 的兜底展示文本；UI 层也可直接用自己的格式化。 */
export function describeEta(etaMs: number | null): string {
  if (etaMs === null || !Number.isFinite(etaMs)) return '估算中…';
  if (etaMs <= 500) return '马上就好';
  const seconds = Math.ceil(etaMs / 1000);
  if (seconds < 60) return `约 ${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `约 ${minutes} 分钟` : `约 ${minutes} 分 ${rest} 秒`;
}
