@echo off
chcp 65001 >nul
cd /d "%~dp0\.."

echo ============================================
echo   百度网盘首次登录
echo ============================================
echo.
echo 即将打开浏览器窗口...
echo 请在浏览器中手动登录你的百度网盘账号。
echo 登录成功后，直接关闭浏览器窗口即可。
echo.
echo 按任意键开始...
pause >nul

node src/login-helper.js

echo.
echo 登录设置完成！
echo 现在可以运行 node src/index.js 来测试完整流程。
pause
