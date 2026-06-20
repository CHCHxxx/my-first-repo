@echo off
chcp 65001 >nul
cd /d "%~dp0\.."

echo ============================================
echo   微博 → 百度网盘 自动转存 - 安装脚本
echo ============================================
echo.

echo [1/3] 检查 Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo 错误：未找到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)
echo Node.js 版本:
node --version
echo.

echo [2/3] 安装依赖 (puppeteer)...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo 错误：npm install 失败
    pause
    exit /b 1
)
echo.

echo [3/3] 注册 Windows 计划任务（每天 12:00 运行）...
schtasks /Create /SC DAILY /TN "WeiboBaiduPanAutomation" /TR "node %CD%\src\index.js" /ST 12:00 /F 2>nul
if %ERRORLEVEL% EQU 0 (
    echo 计划任务创建成功！
) else (
    echo 计划任务创建失败，请尝试以管理员身份运行此脚本。
    echo 或手动执行:
    echo   schtasks /Create /SC DAILY /TN "WeiboBaiduPanAutomation" /TR "node %CD%\src\index.js" /ST 12:00 /F
)
echo.

echo ============================================
echo 安装完成！
echo.
echo 下一步：
echo   1. 运行 setup\first-login.bat 登录百度网盘
echo   2. 可选：运行 node src\index.js 测试
echo ============================================
echo.

pause
