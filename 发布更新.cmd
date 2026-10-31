@echo off
chcp 65001 >nul
title 更新 东方桃图吧大书库（安装版 + 免安装版）
cd /d "%~dp0"

echo.
echo 将执行：校验 - 构建 - 覆盖安装版 - 刷新 dist\portable - 同步便携镜像 - 核对版本
echo 如果应用正在运行，请先关闭它。
echo.

corepack pnpm release
set "CODE=%ERRORLEVEL%"

echo.
if "%CODE%"=="0" (
  echo 完成：安装版、免安装版与便携镜像都已更新。
) else (
  echo 失败（退出码 %CODE%）：请看上面的提示。
)
pause
exit /b %CODE%
