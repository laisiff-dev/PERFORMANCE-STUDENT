import json
import csv
import random

colleges_depts = {
    "護理學院": ["護理系", "高齡全程照顧視導學士學位學程", "長期照顧學位學程"],
    "醫學與健康學院": ["醫學檢驗生物技術系", "物理治療系", "醫學影像暨放射科學系", "營養與健康美容系", "健康美容系", "保健營養系"],
    "環境與生命學院": ["環境工程與科學系", "應用化學及材料科學系", "生物科技系", "職業安全衛生系"],
    "人文與管理學院": ["幼兒保育系", "資訊管理系", "應用外語系", "休閒與遊憩事業管理系"],
    "跨學院/校隊": ["全校跨領域團隊", "輔英運動代表隊", "創新創業培訓隊"]
}

grades = ["五專3年1班", "五專4年2班", "五專5年1班", "四技1年1班", "四技2年2班", "四技3年1班", "四技4年1班", "碩士班1年級", "進二技2年1班"]

levels = ["國際競賽", "國內競賽", "體育競賽", "專業證照", "特殊優良事蹟"]

awards_pool = {
    "國際競賽": [
        ("德國iF設計獎 / 國際發明展", "智慧型室內CO₂捕集與探測系統", "金牌", 20000),
        ("首爾國際發明展", "高齡化智慧護理輔助照護裝置", "銀牌", 15000),
        ("日本東京國際發明展", "綠色永續水質微藻淨化技術", "金牌", 20000),
        ("美國IEEE國際生醫工程競賽", "AI影像輔助診斷與檢驗系統", "銅牌", 10000),
        ("日內瓦國際發明展", "銀髮族急救安全監測穿戴裝置", "特優", 18000)
    ],
    "國內競賽": [
        ("全國技專校院學生實務專題製作競賽", "智慧長期照護創新與臨床應用專題", "第一名", 12000),
        ("教育部全國大專校院創新創業競賽", "循環經濟與生物基機能性產品開發", "冠軍", 15000),
        ("臺灣大專院校醫技專題學術研討會", "新型抗藥性細菌快速檢測晶片開發", "佳作", 5000),
        ("全國大專校院資訊應用創新競賽", "醫療院所智慧排班與物料管理系統", "亞軍", 10000),
        ("高雄市大專青年盃社會創新提案", "社區高齡健康促進與營養膳食推廣", "特優", 8000)
    ],
    "體育競賽": [
        ("全國大專院校運動會 (全大運)", "公開女子組田徑 400 公尺接力", "金牌", 10000),
        ("全國大專校院羽球錦標賽", "混合雙打組", "冠軍", 8000),
        ("全國大專校院排球聯賽 (UVL)", "公開二級女子排球錦標賽", "亞軍", 10000),
        ("全國大專游泳錦標賽", "女子 200 公尺混合式", "第一名", 8000),
        ("大專校院跆拳道錦標賽", "男子品勢個人組", "銅牌", 5000)
    ],
    "專業證照": [
        ("考選部專門職業及技術人員國考", "護理師國家考試全國榜首與特優", "榜首", 15000),
        ("考選部醫事檢驗師國家考試", "醫事檢驗師國家證照通過", "考照通過", 5000),
        ("考選部物理治療師國家考試", "物理治療師考照通過", "考照通過", 5000),
        ("行政院環保署廢水處理專責人員", "甲級廢水處理專責人員合格證書", "甲級證照", 6000),
        ("勞動部技能檢定", "美容甲級技術士專業證照", "甲級證照", 6000)
    ],
    "特殊優良事蹟": [
        ("教育部大專優秀青年選拔", "全國大專優秀青年代表榮譽", "全國大專優秀青年", 10000),
        ("教育部青年署青聚點地方創生計畫", "偏鄉長者健康關懷與社會實踐服務", "績優團隊", 12000),
        ("高雄市青年局志工服務楷模", "高齡社區義診與健康宣導服務隊", "卓越志工獎", 8000),
        ("輔英科技大學校友會優秀學生獎學金", "學業與服務特殊優良表現", "特優獎學金", 10000),
        ("國際紅十字會救護志工表揚", "急救醫療服務與特殊貢獻", "急救楷模", 6000)
    ]
}

sources = [
    "113-1行政會議", "113-3行政會議", "113-5行政會議", "113-8行政會議",
    "114-2行政會議", "114-4行政會議", "114-6行政會議", "114-9行政會議",
    "115-1行政會議", "115-3行政會議", "校務會議紀錄", "學校公開官方網站"
]

high_schools = [
    "高雄市立高雄女子高級中學", "國立鳳山高級中學", "國立屏東高級中學",
    "高雄市立中山高級中學", "輔英科技大學附設附中", "國立臺南第一高級中學",
    "國立臺南第二高級中學", "高雄市立瑞祥高級中學", "國立岡山高級中學",
    "國立潮州高級中學", "高雄市立前鎮高級中學", "樹德家商", "中山工商"
]

statuses = ["待通知", "通知已發送", "已線上簽領", "已完成撥款"]
status_weights = [0.15, 0.25, 0.35, 0.25]

student_names = [
    "陳雅婷", "林宇翔", "張家豪", "黃怡君", "許哲瑋", "蔡詩涵", "吳冠霖", "鄭羽婷",
    "郭威廷", "楊晨欣", "劉彥宏", "謝佩珊", "曾智捷", "彭思涵", "蘇健銘", "葉馨文",
    "莊浩宇", "江佩君", "呂宗翰", "蕭奉儀", "游智凱", "簡雅雯", "柯建宏", "賴威任",
    "羅佳蓉", "宋尚霖", "唐千惠", "韓承翰", "董宜蓁", "鍾名翔", "薛紫晴", "方冠華"
]

teachers = ["張哲銘 教授", "李佳蓉 副教授", "王建智 教授", "陳秀美 助理教授", "黃宗賢 教授", "林雅萍 副教授", "劉國強 教授", "鄭淑芬 教授"]

data = []
random.seed(42)

for i in range(1, 484):
    academic_year = f"{random.choice([113, 114, 115])}學年度"
    source = random.choice(sources)
    college = random.choice(list(colleges_depts.keys()))
    dept = random.choice(colleges_depts[college])
    grade = random.choice(grades)
    
    # 學生姓名 (1~3人)
    num_students = random.choices([1, 2, 3], weights=[0.6, 0.3, 0.1])[0]
    selected_students = random.sample(student_names, num_students)
    student_str = "、".join(selected_students)
    student_id = f"11{random.randint(1, 3)}{random.randint(10000, 99999)}"
    
    teacher = random.choice(teachers)
    level = random.choice(levels)
    event_item = random.choice(awards_pool[level])
    event_name = event_item[0]
    work_name = event_item[1]
    award_rank = event_item[2]
    amount = event_item[3] + random.choice([0, 1000, 2000, 3000, 5000])
    
    status = random.choices(statuses, weights=status_weights)[0]
    notify_date = f"2026-08-{random.randint(10, 28):02d}" if status != "待通知" else ""
    deadline = f"2026-10-{random.randint(15, 30):02d}"
    high_school = random.choice(high_schools)
    evidence_url = f"https://drive.google.com/file/d/fy-award-proof-{i:03d}/view" if random.random() > 0.3 else "https://www.fooyin.edu.tw/news/detail/" + str(1000 + i)
    remarks = f"榮獲{award_rank}，展現輔英科技大學{college}{dept}師生優異研發與專業實力。"
    
    record = {
        "編號": i,
        "學年度": academic_year,
        "資料來源": source,
        "所屬學院": college,
        "系所名稱": dept,
        "學制班級": grade,
        "獲獎學生": student_str,
        "學生學號": student_id,
        "指導老師": teacher,
        "競賽層級": level,
        "競賽或活動名稱": event_name,
        "參賽項目或作品名稱": work_name,
        "榮譽獎項": award_rank,
        "獎助金金額": amount,
        "發放與領獎狀態": status,
        "通知時間": notify_date,
        "領獎截止日期": deadline,
        "原畢業學校": high_school,
        "佐證連結": evidence_url,
        "備註": remarks
    }
    data.append(record)

# Save JSON
json_path = "e:/文亮/輔英'/PERFORMANCE for  TUDENT/fooyin_student_awards_standardized.json"
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

# Save CSV (UTF-8 with BOM)
csv_path = "e:/文亮/輔英'/PERFORMANCE for  TUDENT/fooyin_student_awards_standardized.csv"
fieldnames = list(data[0].keys())
with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=fieldnames)
    writer.writeheader()
    writer.writerows(data)

print(f"Successfully generated {len(data)} records in JSON and CSV format.")
