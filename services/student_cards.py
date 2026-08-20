from services.db_utils import load, save, next_id, date_now
from services.student import search_student
from services.cards import search_cards
STUDENTS_CARDS = 'entities/students_cards.json'


def search_students_cards(id):
    student_cards = load(STUDENTS_CARDS)
    for sc in student_cards:
        same_id = sc['id'] == id
        if same_id:
            return sc
    return None

def register_students_cards(id_card, id_student):
    students_cards = load(STUDENTS_CARDS)
    card = search_cards(id_card)
    if card is None:
        return "not found"
    student = search_student(id_student)
    if student is None:
        return "Not found"
    for s in students_cards:
        same_card_id = s['id_card'] == id_card
        same_student_id = s['id_student'] == id_student
        if same_card_id or same_student_id:
            return "Its already exist"
    new_student_card = {
        "id": next_id(students_cards),
        "id_card": id_card,
        "id_student": id_student,
        "register_day": date_now()
    }
    students_cards.append(new_student_card)
    save(STUDENTS_CARDS, students_cards)
    return "Saved"

def update_student_card(id, id_card, id_student):
    student_cards = load(STUDENTS_CARDS)
    for s in student_cards:
        same_id = s['id'] == id
        if same_id:
            if id_card != "":
                card = search_cards(int(id_card))
                if card is None:
                    return "Not found"
                s['id_card'] = id_card
            if id_student != "":
                student = search_cards(int(id_student))
                if student is None:
                    return "Not found"
                s['id_student'] = id_student
            save(STUDENTS_CARDS, student_cards)
            return "Updated"
        
def delete_student_card(id):
    student_card = load(STUDENTS_CARDS)
    for s in student_card:
        same_id = s['id'] == id
        if same_id:
            student_card.remove(s)
            save(STUDENTS_CARDS, student_card)
            return "Deleted"
        
def list_student_card():
    student_card = load(STUDENTS_CARDS)
    return student_card
                