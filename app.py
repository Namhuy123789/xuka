from flask import Flask, request, jsonify, send_from_directory, send_file, render_template, abort, redirect, url_for
from werkzeug.utils import secure_filename
from werkzeug.exceptions import NotFound  # Added to fix NameError
from pathlib import Path
from datetime import datetime
from flask_wtf.csrf import CSRFProtect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import re
import json
import os
from flask_socketio import SocketIO, emit
from Crypto.Cipher import AES
from Crypto.Protocol.KDF import PBKDF2
from Crypto.Hash import SHA256
import base64
from flask import send_from_directory
import subprocess
import sys
import os
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()
app = Flask(__name__, static_folder='static', template_folder='templates')
app.config["JSONIFY_PRETTYPRINT_REGULAR"] = False
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "change_this_secret_key")

# Đường dẫn thư mục
BASE_DIR = Path(__file__).resolve().parent
QUESTIONS_DIR = BASE_DIR / "questions"
RESULTS_DIR = BASE_DIR / "results"
STATIC_DIR = BASE_DIR / "static"
USERS_FILE = STATIC_DIR / "users.json"
ADMIN_FILE = STATIC_DIR / "users1.json"

# Tạo các thư mục nếu chưa tồn tại
for directory in [QUESTIONS_DIR, RESULTS_DIR, STATIC_DIR]:
    directory.mkdir(exist_ok=True)

socketio = SocketIO(app, async_mode="threading")
csrf = CSRFProtect(app)
limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    storage_uri="memory://",
    default_limits=["100 per 5 minutes"]
)

current_command = None


# Lấy API key từ .env
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("❌ GEMINI_API_KEY chưa được thiết lập trong .env")

# Cấu hình Gemini
genai.configure(api_key=api_key)
model = genai.GenerativeModel("gemini-1.5-flash")


@app.route("/ask", methods=["POST"])
@csrf.exempt
def ask():
    data = request.get_json(silent=True) or {}
    user_msg = data.get("message", "").strip()
    if not user_msg:
        return jsonify({"error": "No message provided"}), 400

    try:
        resp = model.generate_content(
            f"Bạn là trợ lý AI thông minh, trả lời mọi câu hỏi một cách chi tiết, chính xác và lịch sự.\n\nNgười dùng: {user_msg}"
        )

        # Kiểm tra cấu trúc response an toàn
        reply = ""
        if getattr(resp, "candidates", None):
            parts = getattr(resp.candidates[0].content, "parts", [])
            reply = "".join([getattr(p, "text", "") for p in parts]).strip()

        if not reply:
            reply = "AI không trả lời được câu hỏi này."

        return jsonify({"reply": reply})

    except Exception as e:
        app.logger.exception(f"Lỗi /ask: {e}")
        return jsonify({"error": str(e), "reply": "Lỗi server nội bộ"}), 500








def get_interfaces():
    """Lấy danh sách tên interface mạng trên Windows"""
    try:
        result = subprocess.run(
            ["netsh", "interface", "show", "interface"],
            capture_output=True, text=True, check=True
        )
        lines = result.stdout.splitlines()
        interfaces = []
        for line in lines:
            # bỏ dòng tiêu đề
            if line.strip().startswith("Admin State") or line.strip().startswith("---") or not line.strip():
                continue

            # lấy tên interface từ cột cuối
            parts = line.split()
            if len(parts) >= 4:
                iface = " ".join(parts[3:])
                interfaces.append(iface)
        return interfaces
    except Exception as e:
        print("[ERROR] Lấy danh sách interface thất bại:", e)
        return []


def set_network(state: str):
    """Bật/tắt toàn bộ interface"""
    interfaces = get_interfaces()
    if not interfaces:
        print("[ERROR] Không tìm thấy interface nào.")
        return False

    success = True
    for iface in interfaces:
        result = subprocess.run(
            ["netsh", "interface", "set", "interface", iface, state],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            print(f"[ERROR] {iface} -> {result.stderr.strip()}")
            success = False
        else:
            print(f"[INFO] {iface} -> {state}")
    return success




# Hàm ngắt kết nối mạng
def disable_network():
    adapters = ["Wi-Fi", "Local Area Connection* 2"]  # thay theo netsh show interface
    for adapter in adapters:
        try:
            subprocess.run(
                ["netsh", "interface", "set", "interface", adapter, "disable"],
                check=True,
                shell=True
            )
            print(f"[INFO] Đã ngắt mạng trên {adapter}")
        except Exception as e:
            print(f"[ERROR] Không thể ngắt {adapter}: {e}")

# Hàm bật lại kết nối mạng
def enable_network():
    adapters = ["Wi-Fi", "Local Area Connection* 2"]
    for adapter in adapters:
        try:
            subprocess.run(
                ["netsh", "interface", "set", "interface", adapter, "enable"],
                check=True,
                shell=True
            )
            print(f"[INFO] Đã bật lại mạng trên {adapter}")
        except Exception as e:
            print(f"[ERROR] Không thể bật {adapter}: {e}")



def disconnect_network():
    return set_network("disabled")


def reconnect_network():
    return set_network("enabled")

# --- Helpers ---
def load_users(file_path: Path):
    if not file_path.exists():
        print(f"[WARN] File {file_path} không tồn tại, trả về danh sách rỗng")
        return []
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if not isinstance(data, list):
                print(f"[WARN] File {file_path} không có định dạng danh sách hợp lệ")
                return []
            return data
    except json.JSONDecodeError as e:
        app.logger.error(f"Lỗi giải mã JSON trong {file_path}: {e}")
        return []
    except Exception as e:
        app.logger.error(f"Lỗi đọc file {file_path}: {e}")
        return []

def list_exam_codes():
    codes = []
    pattern = re.compile(r'^questions(\d{3,})\.json$')
    for p in QUESTIONS_DIR.glob("questions*.json"):
        m = pattern.match(p.name)
        if m:
            code = m.group(1)
            if code.isdigit():
                codes.append(code)
    return sorted(set(codes), key=lambda x: int(x))

MASTER_PASSPHRASE = os.environ.get("MASTER_PASSPHRASE", "thay-bang-chuoi-bi-mat")

def decrypt_qr_data(encrypted_data: str):
    try:
        print(f"[DEBUG] Nhận qr_value: {encrypted_data}")
        parts = encrypted_data.split('.')
        if len(parts) != 4 or parts[0] != 'v1':
            raise ValueError("Định dạng mã QR không hợp lệ (phải là v1.<salt>.<iv>.<ciphertext+tag>)")

        print(f"[DEBUG] Phân tích qr_value: salt={parts[1]}, iv={parts[2]}, ct_and_tag={parts[3]}")
        
        try:
            salt = base64.b64decode(parts[1], validate=True)
            print("[DEBUG] Giải mã base64 salt thành công")
        except Exception as e:
            print(f"[ERROR] Lỗi giải mã base64 salt: {str(e)}")
            raise ValueError(f"QR chứa base64 không hợp lệ (salt): {str(e)}")
        
        try:
            iv = base64.b64decode(parts[2], validate=True)
            print("[DEBUG] Giải mã base64 iv thành công")
        except Exception as e:
            print(f"[ERROR] Lỗi giải mã base64 iv: {str(e)}")
            raise ValueError(f"QR chứa base64 không hợp lệ (iv): {str(e)}")
        
        try:
            ct_and_tag = base64.b64decode(parts[3], validate=True)
            print("[DEBUG] Giải mã base64 ct_and_tag thành công")
        except Exception as e:
            print(f"[ERROR] Lỗi giải mã base64 ct_and_tag: {str(e)}")
            raise ValueError(f"QR chứa base64 không hợp lệ (ciphertext+tag): {str(e)}")

        if len(ct_and_tag) < 16:
            raise ValueError("Ciphertext không hợp lệ (thiếu tag)")

        ciphertext, tag = ct_and_tag[:-16], ct_and_tag[-16:]
        key = PBKDF2(
            MASTER_PASSPHRASE.encode("utf-8"),
            salt,
            dkLen=32,
            count=100000,
            hmac_hash_module=SHA256
        )
        cipher = AES.new(key, AES.MODE_GCM, nonce=iv)
        plaintext = cipher.decrypt_and_verify(ciphertext, tag)
        data = json.loads(plaintext.decode("utf-8"))
        print(f"[DEBUG] Giải mã QR thành công: {data}")
        return data

    except (ValueError, KeyError, json.JSONDecodeError) as e:
        app.logger.error(f"Lỗi định dạng dữ liệu QR: {e}")
        raise
    except Exception as e:
        app.logger.error(f"Lỗi giải mã QR: {e}")
        raise

# --- Routes ---
@app.post("/api/decrypt_qr")
@csrf.exempt
def api_decrypt_qr():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"status": "error", "msg": "Dữ liệu JSON không hợp lệ"}), 400

        qr_value = str(data.get("qr_value", "")).strip()
        print(f"[DEBUG] Giá trị qr_value nhận được: {qr_value}")
        if not qr_value:
            return jsonify({"status": "error", "msg": "Thiếu dữ liệu QR"}), 400

        if qr_value.startswith('v1.'):
            try:
                decoded_data = decrypt_qr_data(qr_value)
                username = decoded_data.get("username", "").strip()
                password = decoded_data.get("password", "").strip()
                hoten = decoded_data.get("hoten", "").strip()
                sbd = decoded_data.get("sbd", "").strip()
                ngaysinh = decoded_data.get("ngaysinh", "").strip()
            except Exception as e:
                return jsonify({"status": "error", "msg": f"Lỗi giải mã QR: {str(e)}"}), 400
        else:
            if ":" not in qr_value:
                return jsonify({
                    "status": "error",
                    "msg": "Mã QR không hợp lệ, phải có dạng username:password hoặc v1.<salt>.<iv>.<data>"
                }), 400
            username, password = qr_value.split(":", 1)
            hoten, sbd, ngaysinh = "", "", ""

        admins = load_users(ADMIN_FILE)
        for user in admins:
            if user.get("username") == username and user.get("password") == password:
                return jsonify({
                    "status": "success",
                    "role": "admin",
                    "user": user,
                    "redirect": url_for('index')
                }), 200

        users = load_users(USERS_FILE)
        for user in users:
            if user.get("username") == username and user.get("password") == password:
                return jsonify({
                    "status": "success",
                    "role": "user",
                    "user": user,
                    "redirect": url_for('index')
                }), 200

        if qr_value.startswith('v1.') and username and password:
            return jsonify({
                "status": "success",
                "role": "user",
                "user": {
                    "username": username,
                    "hoten": hoten,
                    "sbd": sbd,
                    "ngaysinh": ngaysinh
                },
                "redirect": url_for('index')
            }), 200

        return jsonify({"status": "fail", "msg": "Mã QR không hợp lệ hoặc tài khoản không tồn tại"}), 401

    except ValueError as ve:
        return jsonify({
            "status": "error",
            "msg": f"Lỗi định dạng QR: {str(ve)}. Định dạng phải là username:password hoặc v1.<salt>.<iv>.<data>"
        }), 400
    except Exception as e:
        app.logger.exception(f"Lỗi giải mã QR: {e}")
        return jsonify({"status": "error", "msg": "Lỗi server nội bộ"}), 500

@app.post("/login")
@csrf.exempt
def login():
    try:
        data = request.get_json(silent=True) or {}
        username = data.get("username", "").strip()
        password = data.get("password", "").strip()

        if not username or not password:
            return jsonify({"status": "error", "msg": "Thiếu tên đăng nhập hoặc mật khẩu"}), 400

        return jsonify({
            "status": "success",
            "role": "user",
            "user": {
                "username": username,
                "password": password
            },
            "redirect": url_for("index")
        }), 200

    except Exception as e:
        app.logger.error(f"Lỗi /login: {e}")
        return jsonify({"status": "error", "msg": "Lỗi server"}), 500

@app.route('/alochat')
def alochat():
    return render_template('alochat.html')

@socketio.on("send_file")
def handle_file(data):
    emit("receive_file", data, broadcast=True, include_self=False)

@socketio.on('send_message')
def handle_message(data):
    emit('receive_message', data, broadcast=True)

@socketio.on('signal')
def handle_signal(data):
    emit('signal', data, broadcast=True, include_self=False)

@socketio.on("user_online")
def handle_user_online(data):
    emit("peer_online", data, broadcast=True, include_self=False)

@socketio.on("typing")
def handle_typing(data):
    emit("typing", data, broadcast=True, include_self=False)

@app.route('/favicon.ico')
def favicon():
    icon_path = STATIC_DIR / "favicon.ico"
    if icon_path.exists():
        return send_from_directory(STATIC_DIR, 'favicon.ico', mimetype='image/vnd.microsoft.icon')
    return '', 204

@app.route('/xuka')
def xuka():
    return render_template('xuka.html')

@app.route('/huongdan')
def huongdan():
    return render_template('huongdan.html')

@app.route('/tronde')
def tronde():
    return render_template('ao.html')

@app.route('/h2')
def h2():
    return render_template('h2.html')

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/web")
def web():
    return render_template("index_web.html")

@app.route("/mobile")
def mobile():
    return render_template("index_mobile.html")

@app.get("/api/made")
def api_made():
    try:
        return jsonify(list_exam_codes())
    except Exception as e:
        app.logger.exception(f"Lỗi liệt kê mã đề: {e}")
        return jsonify({"status": "error", "msg": "Lỗi server nội bộ"}), 500





@app.route("/alat")
def alat():
    return render_template("Alat.html")





@app.post("/api/exam/start")
@csrf.exempt
def api_exam_start():
    global current_command
    # Chỉ gửi lệnh cho client, không tự ngắt mạng server
    current_command = "disconnect"
    return jsonify({"status": "success", "msg": "Lệnh ngắt mạng đã được gửi đến client"})


@app.post("/api/exam/submit")
@csrf.exempt
def api_exam_submit():
    global current_command
    # Chỉ gửi lệnh cho client, không tự bật mạng server
    current_command = "reconnect"
    return jsonify({"status": "success", "msg": "Lệnh khôi phục mạng đã được gửi đến client"})


@app.get("/api/exam/command")
def api_exam_command():
    global current_command
    # Client sẽ gọi endpoint này để lấy lệnh mới nhất
    return jsonify({"command": current_command})







@app.post("/api/login")
@csrf.exempt
@limiter.limit("10/minute")
def api_login():
    try:
        data = request.get_json(silent=True) or {}
        username = str(data.get("username", "")).strip()
        password = str(data.get("password", "")).strip()

        if not username or not password:
            return jsonify({"status": "error", "msg": "Thiếu username hoặc password"}), 400

        admins = load_users(ADMIN_FILE)
        for user in admins:
            if user.get("username") == username and user.get("password") == password:
                return jsonify({
                    "status": "success",
                    "role": "admin",
                    "user": {
                        "username": user.get("username", ""),
                        "hoten": user.get("hoten", ""),
                        "sbd": user.get("sbd", ""),
                        "ngaysinh": user.get("ngaysinh", "")
                    },
                    "redirect": url_for('index')
                }), 200

        users = load_users(USERS_FILE)
        for user in users:
            if user.get("username") == username and user.get("password") == password:
                return jsonify({
                    "status": "success",
                    "role": "user",
                    "user": {
                        "username": user.get("username", ""),
                        "hoten": user.get("hoten", ""),
                        "sbd": user.get("sbd", ""),
                        "ngaysinh": user.get("ngaysinh", "")
                    },
                    "redirect": url_for('index')
                }), 200

        return jsonify({"status": "fail", "msg": "Sai tài khoản hoặc mật khẩu"}), 401

    except Exception as e:
        app.logger.exception(f"Lỗi đăng nhập: {e}")
        return jsonify({"status": "error", "msg": "Lỗi server nội bộ"}), 500

@app.post("/api/register")
@csrf.exempt
@limiter.limit("5/minute")
def api_register():
    try:
        data = request.get_json(silent=True) or {}
        username = str(data.get("username", "")).strip()
        password = str(data.get("password", "")).strip()
        hoten = str(data.get("hoten", "")).strip()
        sbd = str(data.get("sbd", "")).strip()
        ngaysinh = str(data.get("ngaysinh", "")).strip()

        if not username or not password:
            return jsonify({"status": "error", "msg": "Thiếu username hoặc password"}), 400

        if not USERS_FILE.exists():
            USERS_FILE.write_text("[]", encoding="utf-8")

        with open(USERS_FILE, "r", encoding="utf-8") as f:
            try:
                users = json.load(f)
            except json.JSONDecodeError:
                users = []

        if any(u.get("username") == username for u in users):
            return jsonify({"status": "error", "msg": "Tài khoản đã tồn tại"}), 400

        users.append({
            "username": username,
            "password": password,
            "hoten": hoten,
            "sbd": sbd,
            "ngaysinh": ngaysinh
        })
        with open(USERS_FILE, "w", encoding="utf-8") as f:
            json.dump(users, f, ensure_ascii=False, indent=2)

        return jsonify({"status": "success", "msg": "Đăng ký thành công", "redirect": url_for('index')})

    except Exception as e:
        app.logger.exception(f"Lỗi đăng ký: {e}")
        return jsonify({"status": "error", "msg": "Lỗi server nội bộ"}), 500

@app.post("/api/generate-token")
@csrf.exempt
def api_generate_token():
    try:
        data = request.get_json(silent=True) or {}
        username = str(data.get("username", "")).strip()
        if not username:
            return jsonify({"status": "error", "msg": "Thiếu username"}), 400

        token = f"{username}_{datetime.now().strftime('%Y%m%d%H%M%S')}"
        return jsonify({"status": "success", "token": token})

    except Exception as e:
        app.logger.exception(f"Lỗi tạo token: {e}")
        return jsonify({"status": "error", "msg": "Lỗi server nội bộ"}), 500

@app.get("/api/list_made")
def api_list_made():
    try:
        made_list = []
        for f in QUESTIONS_DIR.glob("questions*.json"):
            code = f.stem.replace("questions", "")
            if code.isdigit():
                made_list.append(code)
        return jsonify(sorted(made_list))
    except Exception as e:
        app.logger.exception(f"Lỗi liệt kê mã đề: {e}")
        return jsonify({"status": "error", "msg": "Lỗi server nội bộ"}), 500

@app.route("/get_exam_codes")
def get_exam_codes():
    try:
        exam_dir = QUESTIONS_DIR
        print("[DEBUG] Đang đọc thư mục:", exam_dir.resolve())
        if not exam_dir.exists():
            app.logger.error("Thư mục đề thi không tồn tại!")
            return jsonify([])

        codes = [f.stem.replace("questions", "") for f in exam_dir.glob("questions*.json") if f.stem.startswith("questions") and f.stem[len("questions"):].isdigit()]
        if not codes:
            app.logger.warning("Không tìm thấy mã đề nào trong thư mục questions!")
            return jsonify([])

        print("[DEBUG] Mã đề tìm thấy:", codes)
        return jsonify(codes)
    except Exception as e:
        app.logger.exception(f"Lỗi lấy mã đề: {e}")
        return jsonify({"status": "error", "msg": "Lỗi server nội bộ"}), 500

@app.route("/get_questions")
def get_questions():
    try:
        made = request.args.get("made", "000")
        filename = f"questions{made}.json"
        filepath = QUESTIONS_DIR / filename
        print(f"[DEBUG] Đang tìm file: {filepath}")
        if not filepath.exists():
            print(f"[ERROR] File không tồn tại: {filepath}")
            return jsonify({"status": "error", "msg": f"File {filename} không tồn tại"}), 404

        with open(filepath, encoding="utf-8") as f:
            questions = json.load(f)

        processed_questions = []
        for i, q in enumerate(questions, 1):
            q_processed = {
                "cau": i,
                "noi_dung": q.get("noi_dung", ""),
                "kieu_cau_hoi": q.get("kieu_cau_hoi", "trac_nghiem")
            }
            if q_processed["kieu_cau_hoi"] == "tu_luan":
                q_processed["tra_loi_hoc_sinh"] = q.get("tra_loi_hoc_sinh", "")
                q_processed["goi_y_dap_an"] = q.get("goi_y_dap_an", "")
            else:
                q_processed["lua_chon"] = q.get("lua_chon", {})
                q_processed["dap_an_dung"] = q.get("dap_an_dung", "")
            processed_questions.append(q_processed)

        print(f"[DEBUG] Đã tải {len(processed_questions)} câu hỏi cho mã đề {made}")
        return jsonify(processed_questions)
    except json.JSONDecodeError as e:
        print(f"[ERROR] File JSON không hợp lệ: {filepath}, lỗi: {str(e)}")
        return jsonify({"status": "error", "msg": "File câu hỏi không hợp lệ"}), 400
    except Exception as e:
        app.logger.exception(f"Lỗi tải câu hỏi: {e}")
        return jsonify({"status": "error", "msg": str(e)}), 500

@app.route("/questions/<path:filename>")
def serve_questions_file(filename):
    try:
        filepath = QUESTIONS_DIR / filename
        print(f"[DEBUG] Phục vụ file tĩnh: {filepath}")
        if filepath.exists():
            return send_file(filepath)
        else:
            print(f"[ERROR] File không tồn tại: {filepath}")
            return jsonify({"status": "error", "msg": f"File {filename} không tồn tại"}), 404
    except Exception as e:
        app.logger.exception(f"Lỗi phục vụ file câu hỏi: {e}")
        return jsonify({"status": "error", "msg": "Lỗi server nội bộ"}), 500

@app.route("/save_result", methods=["POST"])
@csrf.exempt
def save_result():
    try:
        data = request.get_json(silent=True) or {}
        hoten = str(data.get("hoten", "unknown")).strip()
        sbd = str(data.get("sbd", "N/A")).strip()
        ngaysinh = str(data.get("ngaysinh", "N/A")).strip()
        made = str(data.get("made", "000")).strip()
        diem = str(data.get("diem", "0.00")).strip()
        answers = data.get("answers", [])

        if not answers:
            return jsonify({"status": "error", "msg": "Không có câu trả lời nào được gửi"}), 400

        filename_de = f"questions{made}.json"
        filepath_de = QUESTIONS_DIR / filename_de
        question_data = []
        if filepath_de.exists():
            try:
                with open(filepath_de, "r", encoding="utf-8") as f:
                    question_data = json.load(f)
            except Exception as e:
                app.logger.error(f"Lỗi đọc file đề: {e}")
                question_data = []

        timestamp = datetime.now().strftime("%H:%M:%S, %d/%m/%Y")
        safe_name = secure_filename(hoten.replace(" ", "_")) or "unknown"
        filename = f"KQ_{safe_name}_{made}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        filepath = RESULTS_DIR / filename

        lines = [
            "KẾT QUẢ BÀI THI",
            f"Họ tên: {hoten}",
            f"SBD: {sbd}",
            f"Ngày sinh: {ngaysinh}",
            f"Mã đề: {made}",
            f"Điểm: {diem}/10",
            f"Nộp lúc: {timestamp}",
            ""
        ]

        for a in answers:
            cau = a.get("cau", "N/A")
            noi_dung = a.get("noi_dung", "Không có nội dung")
            kieu = a.get("kieu", "trac_nghiem").lower()

            try:
                idx = int(cau) - 1
                if 0 <= idx < len(question_data):
                    cau_goc = question_data[idx]
                else:
                    cau_goc = {}
            except (ValueError, TypeError):
                cau_goc = {}

            lines.append(f"Câu {cau}: {noi_dung}")

            if kieu == "tu_luan":
                tra_loi = a.get("tra_loi_hoc_sinh", "").strip() or "[Chưa trả lời]"
                goi_y = a.get("goi_y_dap_an", "").strip()
                lines.append(f"  Bạn chọn: {tra_loi}")
                if goi_y:
                    lines.append(f"  Gợi ý đáp án: {goi_y}")
            elif kieu == "trac_nghiem":
                da_chon = a.get("da_chon", "(chưa chọn)")
                dap_an_dung = cau_goc.get("dap_an_dung", "")
                lines.append(f"  Bạn chọn: {da_chon}")
                if dap_an_dung:
                    lines.append(f"  Đáp án đúng: {dap_an_dung}")
            else:
                tra_loi = a.get("tra_loi_hoc_sinh", a.get("da_chon", "(chưa trả lời)"))
                lines.append(f"  Bạn trả lời: {tra_loi}")

            lines.append("")

        try:
            filepath.write_text("\n".join(lines), encoding="utf-8")
        except Exception as e:
            app.logger.error(f"Lỗi ghi file: {e}")
            return jsonify({"status": "error", "msg": f"Lỗi ghi file: {str(e)}"}), 500

        return jsonify({
            "status": "saved",
            "text": "\n".join(lines),
            "download": f"/download/{filename}"
        })

    except Exception as e:
        app.logger.exception(f"Lỗi lưu kết quả: {e}")
        return jsonify({"status": "error", "msg": "Lỗi server nội bộ"}), 500



@app.route('/static/sw.js')
def serve_service_worker():
    response = send_from_directory('static', 'sw.js')
    response.headers['Service-Worker-Allowed'] = '/'
    return response

@app.get('/download/<path:filename>')
def download_file(filename):
    try:
        safe = secure_filename(filename)
        file_path = RESULTS_DIR / safe
        if not file_path.exists():
            return jsonify({"status": "error", "msg": "File không tồn tại"}), 404
        return send_from_directory(RESULTS_DIR, safe, as_attachment=True)
    except Exception as e:
        app.logger.exception(f"Lỗi tải file: {e}")
        return jsonify({"status": "error", "msg": "Lỗi server nội bộ"}), 500

@app.route('/exam_session', methods=['GET'])
def exam_session():
    try:
        made = request.args.get('made')
        if not made:
            return jsonify({"status": "error", "msg": "Mã đề không được cung cấp!"}), 400
        
        duration_sec = 3600  # 1 giờ
        return jsonify({"status": "success", "duration_sec": duration_sec, "deadline": None})
    except Exception as e:
        app.logger.exception(f"Lỗi lấy phiên thi: {e}")
        return jsonify({"status": "error", "msg": str(e)}), 500

@app.errorhandler(Exception)
def handle_all(e):
    if isinstance(e, NotFound):
        app.logger.warning(f"Route không tồn tại: {request.url}")
        return jsonify({"status": "error", "msg": "Trang không tồn tại"}), 404
    app.logger.exception(f"Lỗi server: {e}")
    return jsonify({"status": "error", "msg": "Lỗi server nội bộ"}), 500

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
