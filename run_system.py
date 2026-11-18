import os
import sys
import json
import hmac
import secrets
import argparse
import urllib.parse
from typing import Any
from http.server import HTTPServer, SimpleHTTPRequestHandler

sys.path.append(os.path.dirname(__file__))
from awards_system import FooyinAwardsManager
from schedule_updater import FooyinWeeklyUpdater, save_sources_config
from notification_service import StudentNotificationService
from security_crypto import deidentify_records, DEFAULT_ADMIN_PASSPHRASE
from embed_data import build_secure_data_js

DEFAULT_PORT = 8000
WEB_DIR = os.path.join(os.path.dirname(__file__), "web")
ACTIVE_ADMIN_TOKENS = set()


class FooyinAPIHandler(SimpleHTTPRequestHandler):
    """輔英科技大學 學生獲獎管理與領獎通知 Web API 服務器 (含個資保護與管理員授權驗證)"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Robots-Tag", "noindex, nofollow, noarchive")
        self.send_header("Cache-Control", "no-cache, must-revalidate")
        super().end_headers()

    def is_admin_authorized(self) -> bool:
        auth_header = self.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
            if token and token in ACTIVE_ADMIN_TOKENS:
                return True
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        q_token = (qs.get("token") or [""])[0]
        return bool(q_token and q_token in ACTIVE_ADMIN_TOKENS)

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        is_admin = self.is_admin_authorized()

        if path == "/api/awards":
            data = mgr.records if is_admin else deidentify_records(mgr.records)
            self.send_json_response(data)
        elif path == "/api/report":
            self.send_json_response(mgr.generate_ir_report())
        elif path == "/api/sources-status":
            self.send_json_response(updater.inspect_sources_status())
        elif path == "/api/diff-analysis":
            self.send_json_response(updater.get_diff_analysis_with_template(public_mode=not is_admin))
        elif path == "/api/unapplied-students":
            self.send_json_response(mgr.get_unapplied_students(public_mode=not is_admin))
        elif path == "/api/export/csv":
            self.handle_export_csv(public_mode=not is_admin)
        elif path == "/api/export/112-114-csv":
            self.handle_export_112_114_csv(public_mode=not is_admin)
        elif path == "/api/export/112-114-excel":
            self.handle_export_112_114_excel(public_mode=not is_admin)
        elif path == "/api/download-template":
            self.handle_download_template()
        else:
            super().do_GET()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else "{}"
        try:
            payload = json.loads(body)
        except Exception:
            payload = {}

        if path == "/api/admin/unlock":
            pw = str(payload.get("passphrase", ""))
            if hmac.compare_digest(pw.encode("utf-8"), admin_passphrase.encode("utf-8")):
                token = secrets.token_urlsafe(32)
                ACTIVE_ADMIN_TOKENS.add(token)
                self.send_json_response({"status": "success", "token": token})
            else:
                self.send_json_response({"status": "error", "message": "管理員通行密碼錯誤"}, status=403)
            return

        if path == "/api/admin/lock":
            auth_header = self.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                ACTIVE_ADMIN_TOKENS.discard(auth_header[7:].strip())
            self.send_json_response({"status": "success"})
            return

        # 以下為涉及資料庫寫入或學生個資通知之受保護端點
        if not self.is_admin_authorized():
            self.send_json_response(
                {"status": "error", "message": "此操作涉及學生個資與系統寫入，請先點選右上角『個資保護模式』完成管理員解鎖。"},
                status=401,
            )
            return

        if path == "/api/trigger-weekly-update":
            result = updater.run_update_pipeline()
            build_secure_data_js(passphrase=admin_passphrase)
            self.send_json_response(result)
        elif path == "/api/sources-config":
            save_sources_config(payload)
            updater.reload_config()
            build_secure_data_js(passphrase=admin_passphrase)
            self.send_json_response({"status": "success", "config": updater.inspect_sources_status()})
        elif path == "/api/dispatch-notification":
            record_id = payload.get("record_id")
            if record_id:
                result = notifier.dispatch_notification(int(record_id))
            else:
                result = notifier.batch_dispatch_pending_notifications()
            build_secure_data_js(passphrase=admin_passphrase)
            self.send_json_response(result)
        elif path == "/api/dispatch-unapplied-reminder":
            record_id = payload.get("record_id")
            if record_id:
                result = notifier.dispatch_unapplied_reminder(int(record_id))
            else:
                result = notifier.batch_dispatch_unapplied_reminders()
            build_secure_data_js(passphrase=admin_passphrase)
            self.send_json_response(result)
        elif path == "/api/update-status":
            record_id = payload.get("record_id")
            new_status = payload.get("status")
            if record_id and new_status:
                success = mgr.update_status(int(record_id), new_status)
                if success:
                    build_secure_data_js(passphrase=admin_passphrase)
                self.send_json_response({"status": "success" if success else "error"})
            else:
                self.send_json_response({"status": "error", "message": "缺少必要參數"}, status=400)
        elif path == "/api/add-award":
            new_rec = mgr.add_record(payload)
            build_secure_data_js(passphrase=admin_passphrase)
            self.send_json_response({"status": "success", "record": new_rec})
        elif path == "/api/import-awards":
            records_to_import = payload.get("records", [])
            result = mgr.import_records(records_to_import)
            build_secure_data_js(passphrase=admin_passphrase)
            self.send_json_response(result)
        elif path == "/api/delete-award":
            record_ids = payload.get("record_ids")
            if isinstance(record_ids, list) and len(record_ids) > 0:
                result = mgr.delete_records(record_ids)
                if result.get("deleted_count", 0) > 0:
                    build_secure_data_js(passphrase=admin_passphrase)
                self.send_json_response(result)
            else:
                record_id = payload.get("record_id")
                custom_id = payload.get("custom_id")
                if record_id is not None or custom_id:
                    removed = mgr.delete_record(record_id, custom_id=custom_id)
                    if removed is not None:
                        build_secure_data_js(passphrase=admin_passphrase)
                        self.send_json_response({
                            "status": "success",
                            "deleted_count": 1,
                            "current_total_records": len(mgr.records),
                        })
                    else:
                        self.send_json_response({"status": "error", "message": "找不到指定之獲獎紀錄"}, status=404)
                else:
                    self.send_json_response({"status": "error", "message": "缺少 record_id 參數"}, status=400)
        else:
            self.send_json_response({"error": "找不到此 API 端點"}, status=404)

    def send_json_response(self, data: Any, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def handle_export_csv(self, public_mode: bool = True):
        tmp_file = os.path.join(os.path.dirname(__file__), "tmp_export_awards.csv")
        try:
            mgr.export_data(tmp_file, public_mode=public_mode)
            with open(tmp_file, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8-sig")
            suffix = "public_masked" if public_mode else "admin_full"
            self.send_header("Content-Disposition", f"attachment; filename=fooyin_student_awards_{suffix}.csv")
            self.end_headers()
            self.wfile.write(content)
        finally:
            if os.path.exists(tmp_file):
                os.remove(tmp_file)

    def handle_export_112_114_csv(self, public_mode: bool = True):
        tmp_file = os.path.join(os.path.dirname(__file__), "tmp_112_114_export.csv")
        try:
            mgr.export_112_114_template_csv(tmp_file, public_mode=public_mode)
            with open(tmp_file, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8-sig")
            self.send_header("Content-Disposition", "attachment; filename=112-114_academic_year_awards.csv")
            self.end_headers()
            self.wfile.write(content)
        finally:
            if os.path.exists(tmp_file):
                os.remove(tmp_file)

    def handle_export_112_114_excel(self, public_mode: bool = True):
        tmp_file = os.path.join(os.path.dirname(__file__), "tmp_112_114_export.xlsx")
        try:
            mgr.export_112_114_template_excel(tmp_file, public_mode=public_mode)
            with open(tmp_file, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            self.send_header("Content-Disposition", "attachment; filename=112-114_academic_year_awards.xlsx")
            self.end_headers()
            self.wfile.write(content)
        finally:
            if os.path.exists(tmp_file):
                os.remove(tmp_file)

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
    global mgr, updater, notifier, admin_passphrase
    parser = argparse.ArgumentParser(description="輔英科技大學 學生獲獎管理 Web 伺服器")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="綁定主機位址 (預設 127.0.0.1 僅限本機安全存取)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="連接埠 (預設 8000)")
    parser.add_argument("--passphrase", type=str, default=DEFAULT_ADMIN_PASSPHRASE, help="管理員解鎖密碼")
    args = parser.parse_args()

    admin_passphrase = args.passphrase
    mgr = FooyinAwardsManager()
    updater = FooyinWeeklyUpdater(mgr)
    notifier = StudentNotificationService(mgr)

    server = HTTPServer((args.host, args.port), FooyinAPIHandler)
    print("==========================================================")
    print(" 輔英科技大學 學生獲獎紀錄與領獎通知管理 Web 系統 (資安強化版)")
    print(f" 本地安全存取網址: http://{args.host}:{args.port}/")
    print(" 預設狀態: 公開去識別化遮罩模式 (管理員解鎖後方可檢視完整個資)")
    print("==========================================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n伺服器已安全停止。")


if __name__ == "__main__":
    run_server()
