import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAppRuntimeInfo,
  hasTauriInvoke,
  resetAppRuntimeInfoCache,
  resolveRunMode,
} from '../src/platform/app-info.js';

describe('运行方式识别（安装版 / 免安装版）', () => {
  beforeEach(() => {
    resetAppRuntimeInfoCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetAppRuntimeInfoCache();
  });

  it('exe 位于注册表 InstallLocation 下 → 安装版', () => {
    expect(resolveRunMode('D:\\Touhou Peach Reader\\touhou-peach-reader.exe', 'D:\\Touhou Peach Reader')).toBe(
      'installed',
    );
  });

  it('\\?\\ 前缀与大小写、斜杠差异不影响判断', () => {
    expect(
      resolveRunMode('\\\\?\\d:/touhou peach reader/touhou-peach-reader.exe', 'D:\\Touhou Peach Reader\\'),
    ).toBe('installed');
  });

  it('exe 在 target/release 或 dist/portable → 免安装版', () => {
    expect(
      resolveRunMode('D:\\Work\\app\\apps\\desktop\\src-tauri\\target\\release\\touhou-peach-reader.exe', null),
    ).toBe('portable');
    expect(
      resolveRunMode(
        'D:\\Work\\app\\dist\\portable\\Touhou Peach Reader.exe',
        'D:\\Touhou Peach Reader',
      ),
    ).toBe('portable');
  });

  it('没装过安装版（install 为 null）时一律算免安装版', () => {
    expect(resolveRunMode('D:\\Touhou Peach Reader\\touhou-peach-reader.exe', null)).toBe('portable');
  });

  it('浏览器/Node 环境没有 Tauri invoke，运行时信息返回 null', async () => {
    expect(hasTauriInvoke()).toBe(false);
    await expect(getAppRuntimeInfo({ waitMs: 20, attempts: 1, timeoutMs: 100 })).resolves.toBeNull();
  });

  it('运行时信息只读取一次，设置页反复挂载不会重复 invoke', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'app_info') {
        return {
          version: '0.1.3',
          exePath: 'D:\\Touhou Peach Reader\\touhou-peach-reader.exe',
          dataDir: 'C:\\Users\\test\\AppData\\Roaming\\com.touhou.peachreader',
        };
      }
      return { location: 'D:\\Touhou Peach Reader', version: '0.1.3' };
    });
    vi.stubGlobal('window', { __TAURI_INTERNALS__: { invoke } });

    const first = getAppRuntimeInfo();
    const second = getAppRuntimeInfo();
    expect(second).toBe(first);

    const info = await first;
    expect(info?.mode).toBe('installed');
    expect(info?.install?.version).toBe('0.1.3');
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls.map((call) => String(call[0])).sort()).toEqual([
      'app_info',
      'install_info',
    ]);
  });
});
