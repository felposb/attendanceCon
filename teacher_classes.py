from db_utils import save, load, next_id, date_now
from classes import search_class
from subject import search_subject
from employee import search_employee
TEACHER_CLASSES = "entities/teacher_classes.json"

def search_teacher_class(id):
  teacher_classes = load(TEACHER_CLASSES)
  for t in teacher_classes:
    same_id = t['id'] == id
    if same_id:
      return t
  return None

def register_teacher_classes(id_class, id_subject, id_employee):
  teacher_classes = load(TEACHER_CLASSES)
  classes = search_class(id_class)
  if classes is None:
    return "Class not found"
  subjects = search_subject(id_subject)
  if subjects is None:
    return "Subject not found"
  teacher = search_employee(id_employee)
  if teacher is None:
    return "Teacher not found"
  register = {
    "id": next_id(teacher_classes),
    "id_class": id_class,
    "id_subject": id_subject,
    "id_teacher": id_employee,
    "registered_day": date_now()
  }

  teacher_classes.append(register)
  save(TEACHER_CLASSES, teacher_classes)
  return "Saved"

def update_teacher_classes(id, id_class, id_subject):
  teacher_classes = load(TEACHER_CLASSES)
  for t in teacher_classes:
    same_id = t['id'] == id
    if same_id:
      if id_class != "":
        classes = search_class(int(id_class))
        if classes is None:
          return "Class not fount"
        t['id_class'] = id_class
      if id_subject != "":
        subjects = search_subject(int(id_subject))
        if subjects is None:
          return "Subjects not found"
        t['id_subject'] = id_subject

      save(TEACHER_CLASSES, teacher_classes)
      return "Updated"
  return "Teacher class not found"

def delete_teacher_class(id):
  teacher_class = load(TEACHER_CLASSES)
  for t in teacher_class:
    same_id = t['id'] ==id
    if same_id:
      teacher_class.remove(t)
      save(TEACHER_CLASSES, teacher_class)
      return "Deleted"
  return "Teacher class not found"

def list_teacher_classes():
  teacher_classes = load(TEACHER_CLASSES)
  return teacher_classes
    

        