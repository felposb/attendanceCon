from datetime import datetime, date
from db_utils import save, load, next_id, calculate_age
STUDENTS = "entities/students.json"
def search_student(id):
    students = load(STUDENTS)
    for s in students:
        same_id = s['id'] == id
        if same_id:
            return s
    return None
    
def register_student(name, birth_date, adress, phone):
    students = load(STUDENTS)
    for s in students:
        same_phone = s['phone'] 
        if same_phone:
            return "This students already exists"
    age = calculate_age(birth_date)
    new_student = {
        "id": next_id(students),
        "name": name,
        "age": age,
        "birth_date": birth_date,
        "adress": adress,
        "phone": phone
    }
    students.append(new_student)
    save(STUDENTS, students)
    return "Saved"

def update_student(id, name, birth_date,  adress, phone):
    students = load(STUDENTS)
    for s in students:
        same_id = s['id'] == id
        if same_id:           
            if name != "":
                s['name'] = name
            if birth_date != "":
                s['birth_date'] = birth_date
            if adress != "":
                s['adress'] = adress
            if phone != "":
                s['phone'] = phone
            
            save(STUDENTS, students)
            return "Updated"   
    return "Student doesnt exists"


def delete_student(id):
    students = load(STUDENTS)
    for s in students:
        same_id = s['id'] == id
        if same_id:
            students.remove(s)
            save(STUDENTS, students)
            return "Removed"
    return "Student doesnt exists"

def list_students():
    students = load(STUDENTS)
    return students