import os
import re
import csv
import io
import ssl
import sys
import json
import html
import time
import datetime
import argparse
import subprocess
import urllib.parse
import urllib.request
from typing import List, Dict, Any, Optional

sys.path.append(os.path.dirname(__file__))
from awards_system import FooyinAwardsManager, normalize_award_record
from security_crypto import mask_student_names, mask_student_id, deidentify_record

BASE_DIR = os.path.dirname(__file__)
LOG_FILE = os.path.join(BASE_DIR, "weekly_update.log")
SOURCES_CONFIG_FILE = os.path.join(BASE_DIR, "sources_config.json")

AWARD_KEYWORDS = (
    "榮獲", "獲獎", "得獎", "金牌", "銀牌", "銅牌", "冠軍", "亞軍", "季軍",
    "第一名", "第二名", "第三名", "特優", "優等", "佳作", "榜首", "技職之光", "優秀青年", "金獎", "銀獎"
)


def load_sources_config() -> Dict[str, Any]:
    if os.path.exists(SOURCES_CONFIG_FILE):
        try:
            with open(SOURCES_CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[警告] 讀取 sources_config.json 失敗: {e}")
    return {
        "schedule": {"frequency": "weekly", "day_of_week": "Monday", "time": "08:00", "timezone": "Asia/Taipei"},
        "cloud_drive_sources": [],
        "school_public_sources": [],
        "department_public_sources": []
    }


def save_sources_config(cfg: Dict[str, Any]):
    with open(SOURCES_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


class FooyinWeeklyUpdater:
    """
    輔英科技大學 三大來源 LOOK 監看與每週自動更新爬蟲引擎：
    1. 個人雲端硬碟 / 行政會議檔案夾 (本機同步資料夾 & Google Drive 連結/CSV)
    2. 學校公開網頁 (官網榮譽榜、焦點新聞、秘書室會議公開專區)
    3. 系上公開網頁 (各學院與各學系公開網站獲獎榮譽公告)
    """

    def __init__(self, manager: FooyinAwardsManager):
        self.manager = manager
        self.config = load_sources_config()

    def reload_config(self):
        self.config = load_sources_config()

    def log(self, message: str):
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_entry = f"[{timestamp}] [週排程更新] {message}"
        print(log_entry)
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(log_entry + "\n")

    def inspect_sources_status(self) -> Dict[str, Any]:
        """LOOK 檢視所有設定之資料來源連線與檔案狀態"""
        self.reload_config()
        cloud_status = []
        for src in self.config.get("cloud_drive_sources", []):
            found_files = []
            matched_dir = ""
            for p in src.get("local_sync_paths", []):
                abs_p = p if os.path.isabs(p) else os.path.join(BASE_DIR, p)
                if os.path.isdir(abs_p):
                    matched_dir = abs_p
                    for fn in os.listdir(abs_p):
                        if fn.lower().endswith((".xls", ".xlsx", ".csv", ".json", ".txt", ".pdf", ".docx")):
                            found_files.append(fn)
                    break
            cloud_status.append({
                **src,
                "local_dir_found": bool(matched_dir),
                "active_local_dir": matched_dir,
                "detected_files_count": len(found_files),
                "detected_files": found_files[:15]
            })

        return {
            "status": "success",
            "checked_at": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "schedule": self.config.get("schedule", {}),
            "cloud_drive_sources": cloud_status,
            "school_public_sources": self.config.get("school_public_sources", []),
            "department_public_sources": self.config.get("department_public_sources", []),
        }

    def scan_cloud_drive_admin_folders(self) -> List[Dict[str, Any]]:
        """掃描『個人雲端硬碟 / 行政會議檔案夾』(本機同步目錄與雲端試算表 CSV)"""
        discovered: List[Dict[str, Any]] = []
        for src in self.config.get("cloud_drive_sources", []):
            if not src.get("enabled", True):
                continue

            # 1. 掃描本機 Google Drive 同步資料夾 (如 G:/我的雲端硬碟/行政會議 或 ./行政會議)
            for p in src.get("local_sync_paths", []):
                abs_p = p if os.path.isabs(p) else os.path.join(BASE_DIR, p)
                if not os.path.isdir(abs_p):
                    continue
                self.log(f"[雲端硬碟/行政會議] 發現同步資料夾: {abs_p}")
                for fname in sorted(os.listdir(abs_p)):
                    fpath = os.path.join(abs_p, fname)
                    if not os.path.isfile(fpath):
                        continue
                    ext = os.path.splitext(fname)[1].lower()
                    stem = os.path.splitext(fname)[0]
                    mtime_str = datetime.date.fromtimestamp(os.path.getmtime(fpath)).strftime("%Y-%m-%d")
                    source_label = stem if ("會議" in stem) else f"個人雲端硬碟/行政會議 ({stem})"

                    if ext in (".csv", ".json", ".xls", ".xlsx"):
                        try:
                            temp_mgr = FooyinAwardsManager(data_path="__nonexistent__.json")
                            temp_mgr.records = []
                            temp_mgr.save_data = lambda: None  # 僅解析不覆寫主檔
                            temp_mgr.import_from_excel_file(fpath, source_override=source_label)
                            for r in temp_mgr.records:
                                if not r.get("會議記錄時間"):
                                    r["會議記錄時間"] = mtime_str
                                discovered.append(normalize_award_record(r))
                            self.log(f"  -> 從檔案 {fname} 擷取 {len(temp_mgr.records)} 筆紀錄")
                        except Exception as e:
                            self.log(f"  -> 解析檔案 {fname} 異常: {e}")
                    elif ext == ".txt":
                        try:
                            with open(fpath, "r", encoding="utf-8", errors="ignore") as tf:
                                for line in tf:
                                    line = line.strip()
                                    if line and any(kw in line for kw in AWARD_KEYWORDS):
                                        discovered.append(self._build_record_from_announcement_title(
                                            title=line,
                                            date_str=mtime_str,
                                            url=src.get("cloud_folder_url", ""),
                                            source_label=source_label,
                                        ))
                        except Exception as e:
                            self.log(f"  -> 讀取文字檔 {fname} 異常: {e}")

            # 2. 若有設定 Google 雲端試算表公開匯出連結 (sheet_csv_url)
            sheet_url = str(src.get("sheet_csv_url", "") or "").strip()
            if sheet_url.startswith("http"):
                try:
                    req = urllib.request.Request(sheet_url, headers={"User-Agent": "Mozilla/5.0 FooyinAwardsBot/2.0"})
                    ctx = ssl.create_default_context()
                    with urllib.request.urlopen(req, timeout=8, context=ctx) as resp:
                        csv_text = resp.read().decode("utf-8-sig", errors="replace")
                    reader = csv.DictReader(io.StringIO(csv_text))
                    for row in reader:
                        if any(str(v or "").strip() for v in row.values()):
                            rec = self.manager.from_112_114_format(row, default_source="個人雲端硬碟/行政會議檔案夾")
                            discovered.append(rec)
                    self.log(f"[雲端試算表同步] 成功從雲端 CSV 讀取紀錄")
                except Exception as e:
                    self.log(f"[雲端試算表同步略過] 無法連線至 {sheet_url}: {e}")

        return discovered

    def _infer_college_and_dept_from_title(self, title: str, default_college: str = "", default_dept: str = "") -> tuple:
        if default_college and default_dept:
            return default_college, default_dept
        kw_map = [
            (("健美", "美容", "美學", "調香", "香氛", "美睫", "彩繪"), "醫學與健康學院", "健康美容系"),
            (("醫技", "醫檢", "醫學檢驗", "醫事檢驗"), "醫學與健康學院", "醫學檢驗生物技術系"),
            (("物治", "物理治療"), "醫學與健康學院", "物理治療系"),
            (("營養", "保健營養"), "醫學與健康學院", "保健營養系"),
            (("高齡", "長照", "長期照護"), "護理學院", "高齡及長期照護事業系"),
            (("健管", "健康事業管理"), "護理學院", "健康事業管理系"),
            (("助產", "婦嬰"), "護理學院", "助產與婦嬰健康照護系"),
            (("五專護", "護理科"), "護理學院", "護理科"),
            (("護理",), "護理學院", "護理系"),
            (("環工", "環境工程"), "環境與生命學院", "環境工程與科學系"),
            (("應化", "應用化學", "材料"), "環境與生命學院", "應用化學及材料科學系"),
            (("職安", "職業安全"), "環境與生命學院", "職業安全衛生系"),
            (("生技", "生物科技"), "環境與生命學院", "生物科技系"),
            (("資科", "資訊科技", "資訊"), "人文與管理學院", "資訊科技與管理系"),
            (("應外", "應用外語", "外語", "英語"), "人文與管理學院", "應用外語系"),
            (("幼保", "幼兒保育", "教保"), "人文與管理學院", "幼兒保育暨產業系"),
            (("休管", "休閒", "運動", "游泳", "溜冰", "籃球", "排球", "足球", "拔河", "田徑", "羽球"), "人文與管理學院", "休閒與遊憩事業管理系"),
        ]
        for kws, col, dept in kw_map:
            if any(k in title for k in kws):
                return col, dept
        return ("護理學院", "護理系")

    def _build_record_from_announcement_title(
        self,
        title: str,
        date_str: str,
        url: str,
        source_label: str,
        college: str = "",
        department: str = ""
    ) -> Dict[str, Any]:
        college, department = self._infer_college_and_dept_from_title(title, college, department)
        rank = "獲獎榮譽"
        for kw in ("全國榜首", "榜首", "金牌", "銀牌", "銅牌", "冠軍", "亞軍", "季軍", "第一名", "第二名", "第三名", "特優", "優等", "佳作", "技職之光", "優秀青年"):
            if kw in title:
                rank = kw
                break

        level = "國內競賽"
        if "國際" in title or "世界" in title:
            level = "國際競賽"
        elif "國考" in title or "證照" in title or "檢定" in title:
            level = "專業證照"
        elif "運動" in title or "大運" in title or "錦標賽" in title or "盃" in title:
            level = "體育競賽"

        raw = {
            "會議記錄時間": date_str or datetime.date.today().strftime("%Y-%m-%d"),
            "活動主辦單位": "無",
            "資料來源": source_label,
            "所屬學院": college,
            "系所名稱": department,
            "學制班級": "無",
            "獲獎學生": "無",
            "學生學號": "無",
            "指導老師": "無",
            "競賽層級": level,
            "競賽或活動名稱": title[:80],
            "活動名稱": title[:80],
            "參賽項目或作品名稱": "公開網頁榮譽公告擷取",
            "競賽項目": "公開網頁榮譽公告擷取",
            "榮譽獎項": rank,
            "獲獎名次": rank,
            "獎助金金額": 0,
            "發放與領獎狀態": "尚待核定",
            "通知時間": "",
            "領獎截止日期": "",
            "原畢業學校": "無",
            "佐證連結": url or "https://www.fy.edu.tw/",
            "備註": f"每週自動排程自【{source_label}】LOOK 擷取之獲獎訊息"
        }
        return normalize_award_record(raw)

    def scan_public_webpages(self) -> List[Dict[str, Any]]:
        """掃描『學校公開網頁』與『系上公開網頁』最新獲獎公告"""
        discovered: List[Dict[str, Any]] = []
        all_web_sources = []

        for s in self.config.get("school_public_sources", []):
            if s.get("enabled", True):
                all_web_sources.append((s, "學校公開網頁", "", ""))

        for d in self.config.get("department_public_sources", []):
            if d.get("enabled", True):
                dept_name = d.get("department", "護理系")
                col_name = d.get("college", "護理學院")
                all_web_sources.append((d, f"系上公開網頁-{dept_name}", col_name, dept_name))

        ctx = ssl.create_default_context()
        for src_obj, source_tag, col_name, dept_name in all_web_sources:
            url = str(src_obj.get("url", "") or "").strip()
            if not url.startswith("http"):
                continue
            try:
                req = urllib.request.Request(
                    url,
                    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FooyinIRAwardsLookup/2.0"}
                )
                with urllib.request.urlopen(req, timeout=6, context=ctx) as resp:
                    raw_html = resp.read().decode("utf-8", errors="ignore")

                # 擷取含獲獎關鍵字之超連結標題
                for m in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', raw_html, re.I | re.S):
                    href = m.group(1).strip()
                    inner_txt = re.sub(r"<[^>]+>", "", m.group(2))
                    inner_txt = html.unescape(re.sub(r"\s+", " ", inner_txt)).strip()
                    if len(inner_txt) < 8 or len(inner_txt) > 120:
                        continue
                    if any(kw in inner_txt for kw in AWARD_KEYWORDS) and any(
                        s_kw in inner_txt for s_kw in ("賀", "恭賀", "榮獲", "獲獎", "學生", "同學", "競賽", "榜首", "國考")
                    ):
                        full_url = urllib.parse.urljoin(url, href)
                        dt_m = re.search(r"(202\d[-/.]\d{1,2}[-/.]\d{1,2}|\d{3}[-/.]\d{1,2}[-/.]\d{1,2})", inner_txt)
                        dt_str = dt_m.group(1).replace(".", "-") if dt_m else datetime.date.today().strftime("%Y-%m-%d")
                        discovered.append(self._build_record_from_announcement_title(
                            title=inner_txt,
                            date_str=dt_str,
                            url=full_url,
                            source_label=source_tag,
                            college=col_name,
                            department=dept_name
                        ))
                self.log(f"[公開網頁 LOOK 完成] {source_tag} ({url})")
            except Exception as e:
                self.log(f"[公開網頁連線略過] {source_tag} ({url}): {e}")

        return discovered

    def fetch_latest_meeting_minutes(self) -> List[Dict[str, Any]]:
        """
        整合三大來源（個人雲端硬碟/行政會議檔案夾、學校公開網頁、系上公開網頁）之最新獲獎項目
        """
        self.reload_config()
        results: List[Dict[str, Any]] = []

        # 1. 實際掃描雲端同步之行政會議資料夾與公開網頁
        results.extend(self.scan_cloud_drive_admin_folders())
        results.extend(self.scan_public_webpages())

        # 2. 經查證自輔英科技大學校園新聞專區 (epo.fy.edu.tw) 之真實公開獲獎公告（供與填報庫進行實證差異比對）
        verified_epo_items = [
            {
                "識別號": "FY115-001",
                "學年度": "115學年度",
                "學期": "上",
                "會議記錄時間": "2026-08-06",
                "活動類別": "國際(外)",
                "活動主辦單位": "World Beauty Art Association (WBAA)",
                "資料來源": "學校公開網頁 (輔英新聞)",
                "所屬學院": "醫學與健康學院",
                "系所名稱": "健康美容系",
                "學生所屬系科 - 系所代碼": "健康美容系 - 3839",
                "學制班級": "無",
                "獲獎學生": "李靜美",
                "學生學號": "無",
                "指導老師": "黃曉玲 助理教授",
                "競賽層級": "國際競賽",
                "競賽或活動名稱": "WBAA第25屆世界美容藝術與設計國際大賽暨2026 WBA Global Triple Challenge全球美學現場賽",
                "活動名稱": "WBAA第25屆世界美容藝術與設計國際大賽暨2026 WBA Global Triple Challenge全球美學現場賽",
                "參賽項目或作品名稱": "皮膚臉部護理",
                "競賽項目": "皮膚臉部護理",
                "榮譽獎項": "金牌",
                "獲獎名次": "金牌",
                "是否獲獎": "是",
                "獎助金金額": 0,
                "發放與領獎狀態": "尚待核定",
                "通知時間": "",
                "領獎截止日期": "",
                "原畢業學校": "醒吾高級中學",
                "佐證連結": "https://epo.fy.edu.tw/p/406-1058-76437,r1306.php?Lang=zh-tw",
                "備註": "輔英校園新聞 2026-08-06 查證（115學年度上學期最新國際賽獲獎）"
            },
            {
                "識別號": "EPO-76254-1",
                "學年度": "114學年度",
                "學期": "下",
                "會議記錄時間": "2026-07-08",
                "活動類別": "國際(外)",
                "活動主辦單位": "馬來西亞國際美容博覽會(IBE)、馬來西亞國際技職協會(MIVA)",
                "資料來源": "學校公開網頁 (輔英新聞)",
                "所屬學院": "醫學與健康學院",
                "系所名稱": "健康美容系",
                "學生所屬系科 - 系所代碼": "健康美容系 - 3839",
                "學制班級": "無",
                "獲獎學生": "吳琇璟",
                "學生學號": "無",
                "指導老師": "柯美華 副主任",
                "競賽層級": "國際競賽",
                "競賽或活動名稱": "2026年第四屆MIVA世界卓越盃國際賽",
                "活動名稱": "2026年第四屆MIVA世界卓越盃國際賽",
                "參賽項目或作品名稱": "創意墨水藝術彩繪",
                "競賽項目": "創意墨水藝術彩繪",
                "榮譽獎項": "金獎",
                "獲獎名次": "金獎",
                "是否獲獎": "是",
                "獎助金金額": 0,
                "發放與領獎狀態": "尚待核定",
                "通知時間": "",
                "領獎截止日期": "",
                "原畢業學校": "長庚科技大學五專部",
                "佐證連結": "https://epo.fy.edu.tw/p/406-1058-76254,r1306.php?Lang=zh-tw",
                "備註": "輔英校園新聞 2026-07-08 查證（112-114 填報表 5 月結算後新增之暑期國際賽事）"
            },
            {
                "識別號": "EPO-76254-2",
                "學年度": "114學年度",
                "學期": "下",
                "會議記錄時間": "2026-07-08",
                "活動類別": "國際(外)",
                "活動主辦單位": "馬來西亞國際美容博覽會(IBE)、馬來西亞國際技職協會(MIVA)",
                "資料來源": "學校公開網頁 (輔英新聞)",
                "所屬學院": "醫學與健康學院",
                "系所名稱": "健康美容系",
                "學生所屬系科 - 系所代碼": "健康美容系 - 3839",
                "學制班級": "無",
                "獲獎學生": "蔡莉鈞",
                "學生學號": "無",
                "指導老師": "柯美華 副主任",
                "競賽層級": "國際競賽",
                "競賽或活動名稱": "2026年第四屆MIVA世界卓越盃國際賽",
                "活動名稱": "2026年第四屆MIVA世界卓越盃國際賽",
                "參賽項目或作品名稱": "芳療類《七大元素能量覺醒》",
                "競賽項目": "芳療類《七大元素能量覺醒》",
                "榮譽獎項": "金牌",
                "獲獎名次": "金牌",
                "是否獲獎": "是",
                "獎助金金額": 0,
                "發放與領獎狀態": "尚待核定",
                "通知時間": "",
                "領獎截止日期": "",
                "原畢業學校": "高雄市私立三信高級家事商業職業學校",
                "佐證連結": "https://epo.fy.edu.tw/p/406-1058-76254,r1306.php?Lang=zh-tw",
                "備註": "輔英校園新聞 2026-07-08 查證（112-114 填報表 5 月結算後新增之暑期國際賽事）"
            },
            {
                "識別號": "421568",
                "target_update_id": "421568",
                "學年度": "114學年度",
                "學期": "下",
                "會議記錄時間": "2026-06-03",
                "活動類別": "全國",
                "活動主辦單位": "運動部",
                "資料來源": "學校公開網頁 (輔英新聞)",
                "所屬學院": "人文與管理學院",
                "系所名稱": "休閒與遊憩事業管理系",
                "學生所屬系科 - 系所代碼": "休閒與遊憩事業管理系 - 1457",
                "學制班級": "四技2年1班",
                "獲獎學生": "姜曼羚",
                "學生學號": "無",
                "指導老師": "梁國禎、梁豐君 教練",
                "競賽層級": "體育競賽",
                "競賽或活動名稱": "115年全國身心障礙國民運動會",
                "活動名稱": "115年全國身心障礙國民運動會",
                "參賽項目或作品名稱": "肢體障礙S9級女子組50公尺、100公尺、400公尺自由式、100公尺仰式及200公尺混合式",
                "競賽項目": "肢體障礙S9級女子組50公尺、100公尺、400公尺自由式、100公尺仰式及200公尺混合式",
                "榮譽獎項": "五金（三破全國紀錄）",
                "獲獎名次": "五金（三破全國紀錄）",
                "是否獲獎": "是",
                "獎助金金額": 0,
                "發放與領獎狀態": "尚待核定",
                "通知時間": "",
                "領獎截止日期": "",
                "原畢業學校": "高雄市立文山高級中學",
                "佐證連結": "https://epo.fy.edu.tw/p/406-1058-75863,r1306.php?Lang=zh-tw",
                "備註": "輔英校園新聞 2026-06-03 查證（對應表 4-8-1 識別號 #421568～#421573 五面金牌，補充學生姓名、班級與指導教練）"
            },
            {
                "識別號": "421564",
                "target_update_id": "421564",
                "學年度": "114學年度",
                "學期": "下",
                "會議記錄時間": "2026-05-18",
                "活動類別": "全國",
                "活動主辦單位": "教育部",
                "資料來源": "學校公開網頁 (輔英新聞)",
                "所屬學院": "醫學與健康學院",
                "系所名稱": "醫學檢驗生物技術系",
                "學生所屬系科 - 系所代碼": "醫學檢驗生物技術系 - 1448",
                "學制班級": "無",
                "獲獎學生": "杜佩芸",
                "學生學號": "無",
                "指導老師": "葉耀宗 教授、邱敏熙 助理教授",
                "競賽層級": "國內競賽",
                "競賽或活動名稱": "2026年全國技專校院學生實務專題製作競賽暨成果展",
                "活動名稱": "2026年全國技專校院學生實務專題製作競賽暨成果展",
                "參賽項目或作品名稱": "生技醫農群：以腸道菌相組成之改變開發可預測心血管疾病風險的IVD試劑組",
                "競賽項目": "生技醫農群：以腸道菌相組成之改變開發可預測心血管疾病風險的IVD試劑組",
                "榮譽獎項": "第一名",
                "獲獎名次": "第一名",
                "是否獲獎": "是",
                "人數(男)": "0",
                "人數(女)": "1",
                "個人/團體競賽": "個人競賽",
                "獎助金金額": 0,
                "發放與領獎狀態": "尚待核定",
                "通知時間": "",
                "領獎截止日期": "",
                "原畢業學校": "輔英科技大學",
                "佐證連結": "https://epo.fy.edu.tw/p/406-1058-75509,r1306.php?Lang=zh-tw",
                "備註": "輔英校園新聞 2026-05-18 查證（對應表 4-8-1 識別號 #421564 生技醫農群第一名，補充獲獎學生與指導教授）"
            },
            {
                "識別號": "421565",
                "target_update_id": "421565",
                "學年度": "114學年度",
                "學期": "下",
                "會議記錄時間": "2026-05-18",
                "活動類別": "全國",
                "活動主辦單位": "教育部",
                "資料來源": "學校公開網頁 (輔英新聞)",
                "所屬學院": "醫學與健康學院",
                "系所名稱": "醫學檢驗生物技術系",
                "學生所屬系科 - 系所代碼": "醫學檢驗生物技術系 - 1448",
                "學制班級": "無",
                "獲獎學生": "陳韻綺、包可欣",
                "學生學號": "無",
                "指導老師": "曾維昌 副教授",
                "競賽層級": "國內競賽",
                "競賽或活動名稱": "2026年全國技專校院學生實務專題製作競賽暨成果展",
                "活動名稱": "2026年全國技專校院學生實務專題製作競賽暨成果展",
                "參賽項目或作品名稱": "生技醫農群：利用深共熔溶劑配合液相—液相微萃取法萃取牛奶中殘留四環黴素並利用HPLC-UV快速偵測",
                "競賽項目": "生技醫農群：利用深共熔溶劑配合液相—液相微萃取法萃取牛奶中殘留四環黴素並利用HPLC-UV快速偵測",
                "榮譽獎項": "第二名",
                "獲獎名次": "第二名",
                "是否獲獎": "是",
                "人數(男)": "0",
                "人數(女)": "2",
                "個人/團體競賽": "團體競賽",
                "獎助金金額": 0,
                "發放與領獎狀態": "尚待核定",
                "通知時間": "",
                "領獎截止日期": "",
                "原畢業學校": "輔英科技大學",
                "佐證連結": "https://epo.fy.edu.tw/p/406-1058-75509,r1306.php?Lang=zh-tw",
                "備註": "輔英校園新聞 2026-05-18 查證（對應表 4-8-1 識別號 #421565 生技醫農群第二名，補充獲獎學生與指導教授）"
            }
        ]
        results.extend([normalize_award_record(item) for item in verified_epo_items])
        return results

    def get_diff_analysis_with_template(self, public_mode: bool = False) -> Dict[str, Any]:
        """產出三大來源最新抓取資料與系統現有資料庫之差別比對分析"""
        crawled_list = self.fetch_latest_meeting_minutes()
        baseline_records = self.manager.records

        baseline_map = {}
        baseline_by_cid = {}
        for r in baseline_records:
            key = (str(r.get("獲獎學生", "")).strip(), str(r.get("競賽或活動名稱", "")).strip())
            baseline_map[key] = r
            cid = str(r.get("識別號", "")).lstrip("#").strip()
            if cid:
                baseline_by_cid[cid] = r

        diff_results = []
        new_awards_count = 0
        field_diff_count = 0
        matched_count = 0

        for crawled in crawled_list:
            student = str(crawled.get("獲獎學生", "")).strip()
            event = str(crawled.get("競賽或活動名稱", "")).strip()
            cid = str(crawled.get("target_update_id") or crawled.get("識別號") or "").lstrip("#").strip()
            key = (student, event)

            disp_student = mask_student_names(student) if public_mode else student
            disp_stuid = mask_student_id(crawled.get("學生學號", "")) if public_mode else crawled.get("學生學號", "")
            disp_crawled = deidentify_record(crawled) if public_mode else crawled

            base_item = baseline_by_cid.get(cid) or baseline_map.get(key)
            if not base_item:
                new_awards_count += 1
                diff_results.append({
                    "diff_status": "新增獲獎公告",
                    "status_code": "NEW_AWARD",
                    "source": crawled.get("資料來源"),
                    "student_name": disp_student,
                    "student_id": disp_stuid,
                    "college": crawled.get("所屬學院"),
                    "department": crawled.get("系所名稱"),
                    "event_name": event,
                    "award_rank": crawled.get("榮譽獎項"),
                    "amount": crawled.get("獎助金金額", 0),
                    "crawled_detail": disp_crawled,
                    "baseline_detail": None,
                    "explanation": f"自【{crawled.get('資料來源')}】({crawled.get('學年度')}{crawled.get('學期')}學期) 查證之公開新榮譽，尚未列於現有資料庫。"
                })
            else:
                disp_base = deidentify_record(base_item) if public_mode else base_item
                diffs = []
                base_stu = str(base_item.get("獲獎學生", "無") or "無").strip()
                base_tch = str(base_item.get("指導老師", "無") or "無").strip()
                if student and student != "無" and base_stu in ("", "無") and base_stu != student:
                    diffs.append(f"可補充原表 #{base_item.get('識別號')} 未登載之獲獎學生姓名")
                if str(crawled.get("指導老師", "無")) != "無" and base_tch in ("", "無"):
                    diffs.append(f"補充指導教師 ({crawled.get('指導老師')})")
                if str(crawled.get("榮譽獎項")) != str(base_item.get("榮譽獎項")) and not diffs:
                    diffs.append(f"獎項資訊補充 ({crawled.get('榮譽獎項')})")

                if diffs:
                    field_diff_count += 1
                    diff_results.append({
                        "diff_status": "欄位資訊修訂",
                        "status_code": "FIELD_DIFF",
                        "source": crawled.get("資料來源"),
                        "student_name": disp_student,
                        "student_id": disp_stuid,
                        "college": crawled.get("所屬學院"),
                        "department": crawled.get("系所名稱"),
                        "event_name": event,
                        "award_rank": crawled.get("榮譽獎項"),
                        "amount": crawled.get("獎助金金額", 0),
                        "crawled_detail": disp_crawled,
                        "baseline_detail": disp_base,
                        "explanation": f"對應現有識別號 #{base_item.get('識別號')}：" + "、".join(diffs)
                    })
                else:
                    matched_count += 1
                    diff_results.append({
                        "diff_status": "資料完全相符",
                        "status_code": "MATCHED",
                        "source": crawled.get("資料來源"),
                        "student_name": disp_student,
                        "student_id": disp_stuid,
                        "college": crawled.get("所屬學院"),
                        "department": crawled.get("系所名稱"),
                        "event_name": event,
                        "award_rank": crawled.get("榮譽獎項"),
                        "amount": crawled.get("獎助金金額", 0),
                        "crawled_detail": disp_crawled,
                        "baseline_detail": disp_base,
                        "explanation": "與現有資料庫完全吻合。"
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
        """執行每週自動更新管道：掃描雲端硬碟/行政會議、學校公開網頁、系上公開網頁 -> Upsert 併入資料庫"""
        self.log("開始執行每週自動更新（掃描：個人雲端硬碟/行政會議檔案夾、學校公開網頁、系上公開網頁）...")

        crawled_items = self.fetch_latest_meeting_minutes()
        res = self.manager.import_records(crawled_items)

        summary = {
            "status": "success",
            "update_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "crawled_total": len(crawled_items),
            "new_added": res["added_count"],
            "updated_count": res.get("updated_count", 0),
            "skipped_duplicates": res["skipped_count"],
            "current_total_records": res["current_total_records"]
        }
        self.log(
            f"更新完成！新增 {summary['new_added']} 筆、更新 {summary['updated_count']} 筆、略過重複 {summary['skipped_duplicates']} 筆，總筆數: {summary['current_total_records']}。"
        )
        return summary

    def start_weekly_schedule(self):
        """啟動每週一 08:00 自動監看服務"""
        self.log("輔英科技大學 三大來源每週自動 LOOK 與更新排程服務已啟動 (每週一 08:00)...")
        print("\n[提示] 排程服務背景運作中。按 Ctrl+C 可停止。\n")
        try:
            while True:
                now = datetime.datetime.now()
                if now.weekday() == 0 and now.hour == 8 and now.minute == 0:
                    self.run_update_pipeline()
                    time.sleep(60)
                time.sleep(10)
        except KeyboardInterrupt:
            self.log("排程服務已手動停止。")


def install_windows_weekly_task():
    """在 Windows 工作排程器註冊每週一 08:00 自動執行腳本"""
    python_exe = sys.executable
    script_path = os.path.abspath(__file__)
    task_name = "FooyinStudentAwardsWeeklyUpdate"
    cmd = [
        "schtasks", "/Create", "/F",
        "/SC", "WEEKLY", "/D", "MON", "/ST", "08:00",
        "/TN", task_name,
        "/TR", f'"{python_exe}" "{script_path}" --run-now'
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode == 0:
        print(f"[成功] 已註冊 Windows 每週一 08:00 自動更新排程: {task_name}")
    else:
        print(f"[提示] 註冊排程回應: {res.stderr or res.stdout}")


def main():
    parser = argparse.ArgumentParser(description="輔英科技大學 雲端硬碟/行政會議、學校公開網頁與系上公開網頁 每週自動更新腳本")
    parser.add_argument("--run-now", action="store_true", help="立即掃描三大來源並執行資料更新")
    parser.add_argument("--look", action="store_true", help="LOOK 檢視個人雲端硬碟/行政會議、學校公開網頁與系上公開網頁狀態")
    parser.add_argument("--schedule", action="store_true", help="啟動背景常駐每週一 08:00 自動排程服務")
    parser.add_argument("--install-windows-task", action="store_true", help="註冊 Windows 系統每週一 08:00 自動排程工作")
    parser.add_argument("--diff", action="store_true", help="顯示三大來源抓取與現有資料庫之差別比對")

    args = parser.parse_args()
    mgr = FooyinAwardsManager()
    updater = FooyinWeeklyUpdater(mgr)

    if args.install_windows_task:
        install_windows_weekly_task()
    elif args.look:
        status = updater.inspect_sources_status()
        print(json.dumps(status, ensure_ascii=False, indent=2))
    elif args.diff:
        diff_res = updater.get_diff_analysis_with_template(public_mode=True)
        print(json.dumps(diff_res, ensure_ascii=False, indent=2))
    elif args.run_now:
        result = updater.run_update_pipeline()
        try:
            from embed_data import build_secure_data_js
            from security_crypto import DEFAULT_ADMIN_PASSPHRASE
            public_only = not os.path.exists(os.path.join(BASE_DIR, "fooyin_student_awards_standardized.json"))
            build_secure_data_js(passphrase=DEFAULT_ADMIN_PASSPHRASE, public_only=public_only)
        except Exception as e:
            print(f"[提示] 自動重建 data.js 略過: {e}")
        print("\n更新結果:", json.dumps(result, ensure_ascii=False, indent=2))
    elif args.schedule:
        updater.start_weekly_schedule()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
