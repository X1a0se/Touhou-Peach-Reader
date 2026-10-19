import { useServices } from '../context.js';
import { useSettingsContext } from '../settings/SettingsProvider.js';

export interface WallpaperLayerProps {
  /** 主界面用 home，文章详情页用 article（两处互不影响） */
  slot: 'home' | 'article';
}

/**
 * 壁纸层（Goal 14）：固定铺满视口、不拦截点击，叠加渐变保证正文可读。
 * 没设置壁纸时不渲染任何东西。
 */
export function WallpaperLayer({ slot }: WallpaperLayerProps) {
  const services = useServices();
  const { settings } = useSettingsContext();
  const wallpaper = settings.wallpapers[slot];
  const url = wallpaper.file === '' ? '' : services.platform.wallpapers.toUrl(wallpaper.file);

  if (url === '') return null;

  return (
    <div
      aria-hidden
      className="tpr-wallpaper"
      style={{
        backgroundImage: `url("${url}")`,
        opacity: wallpaper.opacity,
        filter: wallpaper.blur > 0 ? `blur(${wallpaper.blur}px)` : undefined,
        transform: wallpaper.blur > 0 ? 'scale(1.06)' : undefined,
      }}
    />
  );
}
