import { cn } from '@tpr/ui';
import { useState } from 'react';
import { useSettingsContext } from '../settings/SettingsProvider.js';

export interface CompressImagesSwitchProps {
  /** 紧凑模式：用于表单内的小行，不占整块 */
  compact?: boolean;
  className?: string;
}

/**
 * 上传图片压缩开关。图片页与新建/编辑表单共用同一个全局设置，
 * 所以这里不保存“一次性的临时选择”，切换后立即落库。
 */
export function CompressImagesSwitch({ compact = false, className }: CompressImagesSwitchProps) {
  const { settings, ready, save } = useSettingsContext();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = async (checked: boolean): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await save({ compressImages: checked });
    } catch (cause) {
      setError(`保存开关失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <label
      className={cn(
        'flex justify-between gap-3 border-border bg-surface/60',
        compact
          ? 'items-center rounded-lg border px-2.5 py-1.5'
          : 'items-start gap-4 rounded-lg border px-3 py-2.5',
        className,
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={compact ? 'text-xs font-medium text-foreground' : 'text-sm font-medium text-foreground'}>
          压缩上传图片
        </span>
        <span className="text-xs text-muted-foreground">
          {compact
            ? 'PNG/JPEG 转 WebP（最长边 2560），GIF/WebP 保持原样。'
            : '开启后 PNG/JPEG 会转成 WebP（最长边 2560），GIF/WebP 保持原样；关闭后按原图保存。'}
        </span>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-label="压缩上传图片"
        aria-checked={settings.compressImages}
        className={cn(
          'shrink-0 accent-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50',
          compact ? 'mt-0 h-4 w-4' : 'mt-1 h-5 w-5',
        )}
        checked={settings.compressImages}
        disabled={!ready || saving}
        onChange={(event) => {
          void change(event.target.checked);
        }}
      />
    </label>
  );
}
