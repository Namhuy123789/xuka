from flask import Flask, request, jsonify, send_from_directory, send_file, render_template, abort, redirect, url_for
from werkzeug.utils import secure_filename
from werkzeug.exceptions import NotFound
from datetime import datetime
from flask_wtf.csrf import CSRFProtect
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import re
import json
from flask_socketio import SocketIO, emit
from Crypto.Cipher import AES
from Crypto.Protocol.KDF import PBKDF2
from Crypto.Hash import SHA256
import base64
import ctypes
import subprocess
import sys
import google.generativeai as genai
from dotenv import load_dotenv
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from flask import Flask, send_file, Response
import zipfile
import io
from pathlib import Path
import os
from flask import Flask, request, jsonify
from flask_wtf.csrf import CSRFProtect
from difflib import SequenceMatcher
import vertexai
from vertexai import init
from vertexai.preview.generative_models import GenerativeModel
from flask_wtf.csrf import generate_csrf







# ✅ Đặt đường dẫn tới file JSON

os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "/var/www/xuka/theta-era-474201-n0-vertex-ai-service.json"
print("✅ Vertex AI credentials loaded.")
BASE_DIR = Path(__file__).parent.resolve()
load_dotenv()
app = Flask(__name__, static_folder='static', template_folder='templates')
app.config["JSONIFY_PRETTYPRINT_REGULAR"] = False
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "change_this_secret_key")
# --- Database config (SQLite) ---
# Thư mục lưu kết quả và DB trên Render
RESULTS_DIR = Path("/var/data/results")
RESULTS_DIR.mkdir(parents=True, exist_ok=True)  # tạo folder nếu chưa có
# File SQLite DB nằm trong RESULTS_DIR
DB_PATH = RESULTS_DIR / "app.db"
app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{DB_PATH.as_posix()}"
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Đường dẫn thư mục khác
QUESTIONS_DIR = BASE_DIR / "questions"
STATIC_DIR = BASE_DIR / "static"

# legacy files (optional)
USERS_FILE = STATIC_DIR / "users.json"
ADMIN_FILE = STATIC_DIR / "users1.json"

# Tạo các thư mục nếu chưa tồn tại
for directory in [QUESTIONS_DIR, STATIC_DIR]:
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

api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError("❌ GEMINI_API_KEY chưa được thiết lập trong .env")
    
# Cấu hình Gemini
genai.configure(api_key=api_key)
model = genai.GenerativeModel("models/gemini-2.5-flash")

# 3️⃣ Endpoint chấm tự luận

@app.route("/api/grade_essay", methods=["POST"])
@csrf.exempt
def grade_essay():
    try:
        data = request.json
        answer = data.get("answer", "").strip()
        suggested_answer = data.get("suggested_answer", "").strip()

        if not answer or not suggested_answer:
            return jsonify({"score": 0, "similarity": 0, "feedback": "Thiếu dữ liệu để chấm."})

        # Prompt so sánh mức độ tương đồng
        prompt = f"""
Bạn là trợ lý chấm thi thông minh. So sánh mức độ tương đồng về Ý NGHĨA giữa các ý của bài làm và đáp án mẫu đối với môn xã hội, đối với môn tự nhiên cần chấm theo từng bước làm, nếu đúng bước nào chấm điểm bước đó, sai thì không chấm, quan trọng nhất là đáp án đúng được nguyên điểm nếu các bước đúng hết.
Trả về DUY NHẤT một số thực từ 0 đến 1 (0 = không giống, 1 = giống hoàn toàn), KHÔNG giải thích.
Bài làm học sinh: {answer}
Đáp án mẫu: {suggested_answer}
"""

        # Gọi model Gemini 2.5
        resp = model.generate_content(prompt)
        similarity_text = getattr(resp, "text", "").strip()

        # Trích số thực
        m = re.search(r"(\d*\.?\d+)", similarity_text)
        similarity = float(m.group(1)) if m else 0.0
        if similarity > 1:
            similarity = similarity / 100  # Nếu AI trả 85 thay vì 0.85

        # Chấm điểm theo mức độ
        if similarity >= 0.8:
            score = 1
        elif similarity >= 0.75:
            score = 0.75
        elif similarity >= 0.5:
            score = 0.5
        elif similarity >= 0.25:
            score = 0.25
        else:
            score = 0

        feedback = f"Độ tương đồng: {similarity:.2f} → Điểm: {score}"

        return jsonify({
            "score": score,
            "similarity": similarity,
            "feedback": feedback
        })

    except Exception as e:
        print("AI grading error:", e)
        return jsonify({"error": str(e)}), 500


# --- Khởi tạo Vertex AI (SDK mới) ---

try:
    # 🔹 Khởi tạo Vertex AI với SDK mới
    init(project="theta-era-474201-n0", location="us-central1")
    ai_vertex = GenerativeModel("gemini-1.5-flash")  # hoặc "gemini-1.5-pro" nếu cần độ chính xác cao
    print("✅ Vertex AI (SDK mới) khởi tạo thành công (global)")
except Exception as e:
    print(f"⚠️ Không thể khởi tạo Vertex AI (mới): {e}")
    ai_vertex = None


def normalize_text(text):
    text = text.replace("−", "-")
    text = text.replace("∗", "*").replace("•", "*")
    text = text.replace("⟹", "->").replace("⇒", "->").replace("- >", "->")
    text = re.sub(r"\s+", " ", text)
    return text.strip().lower()



@app.route('/api/grade_essay_advanced', methods=['POST'])
@csrf.exempt
def grade_essay_advanced():
    def normalize_text(text):
        """Chuẩn hóa văn bản: loại bỏ ký tự đặc biệt, khoảng trắng, viết thường"""
        text = text.lower()
        text = re.sub(r'[\*\•\-\−]', '', text)
        text = text.strip()
        return text

    def compute_question_score(similarities, bonuses=None):
        """Tính điểm từng ý, cộng bonus nếu có, làm tròn theo ngưỡng 0,0.25,0.5,0.75,1"""
        thresholds = [0.0, 0.25, 0.5, 0.75, 1.0]
        if not similarities:
            return 0.0
        avg_score = sum(similarities) / len(similarities)
        if bonuses:
            avg_score = min(avg_score + sum(bonuses), 1.0)  # cộng bonus nhưng max 1.0
        for t in reversed(thresholds):
            if avg_score >= t:
                return t
        return 0.0

    def detect_bonus(student_items, correct_items):
        """Phát hiện ý sáng tạo/mở rộng hợp lý"""
        bonus_flags = []
        for s in student_items:
            # Nếu ý không trùng với bất kỳ ý nào trong gợi ý nhưng có liên quan (ngữ nghĩa tương đồng >=0.4)
            similarities = [SequenceMatcher(None, s, c).ratio() for c in correct_items]
            if max(similarities) < 0.5:
                # Bonus cho sáng tạo hợp lý
                bonus_flags.append(0.05)
            else:
                bonus_flags.append(0.0)
        return bonus_flags

    try:
        data = request.get_json(force=True)
        answers = data.get("answers", [])

        graded = []
        total = 0.0

        for ans in answers:
            question = ans.get("question", "").strip()
            student_answer = ans.get("answer", "").strip()
            correct_answer = ans.get("correct_answer", "").strip()

            if not student_answer or not correct_answer:
                graded.append({
                    "question": question,
                    "student_answer": student_answer,
                    "correct_answer": correct_answer,
                    "score": 0.0
                })
                continue

            correct_items = [normalize_text(c) for c in re.split(r'[;,•\n]', correct_answer) if c.strip()]
            student_items = [normalize_text(s) for s in re.split(r'[;,•\n]', student_answer) if s.strip()]

            long_text = len(student_answer.split()) > 100
            similarities = []

            if ai_vertex:
                try:
                    if long_text:
                        # Semantic scoring toàn đoạn
                        prompt = f"""
Bạn là AI chuyên về chấm tự luận nâng cao. Đọc đoạn trả lời của học sinh và gợi ý đáp án.
- Đánh giá mức độ trùng ý nghĩa, đánh giá tương đồng về mặt ngữ nghĩa và khoa học, cộng điểm cho sáng tạo đúng hoặc mở rộng hợp lý.
- Trả về DUY NHẤT số thực 0.0-1.0.

Học sinh: {student_answer}
Gợi ý: {correct_answer}
"""
                    else:
                        prompt = f"""
Bạn là AI chuyên về chấm tự luận.
- So sánh ý nghĩa từng ý, đánh giá tương đồng về mặt ngữ nghĩa và khoa học, cộng điểm cho sáng tạo hợp lý.
- Bỏ qua lỗi khoảng trắng, *, ∗, -, −...
tra_loi_hoc_sinh: {student_items}
goi_y_dap_an: {correct_items}
Trả về DUY NHẤT danh sách số thực 0.0–1.0
"""
                    response = ai_vertex.generate_content(
                        prompt,
                        generation_config={
                            "temperature": 0.3,
                            "max_output_tokens": 512,
                        },
                    )
                    raw_text = response.text.strip()
                    similarities = [
                        float(s) if float(s) <= 1 else float(s) / 100
                        for s in re.findall(r"(\d*\.?\d+)", raw_text)
                    ]
                    if long_text and len(similarities) == 1:
                        similarities = [similarities[0]]
                    if not similarities:
                        raise Exception("AI trả về không có số")
                except Exception:
                    similarities = [
                        max(SequenceMatcher(None, s, c).ratio() for c in correct_items)
                        for s in student_items
                    ]
            else:
                similarities = [
                    max(SequenceMatcher(None, s, c).ratio() for c in correct_items)
                    for s in student_items
                ]

            bonuses = detect_bonus(student_items, correct_items)
            score = compute_question_score(similarities, bonuses)
            total += score

            graded.append({
                "question": question,
                "student_answer": student_answer,
                "correct_answer": correct_answer,
                "score": score
            })

        return jsonify({
            "status": "success",
            "graded": graded,
            "total_score": round(total, 2)
        })

    except Exception as e:
        print(f"❌ Lỗi chấm tự luận nâng cao: {e}")
        return jsonify({
            "status": "error",
            "msg": str(e)
        }), 500


@app.route("/download/all")
def download_all():
    # Tạo file zip trong bộ nhớ (không ghi ra ổ đĩa)
    memory_file = io.BytesIO()
    with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
        for filename in os.listdir(RESULTS_DIR):
            if filename.endswith(".txt"):  # chỉ lấy file kết quả
                filepath = os.path.join(RESULTS_DIR, filename)
                zf.write(filepath, arcname=filename)
    memory_file.seek(0)

    return send_file(
        memory_file,
        as_attachment=True,
        download_name="all_results.zip",
        mimetype="application/zip"
    )








SCORE_FILE = os.path.join("data", "scores.json")  # hoặc đường dẫn đúng

# --- API: Lấy CSRF token ---
@app.route("/api/get_csrf_token")
def get_csrf_token():
    token = generate_csrf()
    return jsonify({"csrf_token": token})


@app.route("/api/get_score_weights")
def get_score_weights():
    made = request.args.get("made")
    if not made:
        return jsonify({"status": "error", "message": "Thiếu mã đề"}), 400

    if not os.path.exists(SCORE_FILE):
        return jsonify({"status": "error", "message": "Chưa có file trọng số"}), 404

    with open(SCORE_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)

    if made in data:
        return jsonify({"status": "success", "weights": data[made]})
    else:
        return jsonify({"status": "error", "message": "Không tìm thấy mã đề"}), 404



# --- API: Lưu trọng số ---
@app.route("/api/set_score_weights", methods=["POST"])
@csrf.exempt   # ⛔ Nếu bạn muốn bỏ CSRF cho API này
def set_score_weights():
    try:
        body = request.get_json(force=True)
    except Exception:
        return jsonify({"status": "error", "message": "Dữ liệu không hợp lệ"}), 400

    made = body.get("made")
    weights = body.get("weights", {})

    if not made or not weights:
        return jsonify({"status": "error", "message": "Thiếu dữ liệu"}), 400

    # --- Tạo thư mục nếu chưa có ---
    folder = os.path.dirname(SCORE_FILE)
    if folder:
        os.makedirs(folder, exist_ok=True)

    # --- Đọc dữ liệu cũ ---
    data = {}
    if os.path.exists(SCORE_FILE):
        with open(SCORE_FILE, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
            except json.JSONDecodeError:
                data = {}

    # --- Cập nhật dữ liệu ---
    data[made] = weights

    # --- Ghi lại ---
    with open(SCORE_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return jsonify({"status": "success", "message": f"Đã lưu trọng số cho mã đề {made}"})







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

@app.after_request
def add_security_headers(response):
    # Header cơ bản
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer-when-downgrade"

    # Cho phép camera, mic, location cho chính domain
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=(self)"

    # CSP mở rộng để không chặn hiển thị
    csp = (
        "default-src 'self' https: data: blob:; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; "
        "style-src 'self' 'unsafe-inline' https:; "
        "font-src 'self' https: data:; "
        "img-src 'self' data: https: blob:; "
        "connect-src 'self' https: http: ws: wss:;"
    )
    response.headers["Content-Security-Policy"] = csp

    # Bỏ COEP/COOP/CORP để không block CDN
    for h in ("Cross-Origin-Embedder-Policy", "Cross-Origin-Opener-Policy", "Cross-Origin-Resource-Policy"):
        if h in response.headers:
            del response.headers[h]

    # HSTS: chỉ bật khi chạy HTTPS
    if request.is_secure or request.headers.get("X-Forwarded-Proto", "") == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"

    return response


# --- User model ---
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(150), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(300), nullable=False)
    hoten = db.Column(db.String(255), nullable=True)
    sbd = db.Column(db.String(100), nullable=True)
    ngaysinh = db.Column(db.String(50), nullable=True)
    role = db.Column(db.String(20), default="user")  # 'user' or 'admin'

    def check_password(self, password_plain: str) -> bool:
        return check_password_hash(self.password_hash, password_plain)

    def to_dict(self, include_sensitive=False):
        d = {
            "id": self.id,
            "username": self.username,
            "hoten": self.hoten or "",
            "sbd": self.sbd or "",
            "ngaysinh": self.ngaysinh or "",
            "role": self.role
        }
        if include_sensitive:
            d["password_hash"] = self.password_hash
        return d

# Initialize DB and tables
with app.app_context():
    db.create_all()

    # Migrate legacy JSON users if present (only once)
    def _migrate_json_to_db(json_path: Path, role: str = "user"):
        if not json_path.exists():
            return 0
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, list):
                return 0
            migrated = 0
            for item in data:
                uname = str(item.get("username", "")).strip()
                pwd = item.get("password", "")
                hoten = item.get("hoten", "")
                sbd = item.get("sbd", "")
                ngaysinh = item.get("ngaysinh", "")
                if not uname or not pwd:
                    continue
                if User.query.filter_by(username=uname).first():
                    continue
                # If password looks like a hash (starts with pbkdf2 or method), then store as-is; otherwise hash it.
                # We'll just hash the password (safe).
                hashed = generate_password_hash(pwd)
                u = User(username=uname, password_hash=hashed, hoten=hoten, sbd=sbd, ngaysinh=ngaysinh, role=role)
                db.session.add(u)
                migrated += 1
            if migrated:
                db.session.commit()
                # optionally rename the legacy file to prevent repeated migration
                try:
                    backup = json_path.with_suffix(".json.bak")
                    json_path.rename(backup)
                except Exception:
                    pass
            return migrated
        except Exception as e:
            app.logger.exception(f"Lỗi migrate {json_path}: {e}")
            return 0

    # run migration for admin and users files (if exist)
    migrated_admins = _migrate_json_to_db(ADMIN_FILE, role="admin")
    migrated_users = _migrate_json_to_db(USERS_FILE, role="user")
    if migrated_admins or migrated_users:
        app.logger.info(f"Đã migrate users: admins={migrated_admins}, users={migrated_users}")


# --- Crypto / QR helper functions (unchanged, just reused) ---
MASTER_PASSPHRASE = os.environ.get("MASTER_PASSPHRASE", "thay-bang-chuoi-bi-mat")

def decrypt_qr_data(encrypted_data: str):
    try:
        app.logger.debug(f"Nhận qr_value: {encrypted_data}")
        parts = encrypted_data.split('.')
        if len(parts) != 4 or parts[0] != 'v1':
            raise ValueError("Định dạng mã QR không hợp lệ (phải là v1.<salt>.<iv>.<ciphertext+tag>)")

        salt = base64.b64decode(parts[1], validate=True)
        iv = base64.b64decode(parts[2], validate=True)
        ct_and_tag = base64.b64decode(parts[3], validate=True)

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
        app.logger.debug(f"Giải mã QR thành công: {data}")
        return data

    except (ValueError, KeyError, json.JSONDecodeError) as e:
        app.logger.error(f"Lỗi định dạng dữ liệu QR: {e}")
        raise
    except Exception as e:
        app.logger.error(f"Lỗi giải mã QR: {e}")
        raise

# --- Routes and APIs (modified to use DB) ---

@app.post("/api/decrypt_qr")
@csrf.exempt
def api_decrypt_qr():
    try:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"status": "error", "msg": "Dữ liệu JSON không hợp lệ"}), 400

        qr_value = str(data.get("qr_value", "")).strip()
        app.logger.debug(f"Giá trị qr_value nhận được: {qr_value}")
        if not qr_value:
            return jsonify({"status": "error", "msg": "Thiếu dữ liệu QR"}), 400

        username = password = hoten = sbd = ngaysinh = ""
        parsed_from_v1 = False

        if qr_value.startswith('v1.'):
            try:
                decoded_data = decrypt_qr_data(qr_value)
                username = decoded_data.get("username", "").strip()
                password = decoded_data.get("password", "").strip()
                hoten = decoded_data.get("hoten", "").strip()
                sbd = decoded_data.get("sbd", "").strip()
                ngaysinh = decoded_data.get("ngaysinh", "").strip()
                parsed_from_v1 = True
            except Exception as e:
                return jsonify({"status": "error", "msg": f"Lỗi giải mã QR: {str(e)}"}), 400
        else:
            if ":" not in qr_value:
                return jsonify({
                    "status": "error",
                    "msg": "Mã QR không hợp lệ, phải có dạng username:password hoặc v1.<salt>.<iv>.<data>"
                }), 400
            username, password = qr_value.split(":", 1)

        # tìm admin
        admin = User.query.filter_by(username=username, role="admin").first()
        if admin and admin.check_password(password):
            return jsonify({
                "status": "success",
                "role": "admin",
                "user": admin.to_dict(),
                "redirect": url_for('index')
            }), 200

        # tìm user
        user = User.query.filter_by(username=username, role="user").first()
        if user and user.check_password(password):
            return jsonify({
                "status": "success",
                "role": "user",
                "user": user.to_dict(),
                "redirect": url_for('index')
            }), 200

        # nếu qr dạng v1 và không tồn tại tài khoản, trả lại thông tin đã giải mã (cho phép truy cập tạm)
        if parsed_from_v1 and username and password:
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

        user = User.query.filter_by(username=username).first()
        if not user or not user.check_password(password):
            return jsonify({"status": "error", "msg": "Sai tên đăng nhập hoặc mật khẩu"}), 401

        return jsonify({
            "status": "success",
            "role": user.role,
            "user": user.to_dict(),
            "redirect": url_for("index")
        }), 200

    except Exception as e:
        app.logger.error(f"Lỗi /login: {e}")
        return jsonify({"status": "error", "msg": "Lỗi server"}), 500

# socket handlers and simple routes stay the same
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

# exam network control endpoints (unchanged)
@app.post("/api/exam/start")
@csrf.exempt
def api_exam_start():
    global current_command
    current_command = "disconnect"
    return jsonify({"status": "success", "msg": "Lệnh ngắt mạng đã được gửi đến client"})

@app.post("/api/exam/submit")
@csrf.exempt
def api_exam_submit():
    global current_command
    current_command = "reconnect"
    return jsonify({"status": "success", "msg": "Lệnh khôi phục mạng đã được gửi đến client"})

@app.get("/api/exam/command")
def api_exam_command():
    global current_command
    return jsonify({"command": current_command})

# API login/register that frontend uses
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

        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            return jsonify({
                "status": "success",
                "role": user.role,
                "user": {
                    "username": user.username,
                    "hoten": user.hoten or "",
                    "sbd": user.sbd or "",
                    "ngaysinh": user.ngaysinh or ""
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

        if User.query.filter_by(username=username).first():
            return jsonify({"status": "error", "msg": "Tài khoản đã tồn tại"}), 400

        hashed_pw = generate_password_hash(password)
        new_user = User(username=username, password_hash=hashed_pw, hoten=hoten, sbd=sbd, ngaysinh=ngaysinh, role="user")
        db.session.add(new_user)
        db.session.commit()

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
        if not exam_dir.exists():
            return jsonify([])

        codes = [f.stem.replace("questions", "") for f in exam_dir.glob("questions*.json") if f.stem.startswith("questions") and f.stem[len("questions"):].isdigit()]
        if not codes:
            return jsonify([])

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

        print("📂 Đang đọc file:", filepath.resolve())

        if not filepath.exists():
            print("❌ Không tìm thấy file:", filepath)
            return jsonify({"status": "error", "msg": f"File {filename} không tồn tại"}), 404

        # Đọc file gốc
        with open(filepath, "r", encoding="utf-8") as f:
            raw_content = f.read()
            print("📜 Nội dung JSON (500 ký tự đầu):", raw_content[:500])

        # Parse JSON
        questions = json.loads(raw_content)

        processed_questions = []
        for i, q in enumerate(questions, 1):
            kieu = q.get("kieu_cau_hoi", "trac_nghiem").lower()

            q_processed = {
                "cau": i,
                "noi_dung": q.get("noi_dung", ""),
                "kieu_cau_hoi": kieu
            }

            if kieu == "tu_luan":
                q_processed["goi_y_dap_an"] = q.get("goi_y_dap_an", "")
            else:
                q_processed["lua_chon"] = q.get("lua_chon", {})

                dap_an = q.get("dap_an_dung", "")
                print(f"🔍 Câu {i} kiểu {kieu} — dap_an_dung gốc:", dap_an)

                # Nếu đáp án là chuỗi JSON chứa dict → parse thêm 1 lần
                if isinstance(dap_an, str):
                    try:
                        parsed = json.loads(dap_an)
                        dap_an = parsed
                        print(f"✅ Câu {i}: parse thành công chuỗi JSON thành dict:", dap_an)
                    except Exception:
                        pass

                if not isinstance(dap_an, (str, dict)):
                    print(f"⚠️ Câu {i}: đáp án không hợp lệ, kiểu {type(dap_an)}")

                q_processed["dap_an_dung"] = dap_an

            processed_questions.append(q_processed)

        print("✅ Tổng số câu đọc được:", len(processed_questions))
        return jsonify(processed_questions)

    except json.JSONDecodeError:
        print("❌ JSON lỗi định dạng!")
        return jsonify({"status": "error", "msg": "File câu hỏi không hợp lệ"}), 400
    except Exception as e:
        import traceback
        print("🔥 Lỗi bất ngờ:", e)
        traceback.print_exc()
        return jsonify({"status": "error", "msg": str(e)}), 500



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



def grading(answers, question_data):
    """
    Tính điểm cho từng câu và tổng điểm (thang 10).
    Hỗ trợ: trắc nghiệm, nhiều lựa chọn, đúng/sai nhiều lựa chọn, và tự luận.
    """
    total_score = 0
    results = []

    for a in answers:
        cau = a.get("cau", "N/A")
        tra_loi = a.get("da_chon") or a.get("tra_loi_hoc_sinh")
        kieu = a.get("kieu", a.get("kieu_cau_hoi", "")).lower()

        try:
            idx = int(cau) - 1
            cau_goc = question_data[idx] if 0 <= idx < len(question_data) else {}
        except (ValueError, TypeError):
            cau_goc = {}

        dap_an_dung = cau_goc.get("dap_an_dung")
        diem_cau = 0
        tong_diem_cau = 1  # mỗi câu tối đa 1 điểm

        # --- 1. Trắc nghiệm 1 đáp án đúng ---
        if isinstance(dap_an_dung, str):
            if tra_loi == dap_an_dung:
                diem_cau = tong_diem_cau

        # --- 2. Trắc nghiệm nhiều đáp án đúng ---
        elif isinstance(dap_an_dung, list):
            if isinstance(tra_loi, list):
                dung = set(dap_an_dung)
                chon = set(tra_loi)
                if dung:
                    diem_cau = tong_diem_cau * len(dung & chon) / len(dung)

        # --- 3. Đúng/Sai nhiều lựa chọn ---
        elif isinstance(dap_an_dung, dict):
            if isinstance(tra_loi, dict):
                tong = len(dap_an_dung)
                dung_dem = sum(
                    1 for k, v in dap_an_dung.items() if tra_loi.get(k) == v
                )
                if tong > 0:
                    diem_cau = tong_diem_cau * dung_dem / tong

        # --- 4. Tự luận ---
        elif kieu == "tu_luan":
            if tra_loi and len(tra_loi.strip()) > 0:
                diem_cau = 0.5  # tạm chấm 0.5 nếu có trả lời

        total_score += diem_cau

        results.append({
            "cau": cau,
            "noi_dung": a.get("noi_dung", ""),
            "kieu": kieu,
            "diem": round(diem_cau, 2),
            "dap_an_dung": dap_an_dung,
            "da_chon": tra_loi
        })

    tong_diem_10 = round(total_score / len(answers) * 10, 2) if answers else 0
    return tong_diem_10, results

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

        # Load câu hỏi gốc (nếu có)
        filename_de = f"questions{made}.json"
        filepath_de = QUESTIONS_DIR / filename_de
        question_data = []
        if filepath_de.exists():
            try:
                with open(filepath_de, "r", encoding="utf-8") as f:
                    question_data = json.load(f)
            except Exception as e:
                app.logger.error(f"Lỗi đọc file đề: {e}")

        timestamp = datetime.now().strftime("%H:%M:%S, %d/%m/%Y")
        safe_name = secure_filename(hoten.replace(" ", "_")) or "unknown"
        filename = f"KQ_{safe_name}_{made}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        filepath = RESULTS_DIR / filename

        app.logger.info(f"[DEBUG] Lưu kết quả vào: {filepath.resolve()}")

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
                cau_goc = question_data[idx] if 0 <= idx < len(question_data) else {}
            except (ValueError, TypeError):
                cau_goc = {}

            lines.append(f"Câu {cau}: {noi_dung}")

            if kieu == "tu_luan":
                tra_loi = a.get("tra_loi_hoc_sinh", "").strip() or "[Chưa trả lời]"
                goi_y = a.get("goi_y_dap_an", "").strip()
                lines.append(f"  tra_loi_hoc_sinh: {tra_loi}")
                if goi_y:
                    lines.append(f"  Gợi ý đáp án: {goi_y}")
            else:  # trac_nghiem hoặc khác
                da_chon = a.get("da_chon", "(chưa chọn)")
                dap_an_dung = cau_goc.get("dap_an_dung", "")
                lines.append(f"  Bạn chọn: {da_chon}")
                if dap_an_dung:
                    lines.append(f"  Đáp án đúng: {dap_an_dung}")

            lines.append("")

        try:
            filepath.write_text("\n".join(lines), encoding="utf-8")
            app.logger.info(f"✅ Đã lưu kết quả: {filepath.resolve()}")
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

# ✅ Route list toàn bộ file kết quả để kiểm tra
@app.route("/list_results")
def list_results():
    try:
        files = [f.name for f in RESULTS_DIR.glob("*.txt")]
        return jsonify({"count": len(files), "files": files})
    except Exception as e:
        app.logger.error(f"Lỗi liệt kê results/: {e}")
        return jsonify({"status": "error", "msg": "Không thể đọc thư mục results"}), 500


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
    # Nếu muốn debug migration/have admin creation, có thể tạo admin mặc định ở đây (chỉ khi DB rỗng)
    with app.app_context():
        if not User.query.filter_by(role="admin").first():
            default_admin_user = os.environ.get("DEFAULT_ADMIN_USER")
            default_admin_pass = os.environ.get("DEFAULT_ADMIN_PASS")
            if default_admin_user and default_admin_pass:
                if not User.query.filter_by(username=default_admin_user).first():
                    admin = User(
                        username=default_admin_user,
                        password_hash=generate_password_hash(default_admin_pass),
                        role="admin"
                    )
                    db.session.add(admin)
                    db.session.commit()
                    app.logger.info("Đã tạo default admin từ ENV variables.")
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
