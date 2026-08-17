from db_utils import save, load, date_now, next_id
from student import search_student
CARDS = "entities/cards.json"

def search_cards(id):
    cards = load(CARDS)
    for c in cards:
        same_id = c['id'] == id
        if same_id:
            return c
    return None

def register_cards(uid, id_student):
    cards = load(CARDS)
    student = search_student(id_student)
    if student is None:
        return "Student not found"
    for c in cards:
        same_uid = c['uid'] == uid
        same_id_student = c['id_student'] == id_student
        if same_uid or same_id_student:
            return "This  already exists"
        
    new_card = {
        "id": next_id(cards),
        "uid": uid,
        "id_student": id_student
    }
    cards.append(new_card)
    save(CARDS, cards)
    return "Saved"

def update_cards(id, uid, id_student):
    cards = load(CARDS)
    for c in cards:
        same_id = c['id'] == id
        if same_id:
            if uid != "":
                for card in cards:
                    if card['uid'] == uid and card['id'] != id:
                        return "This card already exist"
                c['uid'] = uid
            if id_student != "":
                student = search_student(int(id_student))
                if student is None:
                    return "Not found"
                for card in cards:
                    if card['id_student'] == id_student and card['id'] != id:
                        return "This id_student already has a card assigned"
                c['id_student'] = id_student
            save(CARDS, cards)
            return "Updated"
    return "Not found"

def delete_cards(id):
    cards = load(CARDS)
    for c in cards:
        if c['id'] == id:
            cards.remove(c)
            save(CARDS, cards)
            return "Deleted"
    return "Not found"

def list_cards():
    cards = load(CARDS)
    return cards