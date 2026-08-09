from datetime import datetime, date
from db_utils import save, load, next_id

CLASSROOMS = "entities/classrooms.json"

def search_classroom(id):
    classrooms = load(CLASSROOMS)
    for c in classrooms:
        same_id = c['id'] == id
        if same_id:
            return c
    return None

def register_classroom(id, classroom_number, block):
    classrooms = load(CLASSROOMS)
    classroom = search_classroom(id)
    if classroom is not None:
        return "Classroom has already exists"
    for c in classrooms:
        same_classroom_number = c['classroom_number'] == classroom_number
        same_block = c['block'] == block
        if same_block or same_classroom_number:
            return "Its already exist"
    new_classroom = {
        "id": next_id(classrooms),
        "classroom_number": classroom_number,
        "block": block
    }
    classrooms.append(new_classroom)
    save(CLASSROOMS, classrooms)
    return "Saved"

def update_classroom(id, classroom_number, block):
    classrooms = load(CLASSROOMS)
    for classroom in classrooms:
        same_id = classroom['id'] == id
        if same_id:
            new_number = (classroom_number if classroom_number != "" else classroom['classroom_number'])
            new_block = (block if block != "" else classroom['block'])
            for c in classrooms:
                if(c['classroom_number'] == new_number and c['block'] == block and c['id'] != id):
                    return "It already exist"
            c['classroom_number'] = new_number
            c['block'] = new_block
            save(CLASSROOMS, classrooms)
            return "Updated" 
    return "Classroom doesnt exist"
                    
def delete_classroom(id):
    classrooms = load(CLASSROOMS)
    for classroom in classrooms:
        same_id = classroom['id'] == id
        if same_id:
            classrooms.remove(classroom)
            save(CLASSROOMS, classrooms)
            return "Deleted"
    return "Classroom doesnt exist"

def list_classrooms():
    classrooms = load(CLASSROOMS)
    return classrooms