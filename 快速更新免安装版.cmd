@echo off
chcp 65001 >nul
title 快速更新 东方桃图吧大书库（免安装版）
cd /d "%~dp0"

echo.
echo 将执行：构建免安装 exe - 覆盖本机便携目录（默认不改版本号，不生成安装包）
echo 如果应用正在运行，请先关闭它。
echo.
echo 用法：
echo   直接双击                              保持当前版本快速更新
echo   快速更新免安装版.cmd --version 0.1.11  改版本并更新
echo   快速更新免安装版.cmd --check           构建前跑完整检查
echo.

node scripts/release.mjs quick %*
set "CODE=%ERRORLEVEL%"

echo.
if "%CODE%"=="0" (
  echo 完成：本机免安装版已更新。
) else (
  echo 失败（退出码 %CODE%）：请看上面的提示。
)
pause
exit /b %CODE%
