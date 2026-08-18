import json
from datetime import datetime, date
def load(a):
    with open(a, 'r', encoding="utf-8") as f:
        return json.load(f)
def next_id(li):
     if not li:
         return 1
     return max(item['id'] for item in li) + 1
def save(a, d):
    with open(a, 'w', encoding='utf-8') as f:
        json.dump(d, f, indent=4)
        
def calculate_age(birth_date):
    birth = datetime.strptime(birth_date, "%d/%m/%Y")
    today = date.today()
    age = today.year - birth.year
    if (today.month - today.day) < (birth.month - birth.day):
        age -= 1
    return age

def date_now():
    return date.today()