"""Servidor local do Face Scan 3D.

Serve o app web (face_scan/) e expõe uma API mínima para salvar o rosto escaneado
vinculado a um aluno do AttendanceCon (entities/faces.json).

Uso (a partir da raiz do repositório):
    python face_scan/server.py                 # http://localhost:8000 (notebook)
    python face_scan/server.py --https         # https://<ip-da-rede>:8443 (celular)
"""
import argparse
import json
import os
import shutil
import socket
import ssl
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC = os.path.join(ROOT, "face_scan")
CERT_DIR = os.path.join(ROOT, ".cert")  # fora da pasta servida
MAX_BODY = 64 * 1024 * 1024

# Os serviços usam caminhos relativos ("entities/..."), então rodamos a partir da raiz.
os.chdir(ROOT)
sys.path.insert(0, ROOT)

from services.faces import register_face, update_face, search_face_by_student, list_faces  # noqa: E402
from services.student import list_students  # noqa: E402


class Handler(SimpleHTTPRequestHandler):
    # No Windows o registro às vezes mapeia .js para text/plain, o que quebra módulos ES.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".svg": "image/svg+xml",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=STATIC, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            return self.send_json(200, {"ok": True})
        if path == "/api/students":
            students = [{"id": s["id"], "name": s["name"]} for s in list_students()]
            return self.send_json(200, students)
        if path == "/api/faces":
            return self.send_json(200, list_faces())
        return super().do_GET()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path != "/api/faces":
            return self.send_json(404, {"error": "Not found"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self.send_json(413, {"error": "Invalid body size"})
        try:
            data = json.loads(self.rfile.read(length))
            id_student = int(data["id_student"])
            template = data["template"]
            descriptors = data["descriptors_base64"]
        except (ValueError, KeyError, TypeError):
            return self.send_json(400, {"error": "Invalid payload"})

        texture = data.get("texture_png_base64")
        if data.get("replace") and search_face_by_student(id_student):
            message = update_face(id_student, template, descriptors, texture)
        else:
            message = register_face(id_student, template, descriptors, texture)
        if message not in ("Saved", "Updated"):
            return self.send_json(409 if "already" in message else 400, {"error": message})
        return self.send_json(200, {"message": message, "face": search_face_by_student(id_student)})


def lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def ensure_certificate(cert, key):
    """Gera um certificado autoassinado com o openssl, se ainda não existir."""
    if cert and key:
        return cert, key
    cert = os.path.join(CERT_DIR, "cert.pem")
    key = os.path.join(CERT_DIR, "key.pem")
    if os.path.exists(cert) and os.path.exists(key):
        return cert, key
    if not shutil.which("openssl"):
        sys.exit(
            "Para HTTPS é preciso um certificado. Instale o OpenSSL (vem com o Git for Windows) "
            "ou passe --cert e --key de um certificado seu (ex.: gerado com mkcert)."
        )
    os.makedirs(CERT_DIR, exist_ok=True)
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "365",
         "-keyout", key, "-out", cert, "-subj", "/CN=attendancecon-face-scan"],
        check=True, capture_output=True,
    )
    return cert, key


def main():
    parser = argparse.ArgumentParser(description="Servidor do Face Scan 3D")
    parser.add_argument("--host", default=None, help="padrão: 127.0.0.1 (http) ou 0.0.0.0 (https)")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--https", action="store_true", help="necessário para usar a câmera no celular")
    parser.add_argument("--cert", help="arquivo PEM do certificado (opcional)")
    parser.add_argument("--key", help="arquivo PEM da chave privada (opcional)")
    args = parser.parse_args()

    use_https = args.https or bool(args.cert)
    port = args.port or (8443 if use_https else 8000)
    host = args.host or ("0.0.0.0" if use_https else "127.0.0.1")
    server = ThreadingHTTPServer((host, port), Handler)
    scheme = "http"
    if use_https:
        cert, key = ensure_certificate(args.cert, args.key)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        scheme = "https"

    print("Face Scan 3D rodando:")
    print(f"  Neste computador: {scheme}://localhost:{port}")
    if host != "127.0.0.1":
        print(f"  Na rede local:    {scheme}://{lan_ip()}:{port}")
    if not use_https:
        print("  (No celular a câmera exige HTTPS: rode com --https)")
    else:
        print("  O certificado é autoassinado: no celular, toque em 'Avançado' → 'Continuar'.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
