from services.db_utils import save, load, next_id
ATTENDANCES = "entities/attendance.json"

def search_attendances(id):
    attendances = load(ATTENDANCES)
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

def update_attendance(id, uid, id_classroom, id_teacher_class, id_student):
    attendance = load(ATTENDANCES)
    for a in attendance:
        same_id = a['id'] == id
        
