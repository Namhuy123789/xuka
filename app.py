from flask import Flask, request, jsonify, send_from_directory, render_template, abort, redirect, url_for
from werkzeug.utils import secure_filename
from pathlib import Path
from datetime import datetime
from flask_wtf.csrf import CSRFProtect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import re
import json
import os
from flask_socketio import SocketIO, emit
from flask import send_file
import base64
import hashlib
from Crypto.Cipher import AES
from Crypto.Protocol.KDF import PBKDF2
from Crypto.Util.Padding import unpad
from werkzeug.exceptions import NotFound
from flask import Flask, jsonify








app = Flask(__name__, static_folder='static', template_folder='templates')
app.config["JSONIFY_PRETTYPRINT_REGULAR"] = False
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "change_this_secret_key")

# Đường dẫn thư mục
BASE_DIR = Path(__file__).resolve().parent
QUESTIONS_DIR = BASE_DIR / "questions"
RESULTS_DIR = BASE_DIR / "results"
STATIC_DIR = BASE_DIR / "static"
USERS_FILE = STATIC_DIR / "users.json"  # Học sinh
ADMIN_FILE = STATIC_DIR / "users1.json"  # Quản trị viên

# Tạo các thư mục nếu chưa tồn tại
for directory in [QUESTIONS_DIR, RESULTS_DIR, STATIC_DIR]:
    directory.mkdir(exist_ok=True)

socketio = SocketIO(app, async_mode="threading")

# CSRF
csrf = CSRFProtect(app)

# Rate limiting
limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    storage_uri="memory://",
    default_limits=["100 per 5 minutes"]
)

# --- Helpers ---
def load_users(file_path: Path):
    if not file_path.exists():
        return []
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        app.logger.error(f"Lỗi giải mã JSON trong {file_path}: {e}")
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

# --- Giải mã AES-GCM ---
MASTER_PASSPHRASE = os.environ.get("MASTER_PASSPHRASE", "thay-bang-chuoi-bi-mat")  # Lấy từ biến môi trường

def decrypt_qr_data(encrypted_data):
    try:
        parts = encrypted_data.split('.')
        if len(parts) != 4 or parts[0] != 'v1':
            raise ValueError("Định dạng mã QR không hợp lệ")

        salt = base64.b64decode(parts[1])
        iv = base64.b64decode(parts[2])
        ciphertext = base64.b64decode(parts[3])

        # Sửa lỗi: sử dụng hashlib.sha256() thay vì hashlib.sha256
        key = PBKDF2(MASTER_PASSPHRASE.encode(), salt, dkLen=32, count=100000, hmac_hash_module=hashlib.sha256())
        cipher = AES.new(key, AES.MODE_GCM, nonce=iv)
        plaintext = cipher.decrypt(ciphertext)
        return json.loads(plaintext.decode('utf-8'))
    except Exception as e:
        app.logger.error(f"Lỗi giải mã QR: {e}")
        raise

# --- Route: Save answers and calculate score ---
def tinh_diem_va_luu_bai_lam(bai_lam, de_thi):
    so_cau_dung = 0
    tong_cau_trac_nghiem = 0
    ket_qua = []

    for i, cau_hoi in enumerate(de_thi):
        item = cau_hoi.copy()
        ma_cau = f"cau_{i}"
        tra_loi = bai_lam.get(ma_cau)

        if cau_hoi.get("kieu_cau_hoi") == "tu_luan":
            item["tra_loi_hoc_sinh"] = tra_loi or ""
        elif "lua_chon" in cau_hoi and "dap_an_dung" in cau_hoi:
            tong_cau_trac_nghiem += 1
            if tra_loi == cau_hoi["dap_an_dung"]:
                so_cau_dung += 1
            item["tra_loi_hoc_sinh"] = tra_loi or ""
        else:
            item["tra_loi_hoc_sinh"] = tra_loi or ""

        ket_qua.append(item)

    diem = round((so_cau_dung / max(tong_cau_trac_nghiem, 1)) * 10, 2)

    return {
        "diem": diem,
        "so_cau_dung": so_cau_dung,
        "tong_cau_trac_nghiem": tong_cau_trac_nghiem,
        "bai_lam_chi_tiet": ket_qua
    }

# --- SocketIO ---
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

# --- Routes (views) ---
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

# --- API: Danh sách mã đề ---
@app.get("/api/made")
def api_made():
    try:
        return jsonify(list_exam_codes())
    except Exception as e:
        app.logger.exception(f"Lỗi liệt kê mã đề: {e}")
        return jsonify({"status": "error", "msg": "Lỗi server nội bộ"}), 500

# --- API LOGIN ---
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

# --- API REGISTER ---
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

# --- Token ---
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

# --- API: Danh sách mã đề ---
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

# --- Lấy đề thi ---
@app.route("/questions/<path:filename>")
def serve_questions_file(filename):
    try:
        filepath = QUESTIONS_DIR / filename
        if filepath.exists():
            return send_file(filepath)
        else:
            return jsonify({"status": "error", "msg": f"File {filename} không tồn tại"}), 404
    except Exception as e:
        app.logger.exception(f"Lỗi phục vụ file câu hỏi: {e}")
        return jsonify({"status": "error", "msg": "Lỗi server nội bộ"}), 500






@app.route("/get_exam_codes")
def get_exam_codes():
    # Use the QUESTIONS_DIR defined earlier
    exam_dir = QUESTIONS_DIR  # Path(__file__).parent / "questions"
    print("[DEBUG] Đang đọc thư mục:", exam_dir.resolve())

    if not exam_dir.exists():
        app.logger.error("Thư mục đề thi không tồn tại!")
        return jsonify([])  # Return empty array for consistency

    # Lấy danh sách file đề (chỉ tìm *.json)
    codes = [f.stem.replace("questions", "") for f in exam_dir.glob("questions*.json") if f.stem.startswith("questions") and f.stem[len("questions"):].isdigit()]
    
    if not codes:
        app.logger.warning("Không tìm thấy mã đề nào trong thư mục questions!")
        return jsonify([])  # Return empty array

    print("[DEBUG] Mã đề tìm thấy:", codes)
    return jsonify(codes)



@app.route("/questions")
def get_questions():
    try:
        made = request.args.get("made", "000")
        filename = f"questions{made}.json"
        filepath = QUESTIONS_DIR / filename
        if not filepath.exists():
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

        return jsonify(processed_questions)
    except Exception as e:
        app.logger.exception(f"Lỗi tải câu hỏi: {e}")
        return jsonify({"status": "error", "msg": str(e)}), 500

# --- Download kết quả ---
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

# --- Lưu kết quả ---
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

        # Load đề thi theo mã đề
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

        # Tạo file kết quả
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

        # Ghi kết quả từng câu
        for a in answers:
            cau = a.get("cau", "N/A")
            noi_dung = a.get("noi_dung", "Không có nội dung")
            kieu = a.get("kieu", "trac_nghiem").lower()

            try:
                idx = int

                (cau) - 1
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

        # Ghi ra file
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

# --- Giải mã QR ---
@app.post("/api/decrypt_qr")
@csrf.exempt
def api_decrypt_qr():
    try:
        data = request.get_json(silent=True)
        if not data:
            app.logger.error("Không nhận được dữ liệu JSON")
            return jsonify({"status": "error", "msg": "Dữ liệu JSON không hợp lệ"}), 400

        qr_value = str(data.get("qr_value", "")).strip()
        app.logger.info(f"Nhận được qr_value: {qr_value}")  # Log giá trị nhận được
        if not qr_value:
            app.logger.error("Thiếu trường qr_value trong yêu cầu")
            return jsonify({"status": "error", "msg": "Thiếu dữ liệu QR"}), 400

        # Kiểm tra định dạng mã hóa v1.<salt>.<iv>.<data>
        if qr_value.startswith('v1.'):
            try:
                decoded_data = decrypt_qr_data(qr_value)
                username = decoded_data.get("username", "").strip()
                password = decoded_data.get("password", "").strip()
                hoten = decoded_data.get("hoten", "").strip()
                sbd = decoded_data.get("sbd", "").strip()
                ngaysinh = decoded_data.get("ngaysinh", "").strip()
                app.logger.info(f"Giải mã thành công: username={username}, password={password}")
            except Exception as e:
                app.logger.error(f"Lỗi giải mã QR: {e}")
                return jsonify({"status": "error", "msg": f"Lỗi giải mã QR: {str(e)}"}), 400
        else:
            # Kiểm tra định dạng username:password
            if ":" not in qr_value:
                app.logger.error(f"Mã QR không hợp lệ: {qr_value}")
                return jsonify({"status": "error", "msg": "Mã QR không hợp lệ, phải có định dạng username:password hoặc v1.<salt>.<iv>.<data>"}), 400
            username, password = qr_value.split(":", 1)
            hoten = ""
            sbd = ""
            ngaysinh = ""
            app.logger.info(f"Phân tách thành công: username={username}, password={password}")

        # Kiểm tra admin
        admins = load_users(ADMIN_FILE)
        app.logger.info(f"Số lượng admin: {len(admins)}")
        for user in admins:
            if user.get("username") == username and user.get("password") == password:
                app.logger.info(f"Đăng nhập admin thành công: {username}")
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

        # Kiểm tra user thường
        users = load_users(USERS_FILE)
        app.logger.info(f"Số lượng user: {len(users)}")
        for user in users:
            if user.get("username") == username and user.get("password") == password:
                app.logger.info(f"Đăng nhập user thành công: {username}")
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

        # Nếu mã QR chứa thông tin nhưng không khớp với users.json, trả về thông tin từ QR
        if qr_value.startswith('v1.') and username and password:
            app.logger.info(f"Trả về thông tin từ QR: username={username}")
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

        app.logger.error(f"Đăng nhập thất bại: {username}")
        return jsonify({"status": "fail", "msg": "Mã QR không hợp lệ hoặc tài khoản không tồn tại"}), 401

    except ValueError as ve:
        app.logger.error(f"Lỗi định dạng QR: {ve} - Giá trị: {qr_value}")
        return jsonify({"status": "error", "msg": f"Lỗi định dạng QR: {str(ve)}. Định dạng phải là username:password hoặc v1.<salt>.<iv>.<data>"}), 400
    except Exception as e:
        app.logger.exception(f"Lỗi giải mã QR: {e}")
        return jsonify({"status": "error", "msg": f"Lỗi server nội bộ: {str(e)}"}), 500

# --- Error handler ---
@app.errorhandler(Exception)
def handle_all(e):
    if isinstance(e, NotFound):
        app.logger.warning(f"Route không tồn tại: {request.url}")
        return jsonify({"status": "error", "msg": "Trang không tồn tại"}), 404
    app.logger.exception(f"Lỗi server: {e}")
    return jsonify({"status": "error", "msg": "Lỗi server nội bộ"}), 500

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
