import os
import sys
import json
import urllib.parse
from typing import Any
from http.server import HTTPServer, SimpleHTTPRequestHandler

# 載入核心模組
sys.path.append(os.path.dirname(__file__))
from awards_system import FooyinAwardsManager
from schedule_updater import FooyinWeeklyUpdater
from notification_service import StudentNotificationService

PORT = 8000
WEB_DIR = os.path.join(os.path.dirname(__file__), "web")

class FooyinAPIHandler(SimpleHTTPRequestHandler):
    """輔英科技大學 學生獲獎管理與領獎通知 Web API 服務器"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        if path == "/api/awards":
            self.send_json_response(mgr.records)
        elif path == "/api/report":
            self.send_json_response(mgr.generate_ir_report())
        elif path == "/api/diff-analysis":
            self.send_json_response(updater.get_diff_analysis_with_template())
        elif path == "/api/unapplied-students":
            self.send_json_response(mgr.get_unapplied_students())
        elif path == "/api/export/csv":
            self.handle_export_csv()
        elif path == "/api/export/112-114-csv":
            self.handle_export_112_114_csv()
        elif path == "/api/export/112-114-excel":
            self.handle_export_112_114_excel()
        elif path == "/api/download-template":
            self.handle_download_template()
        else:
            # 預設發送靜態 Web 檔案 (index.html, styles.css, app.js 等)
            super().do_GET()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else "{}"
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}

        if path == "/api/trigger-weekly-update":
            result = updater.run_update_pipeline()
            self.send_json_response(result)
        elif path == "/api/dispatch-notification":
            record_id = payload.get("record_id")
            if record_id:
                result = notifier.dispatch_notification(int(record_id))
            else:
                result = notifier.batch_dispatch_pending_notifications()
            self.send_json_response(result)
        elif path == "/api/dispatch-unapplied-reminder":
            record_id = payload.get("record_id")
            if record_id:
                result = notifier.dispatch_unapplied_reminder(int(record_id))
            else:
                result = notifier.batch_dispatch_unapplied_reminders()
            self.send_json_response(result)
        elif path == "/api/update-status":
            record_id = payload.get("record_id")
            new_status = payload.get("status")
            if record_id and new_status:
                success = mgr.update_status(int(record_id), new_status)
                self.send_json_response({"status": "success" if success else "error"})
            else:
                self.send_json_response({"status": "error", "message": "缺少必要參數"}, status=400)
        elif path == "/api/add-award":
            new_rec = mgr.add_record(payload)
            self.send_json_response({"status": "success", "record": new_rec})
        elif path == "/api/import-awards":
            records_to_import = payload.get("records", [])
            # 檢測是否為 112-114 模版格式 (含識別號或活動類別)
            converted_records = []
            for item in records_to_import:
                if "學生所屬系科 - 系所代碼" in item or "活動類別" in item:
                    converted_records.append(mgr.from_112_114_format(item))
                else:
                    converted_records.append(item)
            result = mgr.import_records(converted_records)
            self.send_json_response(result)
        else:
            self.send_json_response({"error": "找不到此 API 端點"}, status=404)

    def send_json_response(self, data: Any, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))

    def handle_export_csv(self):
        csv_path = os.path.join(os.path.dirname(__file__), "fooyin_student_awards_standardized.csv")
        if os.path.exists(csv_path):
            with open(csv_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", "attachment; filename=fooyin_student_awards.csv")
            self.end_headers()
            self.wfile.write(content)
        else:
            self.send_error(404, "CSV file not found")

    def handle_export_112_114_csv(self):
        tmp_file = os.path.join(os.path.dirname(__file__), "112-114學年度填報資料_匯出.csv")
        mgr.export_112_114_template_csv(tmp_file)
        if os.path.exists(tmp_file):
            with open(tmp_file, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8-sig")
            self.send_header("Content-Disposition", "attachment; filename=112-114_academic_year_awards.csv")
            self.end_headers()
            self.wfile.write(content)

    def handle_export_112_114_excel(self):
        tmp_file = os.path.join(os.path.dirname(__file__), "112-114學年度填報資料_匯出.xlsx")
        mgr.export_112_114_template_excel(tmp_file)
        if os.path.exists(tmp_file):
            with open(tmp_file, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            self.send_header("Content-Disposition", "attachment; filename=112-114_academic_year_awards.xlsx")
            self.end_headers()
            self.wfile.write(content)

    def handle_download_template(self):
        xls_path = os.path.join(os.path.dirname(__file__), "112-114學年度填報資料.xls")
        if os.path.exists(xls_path):
            with open(xls_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.ms-excel")
            self.send_header("Content-Disposition", "attachment; filename=112-114_reporting_template.xls")
            self.end_headers()
            self.wfile.write(content)
        else:
            self.send_error(404, "Template file not found")



def run_server():
    global mgr, updater, notifier
    mgr = FooyinAwardsManager()
    updater = FooyinWeeklyUpdater(mgr)
    notifier = StudentNotificationService(mgr)

    server = HTTPServer(('0.0.0.0', PORT), FooyinAPIHandler)
    print("==========================================================")
    print(f" 輔英科技大學 學生獲獎紀錄與領獎通知管理 Web 系統 啟動中...")
    print(f" 本地存取網址: http://localhost:{PORT}/")
    print(f" Web 介面目錄: {WEB_DIR}")
    print("==========================================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n伺服器已安全停止。")

if __name__ == "__main__":
    run_server()
