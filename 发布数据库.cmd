@echo off
chcp 65001 >nul
title 上传数据库到 GitHub Release
cd /d "%~dp0"

echo.
echo 把自选的 .tpr 数据库发布到 GitHub Release。
echo 没给文件路径时会弹出文件选择框；也可以直接把 .tpr 拖到这个 .cmd 上。
echo.

node scripts/publish-db.mjs %*
set "CODE=%ERRORLEVEL%"

echo.
if "%CODE%"=="0" (
  echo 完成（详见上面输出）。
) else (
  echo 失败（退出码 %CODE%）：请看上面的提示。
)
pause
exit /b %CODE%
