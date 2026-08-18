from services.db_utils import save, load, next_id

SUBJECTS = "entities/subjects.json"
def search_subject(id):
    subjects = load(SUBJECTS)
    for s in subjects:
        same_id = s['id'] == id
        if same_id:
            return s
    return None

def register_subject(name):
    subjects = load(SUBJECTS)
    for s in subjects:
        if s['name'] == "" or s['name'] == name:
            return "Its already exists"
    new_subject = {
        "id": next_id(subjects),
        "name": name
    }
    subjects.append(new_subject)
    save(SUBJECTS, subjects)
    return "Saved"

def update_subject(id, name):
    subjects = load(SUBJECTS)
    for s in subjects:
        same_id = s["id"] == id
        if same_id:
            if name != "":
                s['name'] = name
            save(SUBJECTS, subjects)
            return "Updated"
    return "It doesnt exist"

def delete_subject(id):
    subjects = load(SUBJECTS)
    for s in subjects:
        same_id = s['id'] == id
        if same_id:
            subjects.remove(s)
            save(SUBJECTS, subjects)
            return "Removed"
    return "it Doesnt exist"

def list_subjects():
    subjects = load(SUBJECTS)
    return subjects