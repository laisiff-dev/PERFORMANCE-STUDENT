@echo off
chcp 65001 >nul
echo ==================================================================
echo   輔英科技大學 三大來源 LOOK 檢視與每週自動更新工具
echo   (1. 個人雲端硬碟/行政會議檔案夾  2. 學校公開網頁  3. 系上公開網頁)
echo ==================================================================
python "%~dp0schedule_updater.py" --run-now
python "%~dp0copy_to_root.py"
echo.
echo 更新與加密封裝完成！
pause
