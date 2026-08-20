from services.db_utils import save, load, date_now, next_id
from services.student import search_student
CARDS = "entities/cards.json"

def search_cards(id):
    cards = load(CARDS)
    for c in cards:
        same_id = c['id'] == id
        if same_id:
            return c
    return None

def register_cards(uid):
    cards = load(CARDS)
    for c in cards:
        same_uid = c['uid'] == uid
        if same_uid:
            return "This  already exists"
        
    new_card = {
        "id": next_id(cards),
        "uid": uid,
    }
    cards.append(new_card)
    save(CARDS, cards)
    return "Saved"

def update_cards(id, uid):
    cards = load(CARDS)
    for c in cards:
        same_id = c['id'] == id
        if same_id:
            if uid != "":
                for card in cards:
                    if card['uid'] == uid and card['id'] != id:
                        return "This card already exist"
                c['uid'] = uid
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