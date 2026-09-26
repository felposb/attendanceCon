import base64
import json
import os
from datetime import datetime
from services.db_utils import save, load, next_id
from services.student import search_student
FACES = "entities/faces.json"
FACES_DIR = "entities/faces"

def search_face(id):
    faces = load(FACES)
    for f in faces:
        same_id = f['id'] == id
        if same_id:
            return f
    return None

def search_face_by_student(id_student):
    faces = load(FACES)
    for f in faces:
        same_student = f['id_student'] == id_student
        if same_student:
            return f
    return None

def _write_files(id, template, descriptors_b64, texture_b64):
    os.makedirs(FACES_DIR, exist_ok=True)
    files = {
        "template_file": f"{FACES_DIR}/face_{id}.json",
        "descriptors_file": f"{FACES_DIR}/face_{id}.bin",
        "texture_file": None,
    }
    with open(files["template_file"], 'w', encoding='utf-8') as f:
        json.dump(template, f)
    with open(files["descriptors_file"], 'wb') as f:
        f.write(base64.b64decode(descriptors_b64))
    if texture_b64:
        files["texture_file"] = f"{FACES_DIR}/face_{id}.png"
        with open(files["texture_file"], 'wb') as f:
            f.write(base64.b64decode(texture_b64))
    return files

def _remove_files(face):
    for key in ("template_file", "descriptors_file", "texture_file"):
        path = face.get(key)
        if path and os.path.exists(path):
            os.remove(path)

def _validate(template, descriptors_b64):
    descriptors = template.get('descriptors', {})
    count = descriptors.get('count', 0)
    dim = descriptors.get('dim', 0)
    expected = count * dim * 4
    size = len(base64.b64decode(descriptors_b64))
    if expected == 0 or size != expected:
        return f"Invalid descriptors: expected {expected} bytes, got {size}"
    return None

def register_face(id_student, template, descriptors_b64, texture_b64=None):
    faces = load(FACES)
    if search_student(id_student) is None:
        return "Student doesnt exists"
    for f in faces:
        same_student = f['id_student'] == id_student
        if same_student:
            return "This student already has a face registered"
    error = _validate(template, descriptors_b64)
    if error:
        return error

    id = next_id(faces)
    files = _write_files(id, template, descriptors_b64, texture_b64)
    new_face = {
        "id": id,
        "id_student": id_student,
        "created_at": datetime.now().isoformat(timespec='seconds'),
        "landmark_count": template['descriptors']['count'],
        "descriptor_dim": template['descriptors']['dim'],
        "views": [v['name'] for v in template.get('views', [])],
        **files
    }
    faces.append(new_face)
    save(FACES, faces)
    return "Saved"

def update_face(id_student, template, descriptors_b64, texture_b64=None):
    faces = load(FACES)
    for f in faces:
        same_student = f['id_student'] == id_student
        if same_student:
            error = _validate(template, descriptors_b64)
            if error:
                return error
            _remove_files(f)
            f.update(_write_files(f['id'], template, descriptors_b64, texture_b64))
            f['created_at'] = datetime.now().isoformat(timespec='seconds')
            f['landmark_count'] = template['descriptors']['count']
            f['descriptor_dim'] = template['descriptors']['dim']
            f['views'] = [v['name'] for v in template.get('views', [])]
            save(FACES, faces)
            return "Updated"
    return "Face doesnt exists"

def delete_face(id):
    faces = load(FACES)
    for f in faces:
        same_id = f['id'] == id
        if same_id:
            _remove_files(f)
            faces.remove(f)
            save(FACES, faces)
            return "Removed"
    return "Face doesnt exists"

def list_faces():
    faces = load(FACES)
    return faces

def load_descriptors(id):
    """Retorna (count, dim, bytes float32 little-endian) dos vetores de um rosto."""
    face = search_face(id)
    if face is None:
        return None
    with open(face['descriptors_file'], 'rb') as f:
        data = f.read()
    return face['landmark_count'], face['descriptor_dim'], data
