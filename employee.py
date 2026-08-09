from db_utils import save, load, next_id

EMPLOYEES = "entities/employees.json"
def search_employee(id):
    employees = load(EMPLOYEES)
    for e in employees:
        same_id = e['id'] == id
        if same_id:
            return e
    return None

def register_employee(id, name, role):
    employees = load(EMPLOYEES)
    employee = search_employee(id)
    if employee is not None:
        return "Employee has already exists"
    new_employee = {
        "id": next_id(employees),
        "name": name,
        "role": role
    }
    employees.append(new_employee)
    save(EMPLOYEES, employees)
    return "Saved"

def update_employee(id, name, role):
    employees = load(EMPLOYEES)
    for e in employees:
        same_id = e['id'] == id
        if same_id:
            if name != "":
                e['name'] = name
            if role != "":
                e["role"] = role
            save(EMPLOYEES, employees)
            return "Updated"
    return "Employee doesnt exists"

def delete_employee(id):
    employees = load(EMPLOYEES)
    for e in employees:
        same_id = e['id'] == id
        if same_id:
            employees.remove(e)
            save(EMPLOYEES,employees)
            return "Deleted"
    return "Employee doesnt exists"

def list_employees():
    employees = load(EMPLOYEES)
    return employees