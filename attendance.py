from db_utils import save, load, next_id
from student import search_student
ATTENDANCES = "entities/attendance.json"

def search_attendances(id):
    attendances = load(ATTENDANCE)
    for a in attendances:
        same_id = a['id']  == id
        if same_id:
            return a
    return None

def register_attendance(uid,id_classroom, id_teacher_class, id_student):
    attendances = load(ATTENDANCES)
    for a in attendances:
        same_uid = a['uid'] == uid
        same_id_student = a['id_student'] == id_student
        if same_id_student or same_uid:
            return "Its already exist"
    new_attendance = {
        "id": next_id(attendances),
        "uid": uid,
        "id_student": id_student,
        "id_classroom": id_classroom,
        "id_teacher_class": id_teacher_class
    }
    attendances.append(new_attendance)
    save(ATTENDANCES, attendances)
    return "Saved"
