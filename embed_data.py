import json
import os

json_path = os.path.join(os.path.dirname(__file__), "fooyin_student_awards_standardized.json")
data_js_path = os.path.join(os.path.dirname(__file__), "web", "data.js")

with open(json_path, "r", encoding="utf-8") as f:
    records = json.load(f)

js_content = f"""// 輔英科技大學 學生獲獎紀錄標準資料庫 (共 {len(records)} 筆)
window.INITIAL_AWARDS_DATA = {json.dumps(records, ensure_ascii=False, indent=2)};

// 定義學院與系所對照表
window.FOOYIN_COLLEGES_MAP = {{
    "護理學院": ["護理系", "高齡全程照顧視導學士學位學程", "長期照顧學位學程"],
    "醫學與健康學院": ["醫學檢驗生物技術系", "物理治療系", "醫學影像暨放射科學系", "營養與健康美容系", "健康美容系", "保健營養系"],
    "環境與生命學院": ["環境工程與科學系", "應用化學及材料科學系", "生物科技系", "職業安全衛生系"],
    "人文與管理學院": ["幼兒保育系", "資訊管理系", "應用外語系", "休閒與遊憩事業管理系"],
    "跨學院/校隊": ["全校跨領域團隊", "輔英運動代表隊", "創新創業培訓隊"]
}};
"""

with open(data_js_path, "w", encoding="utf-8") as f:
    f.write(js_content)

print(f"Successfully embedded {len(records)} records into web/data.js.")
