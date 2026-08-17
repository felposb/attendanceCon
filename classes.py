from db_utils import save, load, next_id

CLASSES = "entities/classes.json"

def search_class(id):
    classes = load(CLASSES)
    for c in classes:
        same_id = c['id'] == id
        if same_id:
            return c
    return None
def register_class(number_class, letter_class):
    classes = load(CLASSES)
    for c in classes:
        same_number = c['number_class'] == number_class
        same_letter = c['letter_class'] == letter_class
        if same_letter and same_number:
            return "Its already exists"
    new_class = {
        "id": next_id(classes),
        "number_class": number_class,
        "letter_class": letter_class
    }
    classes.append(new_class)
    save(CLASSES, classes)
    return "Saved"

def update_class(id, number_class, letter_class):
    classes = load(CLASSES)
    for c in classes:
        same_id = c['id'] == id
        if same_id:
            if number_class != "":
                c['number_class'] = number_class
            if letter_class != "":
                c['letter_class'] = letter_class
            save(CLASSES, classes)
            return "Updated"
    return "It doesnt exists"

def delete_class(id):
    classes = load(CLASSES)
    for c in classes:
        same_id = c['id'] == id
        if same_id:
            classes.remove(c)
            save(CLASSES, classes)
            return "Deleted"
    return "It doesnt exists"

def list_classes(id):
    classes = load(CLASSES)
    return classes