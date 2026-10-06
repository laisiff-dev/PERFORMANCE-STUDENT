import os
import sys
import json
import datetime
import argparse
from typing import List, Dict, Any, Optional

# 匯入核心管理元件
sys.path.append(os.path.dirname(__file__))
from awards_system import FooyinAwardsManager, JSON_FILE

NOTIFICATION_LOG = os.path.join(os.path.dirname(__file__), "notification.log")

class StudentNotificationService:
    """輔英科技大學 學生獲獎領獎通知與獎助金簽領管理系統"""

    def __init__(self, manager: FooyinAwardsManager):
        self.manager = manager

    def log_event(self, event_str: str):
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        entry = f"[{timestamp}] [領獎通知服務] {event_str}"
        print(entry)
        with open(NOTIFICATION_LOG, "a", encoding="utf-8") as f:
            f.write(entry + "\n")

    def generate_email_content(self, record: Dict[str, Any]) -> str:
        """生成學生 Email 領獎通知書內容"""
        student_name = record.get("獲獎學生", "同學")
        student_id = record.get("學生學號", "未填寫")
        event_name = record.get("競賽或活動名稱", "榮譽賽事")
        work_name = record.get("參賽項目或作品名稱", "")
        award_rank = record.get("榮譽獎項", "獲獎榮譽")
        amount = record.get("獎助金金額", 0)
        deadline = record.get("領獎截止日期", "本月底")
        claim_url = f"https://portal.fooyin.edu.tw/awards/claim?id={record.get('編號')}&stuid={student_id}"

        content = f"""
===================================================================
【輔英科技大學 學術獲獎與獎助學金領獎通知信】
===================================================================
親愛的 {student_name} 同學（學號：{student_id}）您好：

恭喜您在【{event_name}】作品《{work_name}》中，榮獲『{award_rank}』佳績！
學校為表彰您的優異表現，特頒發獎助學金新臺幣 NT$ {amount:,} 元。

請您於【{deadline}】前，點擊下方數位簽領連結完成領獎資料確認與撥款帳戶核對：

【線上簽領與獎助金撥款連結】: {claim_url}

注意事項：
1. 請確認個人校園 Portal 中匯款銀行帳戶資訊正確無誤。
2. 如需檢視原始賽事佐證，可至本校學生獲獎紀錄系統查詢。

輔英科技大學 教務處 / 校務研究 (IR) 發展中心 敬啟
聯絡電話: (07) 781-1151 轉 2100
===================================================================
"""
        return content.strip()

    def generate_line_message(self, record: Dict[str, Any]) -> str:
        """生成 LINE Notify 快速通知訊息"""
        return (
            f"【輔英獲獎與領獎通知】\n"
            f"恭喜 {record.get('獲獎學生')} 同學於「{record.get('競賽或活動名稱')}」榮獲【{record.get('榮譽獎項')}】！\n"
            f"獎助金金額: NT$ {record.get('獎助金金額', 0):,} 元\n"
            f"領獎截止日: {record.get('領獎截止日期')}\n"
            f"簽領連結: https://portal.fooyin.edu.tw/awards/claim?id={record.get('編號')}"
        )

    def dispatch_notification(self, record_id: int, channel: str = "email") -> Dict[str, Any]:
        """單筆發送通知並更新狀態為『通知已發送』"""
        record = None
        for r in self.manager.records:
            if r.get("編號") == record_id:
                record = r
                break

        if not record:
            return {"status": "error", "message": f"找不到編號 #{record_id} 之紀錄"}

        now_str = datetime.date.today().strftime("%Y-%m-%d")
        
        # 生成通知內容
        email_text = self.generate_email_content(record)
        line_text = self.generate_line_message(record)

        # 更新紀錄狀態
        self.manager.update_status(record_id, "通知已發送", notify_time=now_str)

        self.log_event(f"已發送領獎通知給 [{record.get('獲獎學生')}] (學號:{record.get('學生學號')}) - 賽事:{record.get('競賽或活動名稱')}")

        return {
            "status": "success",
            "record_id": record_id,
            "student_name": record.get("獲獎學生"),
            "channel": channel,
            "notify_time": now_str,
            "email_preview": email_text,
            "line_preview": line_text
        }

    def generate_unapplied_reminder_email(self, record: Dict[str, Any]) -> str:
        """生成『未申請/催辦獎補助金』學生專用提醒信內容"""
        student_name = record.get("獲獎學生", "同學")
        student_id = record.get("學生學號", "未填寫")
        event_name = record.get("競賽或活動名稱", "榮譽賽事")
        award_rank = record.get("榮譽獎項", "獲獎榮譽")
        amount = record.get("獎助金金額", 0)
        deadline = record.get("領獎截止日期", "2026-11-30")
        claim_url = f"https://portal.fooyin.edu.tw/awards/claim?id={record.get('編號')}&stuid={student_id}"

        content = f"""
===================================================================
【重要催辦提醒】輔英科技大學 學生競賽獲獎獎助金未申請/未簽領提醒
===================================================================
親愛的 {student_name} 同學（學號：{student_id}）您好：

系統監測顯示，您於【{event_name}】中榮獲『{award_rank}』，
本校核定之獎助學金新臺幣 NT$ {amount:,} 元，目前尚【未完成申請/領獎簽領】！

為保障您的學生權益與撥款作業流程，請務必於【{deadline} 前】
點擊下方連結登入校園 Portal 完成線上簽領與金融帳戶核對：

👉 【獎助金線上催辦與簽領專區】: {claim_url}

如逾期未完成線上簽領，該筆獎助學金將依本校獎助學金實施要點予以收回或延後至下一學期發放。
如有疑問，請逕洽教務處校務研究與學生獎補助窗口。

輔英科技大學 教務處 / 校務研究 (IR) 發展中心 敬啟
聯絡電話: (07) 781-1151 轉 2100
===================================================================
"""
        return content.strip()

    def dispatch_unapplied_reminder(self, record_id: int, channel: str = "email") -> Dict[str, Any]:
        """發送單筆未申請獎補助同學催辦提醒"""
        record = None
        for r in self.manager.records:
            if r.get("編號") == record_id:
                record = r
                break

        if not record:
            return {"status": "error", "message": f"找不到編號 #{record_id} 之紀錄"}

        now_str = datetime.date.today().strftime("%Y-%m-%d")
        email_text = self.generate_unapplied_reminder_email(record)
        line_text = (
            f"【輔英獎補助未申請催辦提醒】\n"
            f"{record.get('獲獎學生')} 同學您好，您獲頒「{record.get('競賽或活動名稱')}」之獎助學金 NT$ {record.get('獎助金金額', 0):,} 元尚未簽領！\n"
            f"請於 {record.get('領獎截止日期')} 前完成簽領：https://portal.fooyin.edu.tw/awards/claim?id={record_id}"
        )

        # 更新狀態與紀錄催辦日誌
        self.manager.update_status(record_id, "通知已發送", notify_time=now_str)
        self.log_event(f"[未申請催辦提醒已發送] 學生:{record.get('獲獎學生')} (學號:{record.get('學生學號')}) | 獎助金: ${record.get('獎助金金額', 0)}")

        return {
            "status": "success",
            "type": "unapplied_reminder",
            "record_id": record_id,
            "student_name": record.get("獲獎學生"),
            "student_id": record.get("學生學號"),
            "amount": record.get("獎助金金額"),
            "notify_time": now_str,
            "email_preview": email_text,
            "line_preview": line_text
        }

    def batch_dispatch_unapplied_reminders(self) -> Dict[str, Any]:
        """一鍵批量發送全體『未申請/待通知』同學之獎補助催辦提醒"""
        unapplied_list = self.manager.get_unapplied_students()
        count = 0
        total_amount = 0

        for r in unapplied_list:
            self.dispatch_unapplied_reminder(r.get("編號"))
            count += 1
            total_amount += int(r.get("獎助金金額", 0))

        summary = f"成功一鍵批量派發未申請催辦提醒！共發送 {count} 位同學，涉及總獎助金 NT$ {total_amount:,} 元。"
        self.log_event(summary)

        return {
            "status": "success",
            "sent_count": count,
            "total_unclaimed_amount": total_amount,
            "message": summary
        }

    def batch_dispatch_pending_notifications(self) -> Dict[str, Any]:
        """批量發送所有『待通知』紀錄"""
        pending_list = [r for r in self.manager.records if r.get("發放與領獎狀態") == "待通知"]
        count = 0
        for r in pending_list:
            self.dispatch_notification(r.get("編號"))
            count += 1
        
        summary = f"完成批量派發！共成功發送 {count} 筆學生領獎通知。"
        self.log_event(summary)
        return {
            "status": "success",
            "sent_count": count,
            "remaining_pending": 0,
            "message": summary
        }

    def simulate_student_sign_claim(self, record_id: int) -> Dict[str, Any]:
        """模擬學生點擊線上連結完成領獎簽領」"""
        success = self.manager.update_status(record_id, "已線上簽領")
        if success:
            self.log_event(f"學生完成線上領獎簽領 | 紀錄編號: #{record_id}")
            return {"status": "success", "message": f"紀錄 #{record_id} 學生已成功線上簽領獎助金！"}
        return {"status": "error", "message": "簽領失敗，無此紀錄"}


def main():
    parser = argparse.ArgumentParser(description="輔英科技大學 學生領獎通知與獎助金管理工具")
    parser.add_argument("--test-notify", type=int, help="測試發送指定編號紀錄之領獎通知")
    parser.add_argument("--batch-notify", action="store_true", help="批量發送所有待通知學生之領獎信")
    parser.add_argument("--unapplied-remind", type=int, help="發送指定學生之未申請獎補助催辦提醒")
    parser.add_argument("--batch-unapplied-remind", action="store_true", help="一鍵發送全體未申請同學之獎補助催辦提醒")
    parser.add_argument("--sign", type=int, help="模擬學生線上簽領指定編號之獎助金")

    args = parser.parse_args()
    mgr = FooyinAwardsManager()
    service = StudentNotificationService(mgr)

    if args.unapplied_remind:
        res = service.dispatch_unapplied_reminder(args.unapplied_remind)
        print("\n未申請催辦提醒發送結果:\n", json.dumps(res, ensure_ascii=False, indent=2))
    elif args.batch_unapplied_remind:
        res = service.batch_dispatch_unapplied_reminders()
        print("\n批量未申請催辦提醒結果:\n", json.dumps(res, ensure_ascii=False, indent=2))
    elif args.test_notify:
        res = service.dispatch_notification(args.test_notify)
        print("\n通知發送結果:\n", json.dumps(res, ensure_ascii=False, indent=2))
    elif args.batch_notify:
        res = service.batch_dispatch_pending_notifications()
        print("\n批量通知結果:\n", json.dumps(res, ensure_ascii=False, indent=2))
    elif args.sign:
        res = service.simulate_student_sign_claim(args.sign)
        print("\n簽領結果:\n", json.dumps(res, ensure_ascii=False, indent=2))
    else:
        parser.print_help()

if __name__ == "__main__":
    main()

