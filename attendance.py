from db_utils import save, load, next_id

ATTENDANCE = "entities/attendance.json"

def search_attendances(id):
    attendances = load(ATTENDANCE)
    for a in attendances:
        same_id = a['id']  == id
        if same_id:
            return a
    return None

def register_attendance(id_classroom, id_teacher_class, id_student):
    