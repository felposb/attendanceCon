from services.student import search_student
from services.classes import search_class
from services.db_utils import save, load, next_id

ENROLLMENTS = "entities/enrollments.json"

def search_enrollment(id):
    enrollments = load(ENROLLMENTS)
    for e in enrollments:
        same_id = e['id'] == id
        if same_id:
            return e
    return None

def register_enrollment(id_student, id_class, number):
    enrollments = load(ENROLLMENTS)
    student = search_student(id_student)
    if student is None:
        return "Student doesnt exist"
    class1 = search_class(id_class)
    if class1 is None:
        return "Class doesnt exist"
    for e in enrollments:
        if e['id_student'] == id_student and e['id_class'] == id_class:
            return "Student is already enrolled in this class"
        if e['number'] == number:
            return "This enrollment has already exist"
    new_enrollment = {
        "id": next_id(enrollments),
        "number": number,
        "id_student": id_student,
        "id_class": id_class
    }
    enrollments.append(new_enrollment)
    save(ENROLLMENTS, enrollments)
    return "Saved"

def update_enrollment(id, id_student, id_class, number):
    enrollments = load(ENROLLMENTS)
    for e in enrollments:
        same_id = e['id'] == id
        if same_id: 
            if id_student != "":
                id_student = int(id_student)
                student = search_student(id_student)
                if student is None:
                    return "Student doesnt exist"
                e['id_student'] = id_student
            if id_class != "":
                id_class = int(id_class)
                class1 = search_class(id_class)
                if class1 is None:
                    return "Class doesnt exist"
                e['id_class'] = id_class
            if number != "":
                number = int(number)
                for enrollment in enrollments:
                    if(enrollment['number'] == number and enrollment['id'] != id):
                        return "This number already exist"
                e['number'] = number
            save(ENROLLMENTS, enrollments)
            return "Updated"
    return "It doesnt exist"

def delete_enrollment(id):
    enrollments = load(ENROLLMENTS)
    for e in enrollments:
        same_id = e['id'] == id
        if same_id:
            enrollments.remove(e)
            save(ENROLLMENTS, enrollments)
            return "Deleted"
    return "It doesnt exist"

def list_enrollments():
    enrollments = load(ENROLLMENTS)
    return enrollments