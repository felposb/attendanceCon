from student import search_student
from classes import search_class
from db_utils import save, load, next_id

ENROLLMENTS = "entities/enrollments.json"

def search_enrollment(id):
    enrollments = load(ENROLLMENTS)
    for e in enrollments:
        same_id = e['id'] == id
        if same_id:
            return e
    return None

def register_enrollment(id, student_id, class_id, number):
    enrollments = load(ENROLLMENTS)
    enrollment = search_enrollment(id)
    if enrollment is not None:
        return "Its already exists"
    student = search_student(student_id)
    if student is None:
        return "Student doesnt exist"
    class1 = search_class(class_id)
    if class1 is None:
        return "Class doesnt exist"
    for e in enrollments:
        if e['number'] == number:
            return "This enrollment has already exist"
    new_enrollment = {
        "id": next_id(enrollments),
        "number": number,
        "student_id": student_id,
        "class_id": class_id
    }
    enrollments.append(new_enrollment)
    save(ENROLLMENTS, enrollments)
    return "Saved"

def update_enrollment(id, student_id, class_id, number):
    enrollments = load(ENROLLMENTS)
    for e in enrollments:
        same_id = e['id'] == id
        if same_id: 
            if student_id != "":
                student_id = int(student_id)
                student = search_student(student_id)
                if student is None:
                    return "Student doesnt exist"
                e['student_id'] = student_id
            if class_id != "":
                class_id = int(class_id)
                class1 = search_class(class_id)
                if class1 is None:
                    return "Class doesnt exist"
                e['class_id'] = class_id
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