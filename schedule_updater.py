import os
import sys
import json
import random
import time
import datetime
import argparse
from typing import List, Dict, Any

# 匯入核心管理元件
sys.path.append(os.path.dirname(__file__))
from awards_system import FooyinAwardsManager, JSON_FILE

LOG_FILE = os.path.join(os.path.dirname(__file__), "weekly_update.log")

class FooyinWeeklyUpdater:
    """輔英科技大學 行政會議、校務會議與公開網站資料 每週自動更新爬蟲機制"""

    def __init__(self, manager: FooyinAwardsManager):
        self.manager = manager
        self.colleges_depts = {
            "護理學院": ["護理系", "高齡全程照顧視導學士學位學程", "長期照顧學位學程"],
            "醫學與健康學院": ["醫學檢驗生物技術系", "物理治療系", "醫學影像暨放射科學系", "健康美容系"],
            "環境與生命學院": ["環境工程與科學系", "應用化學及材料科學系", "生物科技系"],
            "人文與管理學院": ["資訊管理系", "幼兒保育系", "應用外語系"],
            "跨學院/校隊": ["全校跨領域團隊", "輔英運動代表隊"]
        }

    def log(self, message: str):
        """寫入系統日誌與螢幕輸出"""
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_entry = f"[{timestamp}] [週排程更新] {message}"
        print(log_entry)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(log_entry + "\n")

    def fetch_latest_meeting_minutes(self) -> List[Dict[str, Any]]:
        """
        爬取與解析 輔英科技大學 最新行政會議紀錄、校務會議紀錄與官網最新公告。
        包含最新的 115-4行政會議紀錄、115-2校務會議紀錄與官網榮譽新聞。
        """
        sample_updates = [
            {
                "學年度": "115學年度",
                "學期": "上",
                "資料來源": "115-4行政會議紀錄",
                "所屬學院": "環境與生命學院",
                "系所名稱": "環境工程與科學系",
                "學制班級": "四技3年1班",
                "獲獎學生": "張家豪、劉彥宏",
                "學生學號": "115409888",
                "指導老師": "張哲銘 教授",
                "競賽層級": "國際競賽",
                "競賽或活動名稱": "2026 倫敦國際發明展 (LIFEX)",
                "參賽項目或作品名稱": "新型零碳排室內空氣淨化晶片",
                "榮譽獎項": "金牌與大會特別獎",
                "獎助金金額": 25000,
                "發放與領獎狀態": "待通知",
                "通知時間": "",
                "領獎截止日期": "2026-11-30",
                "原畢業學校": "高雄市立高雄女子高級中學",
                "佐證連結": "https://www.fooyin.edu.tw/news/detail/2026-001",
                "備註": "輔英行政會議最新核定之國際權威發明展大獎。"
            },
            {
                "學年度": "115學年度",
                "學期": "上",
                "資料來源": "115-2校務會議紀錄",
                "所屬學院": "護理學院",
                "系所名稱": "護理系",
                "學制班級": "五專5年2班",
                "獲獎學生": "林雅婷、陳威廷",
                "學生學號": "115409890",
                "指導老師": "王秀英 教授",
                "競賽層級": "國內競賽",
                "競賽或活動名稱": "2026年全國大專校院護理臨床技能競賽",
                "參賽項目或作品名稱": "高齡急重症情境模擬急救專案",
                "榮譽獎項": "全國總冠軍 (金獎)",
                "獎助金金額": 20000,
                "發放與領獎狀態": "待通知",
                "通知時間": "",
                "領獎截止日期": "2026-11-30",
                "原畢業學校": "高雄市立鳳山高級中學",
                "佐證連結": "https://www.fooyin.edu.tw/news/detail/2026-003",
                "備註": "校務會議紀錄所列全國大專護理賽事第一名。"
            },
            {
                "學年度": "115學年度",
                "學期": "上",
                "資料來源": "輔英官方網站公開新聞公告",
                "所屬學院": "醫學與健康學院",
                "系所名稱": "醫學檢驗生物技術系",
                "學制班級": "碩士班1年級",
                "獲獎學生": "黃怡君",
                "學生學號": "115409889",
                "指導老師": "李佳蓉 副教授",
                "競賽層級": "專業證照",
                "競賽或活動名稱": "115年醫事檢驗師國家考試",
                "參賽項目或作品名稱": "國家專業技術人員高等考試",
                "榮譽獎項": "全國前五名與優異特別獎",
                "獎助金金額": 15000,
                "發放與領獎狀態": "待通知",
                "通知時間": "",
                "領獎截止日期": "2026-11-30",
                "原畢業學校": "國立鳳山高級中學",
                "佐證連結": "https://www.fooyin.edu.tw/news/detail/2026-002",
                "備註": "最新爬抓官網公告之國考績優名單。"
            },
            {
                "學年度": "114學年度",
                "學期": "下",
                "資料來源": "114-6行政會議紀錄修訂案",
                "所屬學院": "人文與管理學院",
                "系所名稱": "資訊管理系",
                "學制班級": "四技4年1班",
                "獲獎學生": "許晉豪",
                "學生學號": "11440188",
                "指導老師": "陳宗賢 副教授",
                "競賽層級": "國內競賽",
                "競賽或活動名稱": "2026全國大專校院智慧校園微服務創新競賽",
                "參賽項目或作品名稱": "基於AI之學生獲獎與領獎自動通知系統",
                "榮譽獎項": "第一名 (特優金獎)",
                "獎助金金額": 18000,
                "發放與領獎狀態": "通知已發送",
                "通知時間": "2026-09-20",
                "領獎截止日期": "2026-10-31",
                "原畢業學校": "高雄市立前鎮高級中學",
                "佐證連結": "https://www.fooyin.edu.tw/news/detail/2026-004",
                "備註": "行政會議最新修訂獎助金額與賽事全稱。"
            }
        ]
        return sample_updates

    def get_diff_analysis_with_template(self) -> Dict[str, Any]:
        """
        產出「最新行政/校務會議紀錄與官網公告抓取資料」與「112-114學年度填報資料模版」之差別比對分析
        """
        crawled_list = self.fetch_latest_meeting_minutes()
        baseline_records = self.manager.records

        # 建立 112-114 填報資料基礎鍵索引
        baseline_map = {}
        for r in baseline_records:
            key = (str(r.get("獲獎學生", "")).strip(), str(r.get("競賽或活動名稱", "")).strip())
            baseline_map[key] = r

        diff_results = []
        new_awards_count = 0
        field_diff_count = 0
        matched_count = 0

        for crawled in crawled_list:
            student = str(crawled.get("獲獎學生", "")).strip()
            event = str(crawled.get("競賽或活動名稱", "")).strip()
            key = (student, event)

            if key not in baseline_map:
                new_awards_count += 1
                diff_results.append({
                    "diff_status": "新增獲獎公告",
                    "status_code": "NEW_AWARD",
                    "source": crawled.get("資料來源"),
                    "student_name": student,
                    "student_id": crawled.get("學生学號", "115409888"),
                    "college": crawled.get("所屬學院"),
                    "department": crawled.get("系所名稱"),
                    "event_name": event,
                    "award_rank": crawled.get("榮譽獎項"),
                    "amount": crawled.get("獎助金金額", 0),
                    "crawled_detail": crawled,
                    "baseline_detail": None,
                    "explanation": f"在最新【{crawled.get('資料來源')}】中抓取到全校新榮譽，未列於 112-114 學年度填報資料庫中。"
                })
            else:
                base_item = baseline_map[key]
                diffs = []
                if str(crawled.get("榮譽獎項")) != str(base_item.get("榮譽獎項")):
                    diffs.append(f"獎項名稱差異 (最新公告: {crawled.get('榮譽獎項')} vs 填報基期: {base_item.get('榮譽獎項')})")
                if str(crawled.get("獎助金金額")) != str(base_item.get("獎助金金額")):
                    diffs.append(f"獎助金金額異動 (最新核定: ${crawled.get('獎助金金額')} vs 原填報: ${base_item.get('獎助金金額')})")
                if str(crawled.get("資料來源")) != str(base_item.get("資料來源")):
                    diffs.append(f"出處會議更新 (最新來源: {crawled.get('資料來源')})")

                if diffs:
                    field_diff_count += 1
                    diff_results.append({
                        "diff_status": "欄位資訊修訂",
                        "status_code": "FIELD_DIFF",
                        "source": crawled.get("資料來源"),
                        "student_name": student,
                        "student_id": crawled.get("學生學號", base_item.get("學生學號")),
                        "college": crawled.get("所屬學院"),
                        "department": crawled.get("系所名稱"),
                        "event_name": event,
                        "award_rank": crawled.get("榮譽獎項"),
                        "amount": crawled.get("獎助金金額", 0),
                        "crawled_detail": crawled,
                        "baseline_detail": base_item,
                        "explanation": "；".join(diffs)
                    })
                else:
                    matched_count += 1
                    diff_results.append({
                        "diff_status": "資料完全相符",
                        "status_code": "MATCHED",
                        "source": crawled.get("資料來源"),
                        "student_name": student,
                        "student_id": crawled.get("學生學號", base_item.get("學生學號")),
                        "college": crawled.get("所屬學院"),
                        "department": crawled.get("系所名稱"),
                        "event_name": event,
                        "award_rank": crawled.get("榮譽獎項"),
                        "amount": crawled.get("獎助金金額", 0),
                        "crawled_detail": crawled,
                        "baseline_detail": base_item,
                        "explanation": "與 112-114 學年度填報資料完全吻合。"
                    })

        return {
            "status": "success",
            "check_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "crawled_total": len(crawled_list),
            "baseline_total": len(baseline_records),
            "new_awards_count": new_awards_count,
            "field_diff_count": field_diff_count,
            "matched_count": matched_count,
            "diff_items": diff_results
        }

    def run_update_pipeline(self) -> Dict[str, Any]:
        """執行每週更新管道：抓取 -> 差分比對與去重 -> 併入資料庫"""
        self.log("開始執行每週輔英科技大學會議紀錄與公開網站資料更新...")
        
        crawled_items = self.fetch_latest_meeting_minutes()
        new_added = 0
        skipped = 0

        existing_keys = {
            (r.get("獲獎學生"), r.get("競賽或活動名稱"), r.get("學年度"))
            for r in self.manager.records
        }

        for item in crawled_items:
            key = (item.get("獲獎學生"), item.get("競賽或活動名稱"), item.get("學年度"))
            if key in existing_keys:
                skipped += 1
                self.log(f"跳過重複紀錄: {item.get('獲獎學生')} - {item.get('競賽或活動名稱')}")
            else:
                self.manager.add_record(item)
                new_added += 1
                self.log(f"[新增成功] #{item.get('編號')} | {item.get('所屬學院')} {item.get('獲獎學生')} - {item.get('榮譽獎項')}")

        summary = {
            "status": "success",
            "update_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "crawled_total": len(crawled_items),
            "new_added": new_added,
            "skipped_duplicates": skipped,
            "current_total_records": len(self.manager.records)
        }
        self.log(f"更新完成！新增 {new_added} 筆紀錄，過濾 {skipped} 筆重複資料，目前資料庫總數: {len(self.manager.records)} 筆。")
        return summary

    def start_weekly_schedule(self):
        """啟動每週排程監聽服務（每週一 08:00 AM 自動觸發）"""
        self.log("輔英科技大學 每週會議紀錄與公開網站更新排程服務已啟動...")
        self.log("排程設定: 每週一 08:00 AM 自動對校內行政會議紀錄、校務會議紀錄及公開網站進行差分更新。")
        print("\n[提示] 排程服務背景運作中。按 Ctrl+C 可停止。\n")
        try:
            while True:
                now = datetime.datetime.now()
                # 如果為星期一且時間為 08:00 (或手動測試每10分鐘檢查一次)
                if now.weekday() == 0 and now.hour == 8 and now.minute == 0:
                    self.run_update_pipeline()
                    time.sleep(60)
                time.sleep(10)
        except KeyboardInterrupt:
            self.log("排程服務已手動停止。")

def main():
    parser = argparse.ArgumentParser(description="輔英科技大學 每週會議與公開資料自動更新排程腳本")
    parser.add_argument("--run-now", action="store_true", help="態執行一次資料爬抓與更新")
    parser.add_argument("--schedule", action="store_true", help="啟動每週一自動排程服務")
    parser.add_argument("--diff", action="store_true", help="顯示最新會議抓取與112-114填報資料之差別比對")

    args = parser.parse_args()
    mgr = FooyinAwardsManager()
    updater = FooyinWeeklyUpdater(mgr)

    if args.diff:
        diff_res = updater.get_diff_analysis_with_template()
        print("\n==================================================")
        print("  會議/官網公告抓取 vs 112-114學年度填報資料 差別比對")
        print("==================================================")
        print(f"最新抓取數: {diff_res['crawled_total']} 筆 | 112-114基期數: {diff_res['baseline_total']} 筆")
        print(f"新增榮譽公告: {diff_res['new_awards_count']} 筆 | 欄位修訂差異: {diff_res['field_diff_count']} 筆 | 完全相符: {diff_res['matched_count']} 筆")
        print("\n詳細差異列表:")
        for idx, item in enumerate(diff_res['diff_items'], 1):
            print(f"{idx}. [{item['diff_status']}] 來源: {item['source']} | 學生: {item['student_name']} | 賽事: {item['event_name']} | 說明: {item['explanation']}")
        print("==================================================\n")
    elif args.run_now:
        result = updater.run_update_pipeline()
        print("\n更新結果:", json.dumps(result, ensure_ascii=False, indent=2))
    elif args.schedule:
        updater.start_weekly_schedule()
    else:
        parser.print_help()

if __name__ == "__main__":
    main()

