
const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://127.0.0.1:5000' : 'https://xuka.com.vn';


// Hàm gọi API disable network
async function disableNetwork() {
    try {
        await fetch(`${API_BASE}/api/exam/start`, { method: "POST" });
        console.log("Đã ngắt mạng");
    } catch (err) {
        console.error("Lỗi khi ngắt mạng:", err);
    }
}

// Hàm gọi API enable network
async function enableNetwork() {
    try {
        await fetch(`${API_BASE}/api/exam/submit`, { method: "POST" });
        console.log("Đã bật lại mạng");
    } catch (err) {
        console.error("Lỗi khi bật mạng:", err);
    }
}


// Khi bắt đầu thi
async function startExam(made) {
    // gọi API ngắt mạng
    await disableNetwork();

    // phần code gốc load đề thi
    console.log("Bắt đầu thi với mã đề:", made);
    // ... code load câu hỏi ...
}

// Khi nộp bài

async function submitExam() {
  console.log("🔹 Nộp bài...");

  try {
    // ✅ Lấy tất cả câu trả lời trong trang HTML
    const answers = [];
    document.querySelectorAll(".question-item").forEach((item, index) => {
      const cau = index + 1;
      const noi_dung = item.querySelector("p")?.innerText.trim() || "";
      const kieu = item.dataset.kieu || "trac_nghiem";
      const goi_y = item.dataset.goi_y || "";

      let tra_loi_hoc_sinh = "";
      let da_chon = "";

      if (kieu.startsWith("tu_luan")) {
        // ✅ Lấy nội dung textarea cho câu tự luận
        const textarea = item.querySelector("textarea");
        tra_loi_hoc_sinh = textarea ? textarea.value.trim() : "";
      } else {
        // ✅ Lấy câu trả lời đã chọn (trắc nghiệm / đúng sai)
        const checked = item.querySelector("input[type='radio']:checked");
        da_chon = checked ? checked.value : "";
      }

      answers.push({
        cau,
        noi_dung,
        kieu,
        tra_loi_hoc_sinh, // ✅ bắt buộc có
        da_chon,
        goi_y_dap_an: goi_y
      });
    });

    // ✅ Chuẩn bị dữ liệu gửi lên server
    const payload = {
      hoten: document.querySelector("#info-hoten").textContent.trim(),
      sbd: document.querySelector("#info-sbd").textContent.trim(),
      ngaysinh: document.querySelector("#info-dob")?.textContent.trim() || "",
      made: document.querySelector("#info-made").textContent.trim(),
      diem: calculateScore ? calculateScore().toFixed(2) : "0.00",
      answers
    };

    console.log("📤 Gửi dữ liệu:", payload);

    const res = await fetch("/save_result", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": csrf()
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log("📥 Phản hồi từ server:", data);

    if (data.status === "saved") {
      alert("✅ Bài thi đã được lưu!");
    } else {
      alert("⚠️ Lỗi lưu bài thi: " + (data.msg || "Không rõ nguyên nhân"));
    }
  } catch (err) {
    console.error("❌ Lỗi nộp bài:", err);
    alert("Lỗi khi nộp bài!");
  }
}



let time = 0;
let timer = null;
let questionData = [];
let examDeadline = null;
let currentMade = '';

function showSuccessEffect(message = "Quét thành công!") {
  const div = document.createElement("div");
  div.innerText = message;
  div.className = "fixed top-5 right-5 bg-green-500 text-white px-4 py-2 rounded-xl shadow-lg animate-bounce z-50";
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2000);
}

const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => Array.from(document.querySelectorAll(sel));
const csrf = () => (qs('meta[name="csrf-token"]')?.content || '');
const safeHTML = (html) => DOMPurify.sanitize(String(html || ''), { USE_PROFILES: { html: true } });
const nsKey = (key) => `xuka_${currentMade || 'unknown'}_${key}`;
const typeset = (el) => {
  if (window.MathJax?.typesetPromise) {
    MathJax.typesetPromise([el]).catch(err => console.error('MathJax Error:', err));
  }
};

let html5QrCode = null;
let devices = [];
let camIndex = 0;

async function checkCameraPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch (err) {
    qs('#qr-error').textContent = 'Vui lòng cấp quyền camera trong cài đặt trình duyệt!';
    qs('#qr-error').classList.remove('hidden');
    return false;
  }
}

async function ensureScanner() {
  if (!html5QrCode) html5QrCode = new Html5Qrcode('reader');
  return html5QrCode;
}

async function stopScanner() {
  if (html5QrCode) {
    try { await html5QrCode.stop(); } catch (_) {}
    try { await html5QrCode.clear(); } catch (_) {}
    html5QrCode = null;
  }
}

async function startQrScanner() {
  const readerElem = qs('#reader');
  if (!readerElem) return;
  await ensureScanner();
  const hasPerm = await checkCameraPermission();
  if (!hasPerm) return;

  try {
    const list = await Html5Qrcode.getCameras();
    devices = list || [];
    if (devices.length === 0) {
      qs('#qr-error').textContent = 'Không tìm thấy camera trên thiết bị!';
      qs('#qr-error').classList.remove('hidden');
      return;
    }
    const camId = devices[camIndex]?.id || { facingMode: 'environment' };
    await html5QrCode.start(camId, { fps: 10, qrbox: { width: 250, height: 250 } }, async (decodedText) => {
      console.log('Mã QR được giải mã:', decodedText);
      await stopScanner();
      await verifyAndLogin(decodedText);
    }, () => {});
  } catch (err) {
    qs('#qr-error').textContent = `Lỗi camera: ${err?.message || err}`;
    qs('#qr-error').classList.remove('hidden');
  }
}

qs('#flip-camera')?.addEventListener('click', async () => {
  if (!devices.length || !html5QrCode) return;
  camIndex = (camIndex + 1) % devices.length;
  try {
    await html5QrCode.stop();
    await html5QrCode.start(devices[camIndex].id, { fps: 10, qrbox: { width: 250, height: 250 } }, async (dt) => {
      console.log('Mã QR được giải mã (chuyển camera):', dt);
      await stopScanner();
      await verifyAndLogin(dt);
    }, () => {});
  } catch (e) {
    console.error('Không đổi được camera:', e);
    qs('#qr-error').textContent = 'Không thể đổi camera!';
    qs('#qr-error').classList.remove('hidden');
  }
});

const qrFileInput = qs('#qr-file');
qs('#upload-qr')?.addEventListener('click', () => {
  qs('#qr-error').classList.add('hidden');
  qrFileInput.click();
});

qrFileInput?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) {
    qs('#qr-error').textContent = 'Không có tệp nào được chọn!';
    qs('#qr-error').classList.remove('hidden');
    return;
  }
  if (!file.type.startsWith('image/')) {
    qs('#qr-error').textContent = 'Vui lòng chọn một tệp hình ảnh!';
    qs('#qr-error').classList.remove('hidden');
    return;
  }
  await stopScanner();
  await ensureScanner();
  try {
    const img = new Image();
    img.src = URL.createObjectURL(file);
    await new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Không thể tải hình ảnh!'));
    });
    const decoded = await html5QrCode.scanFile(file, false);
    console.log('Mã QR được giải mã từ tệp:', decoded);
    URL.revokeObjectURL(img.src);
    await stopScanner();
    await verifyAndLogin(decoded);
  } catch (err) {
    qs('#qr-error').textContent = `Không thể đọc mã QR từ ảnh: ${err.message || err}`;
    qs('#qr-error').classList.remove('hidden');
  } finally {
    qrFileInput.value = '';
  }
});

async function verifyAndLogin(qrText) {
  qs('#qr-error').classList.add('hidden');
  if (!qrText) {
    qs('#qr-error').textContent = 'Mã QR rỗng!';
    qs('#qr-error').classList.remove('hidden');
    return;
  }
  console.log('Gửi mã QR đến server:', qrText, 'CSRF Token:', csrf());
  try {
    const res = await fetch(`${API_BASE}/api/decrypt_qr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrf()
      },
      body: JSON.stringify({ qr_value: qrText.trim() })
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.msg || `Phản hồi máy chủ không thành công: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    if (data.status === 'success') {
      showSuccessEffect();
      qs('#left-column').classList.add('hidden');
      qs('#right-column').classList.add('hidden');
      qs('#button-group').classList.add('hidden');
      qs('#qr-login').classList.add('hidden');
      qs('#account-login').classList.remove('hidden');
      qs('#account-login').scrollIntoView({ behavior: 'smooth' });
    } else {
      throw new Error(data.msg || 'Mã QR không hợp lệ!');
    }
  } catch (err) {
    console.error('Lỗi verifyAndLogin:', err);
    qs('#qr-error').textContent = err.message || 'Lỗi kết nối máy chủ!';
    qs('#qr-error').classList.remove('hidden');
  }
}

qs('#account-login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = qs('#username').value.trim();
  const password = qs('#password').value;
  if (!username || !password) {
    const x = qs('#login-error');
    x.textContent = 'Vui lòng nhập đầy đủ tài khoản và mật khẩu!';
    x.classList.remove('hidden');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data && (data.ok || data.status === 'success')) {
      qs('#account-login').classList.add('hidden');
      qs('#login-form').classList.remove('hidden');
      qs('#login-form').scrollIntoView({ behavior: 'smooth' });
      loadExamCodes();
    } else {
      throw new Error(data?.message || 'Sai tài khoản hoặc mật khẩu!');
    }
  } catch (err) {
    const x = qs('#login-error');
    x.textContent = err.message;
    x.classList.remove('hidden');
  }
});

async function loadExamCodes() {
  const select = qs('#made');
  try {
    const res = await fetch(`${API_BASE}/get_exam_codes`, { headers: { 'Accept': 'application/json', 'X-CSRFToken': csrf() } });
    const data = await res.json();
    const codes = Array.isArray(data) ? data : (data.codes || []);
    select.innerHTML = '<option value="">-- Chọn mã đề --</option>' + codes.map(c => `<option value="${c}">${c}</option>`).join('');
  } catch (err) {
    const p = qs('#form-error');
    p.textContent = 'Không thể tải danh sách mã đề. Vui lòng thử lại!';
    p.classList.remove('hidden');
  }
}

qs('#btn-start-exam')?.addEventListener('click', async () => {
  const name = qs('#hoten').value.trim();
  const sbd = qs('#sbd').value.trim();
  const dob = qs('#ngaysinh').value;
  const made = qs('#made').value;
  const error = qs('#form-error');
  if (!name || !sbd || !dob || !made) {
    error.textContent = 'Vui lòng nhập đầy đủ Họ tên, SBD, Ngày sinh và Mã đề!';
    error.classList.remove('hidden');
    return;
  }
  error.classList.add('hidden');
  await startExam(name, sbd, dob, made);
});


function submitAnswers() {
  const answers = [];
  document.querySelectorAll('.question').forEach((questionElement, index) => {
    const cau = (index + 1).toString();
    const noi_dung = questionElement.querySelector('.question-content')?.textContent || 'Không có nội dung';
    const kieu = questionElement.dataset.type || 'trac_nghiem'; // Lấy kiểu câu hỏi từ data-type
    let tra_loi_hoc_sinh = '';
    let da_chon = '';

    if (kieu === 'tu_luan') {
      // Thu thập câu trả lời tự luận từ textarea
      tra_loi_hoc_sinh = questionElement.querySelector('textarea')?.value.trim() || '';
    } else {
      // Thu thập câu trả lời trắc nghiệm từ radio/checkbox
      da_chon = questionElement.querySelector('input:checked')?.value || '(chưa chọn)';
    }

    const answer = {
      cau: cau,
      noi_dung: noi_dung,
      kieu: kieu
    };

    if (kieu === 'tu_luan') {
      answer.tra_loi_hoc_sinh = tra_loi_hoc_sinh;
      answer.goi_y_dap_an = questionElement.dataset.suggestedAnswer || ''; // Nếu có gợi ý
    } else {
      answer.da_chon = da_chon;
    }

    answers.push(answer);
  });

  // Gửi dữ liệu lên server
  const payload = {
    hoten: document.getElementById('hoten')?.value || 'unknown',
    sbd: document.getElementById('sbd')?.value || 'N/A',
    ngaysinh: document.getElementById('ngaysinh')?.value || 'N/A',
    made: document.getElementById('made')?.value || '000',
    diem: document.getElementById('diem')?.value || '0.00',
    answers: answers
  };

  console.log('Payload gửi đi:', JSON.stringify(payload)); // Log để kiểm tra

  fetch('/save_result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(response => response.json())
    .then(data => {
      console.log('Response từ server:', data);
      alert('Kết quả đã được lưu!');
    })
    .catch(error => console.error('Lỗi:', error));
}


async function startExam(name, sbd, dob, made) {
  currentMade = made;
  qs('#info-hoten').textContent = name;
  qs('#info-sbd').textContent = sbd;
  qs('#info-made').textContent = made;
  qs('#login-form').classList.add('hidden');
  qs('#exam-container').classList.remove('hidden');
  qs('#exam-container').scrollIntoView({ behavior: 'smooth' });

  // Lấy deadline
  try {
    const res = await fetch(`${API_BASE}/exam_session?made=${encodeURIComponent(made)}`, {
      headers: { 'Accept': 'application/json', 'X-CSRFToken': csrf() }
    });
    const data = await res.json();
    if (data?.deadline) examDeadline = Number(data.deadline);
    const duration = Number(data?.duration_sec || 3600);
    if (!examDeadline) examDeadline = Date.now() + duration * 1000;
  } catch (_) {
    examDeadline = Date.now() + 3600 * 1000;
  }

  updateCountdown();
  timer = setInterval(updateCountdown, 1000);

  // Lấy câu hỏi
  try {
    const res = await fetch(`${API_BASE}/get_questions?made=${encodeURIComponent(made)}`, {
      headers: { 'Accept': 'application/json', 'X-CSRFToken': csrf() }
    });
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Dữ liệu câu hỏi không phải mảng');

    // Xử lý dữ liệu kết hợp công thức + giữ dap_an_dung gốc
    questionData = data.map((q, i) => {
      // Giữ nguyên dap_an_dung gốc
      let original = { ...q };
      if (q.dap_an_dung && typeof q.dap_an_dung === "object" && !Array.isArray(q.dap_an_dung)) {
        original.dap_an_dung = { ...q.dap_an_dung };
      } else if (Array.isArray(q.dap_an_dung)) {
        original.dap_an_dung = [...q.dap_an_dung];
      } else if (typeof q.dap_an_dung === "string") {
        original.dap_an_dung = q.dap_an_dung.trim();
      } else {
        original.dap_an_dung = q.dap_an_dung || "";
      }

      // Tạo bản hiển thị công thức đúng
      let fixed = processAllQuestions([q])[0];

      // Gắn lại dap_an_dung gốc để chấm điểm
      fixed.dap_an_dung = original.dap_an_dung;
      fixed.cau = i + 1;

      return fixed;
    });

    renderQuestions(questionData);
    renderAnswerSheet();
    restoreAnswers();
    updateProgress();

  } catch (err) {
    console.warn("⚠️ Lỗi tải câu hỏi từ API, chuyển sang local file:", err);
    const jsonFile = `/questions/questions${made}.json`;

    try {
      const res = await fetch(jsonFile, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Dữ liệu câu hỏi không phải mảng');

      questionData = data.map((q, i) => {
        let original = { ...q };
        if (q.dap_an_dung && typeof q.dap_an_dung === "object" && !Array.isArray(q.dap_an_dung)) {
          original.dap_an_dung = { ...q.dap_an_dung };
        } else if (Array.isArray(q.dap_an_dung)) {
          original.dap_an_dung = [...q.dap_an_dung];
        } else if (typeof q.dap_an_dung === "string") {
          original.dap_an_dung = q.dap_an_dung.trim();
        } else {
          original.dap_an_dung = q.dap_an_dung || "";
        }

        let fixed = processAllQuestions([q])[0];
        fixed.dap_an_dung = original.dap_an_dung;
        fixed.cau = i + 1;

        return fixed;
      });

      renderQuestions(questionData);
      renderAnswerSheet();
      restoreAnswers();
      updateProgress();

    } catch (e) {
      console.error('❌ Lỗi tải câu hỏi local:', e);
      qs('#form-error').textContent = `Không thể tải câu hỏi: ${e.message}`;
      qs('#form-error').classList.remove('hidden');
    }
  }
}

function updateCountdown() {
  const now = Date.now();
  const remainMs = Math.max(0, (examDeadline || now) - now);
  const remain = Math.floor(remainMs / 1000);
  const m = String(Math.floor(remain / 60)).padStart(2, '0');
  const s = String(remain % 60).padStart(2, '0');
  qs('#countdown').innerText = `${m}:${s}`;
  localStorage.setItem(nsKey('savedTime'), remain);
  if (remain <= 0) {
    clearInterval(timer);
    submitExam(true);
  }
}

function updateProgress() {
  const total = questionData.length;
  let answered = 0;
  questionData.forEach((_, i) => {
    if (getAnswerValue(i)) answered++;
  });
  const percentage = total ? (answered / total * 100).toFixed(0) : 0;
  qs('#progress-bar').style.width = `${percentage}%`;
 
  qs('#progress-text').textContent = `${answered} trên ${total} câu`;


}



// Hàm xử lý biểu thức có dấu quan hệ
function wrapRelationalExpressions(s) {
  const relationalExpr = /(?:\([^\)]+\)\s*(?:\^\{\d+\}|\^\d+)?|[A-Za-z0-9\\\{\}\^\(\)]+(?:\s*[-+*/]\s*[A-Za-z0-9\\\{\}\^\(\)]+)*)\s*(?:\\le|\\ge|\\neq|<=|>=|≤|≥|≠|=|<|>)\s*(?:\([^\)]+\)\s*(?:\^\{\d+\}|\^\d+)?|[A-Za-z0-9\\\{\}\^\(\)]+)/g;

  return s.replace(relationalExpr, function(match) {
    const args = arguments;
    const offset = args[args.length - 2];
    const str = args[args.length - 1];
    if (typeof isInsideMath === "function" && isInsideMath(str, offset)) return match;
    return `\\(${match.trim()}\\)`;
  });
}



function applyGeneralFormatting(s) {
  s = String(s || "");
  s = s.replace(/−/g, "-").replace(/π/g, "\\pi");
  s = s.replace(/(\d+)\s*\n\s*(\+|\-|\)|\*|\/|\^)/g, "$1 $2");
  s = s.replace(/(\^)\s*\n\s*(\d+)/g, "$1$2");
  s = s.replace(/([a-zA-Z])\s*\n\s*([a-zA-Z])/g, "$1 $2");
  s = s.replace(/^\s+/gm, "");
  s = s.replace(/(^|\.\s+)([^\s])/g, (_, pre, ch) => pre + ch);
  s = s.replace(/\s{2,}/g, " ").trim();
  s = s.replace(/Câu\s*(\d+)\s*\.(?!\s)/gi, "Câu $1. ");
  s = s.replace(/([.,;:!?])([^\s])/g, "$1 $2");
  s = s.replace(/([a-zA-Z])(\d)/g, "$1 $2");
  s = s.replace(/(\d)([a-zA-Z])/g, "$1 $2");
  s = s.replace(/\s*([+\-*/=])\s*/g, " $1 ");
  

  // Superscript trong ngoặc, ví dụ e^(2x)
  s = s.replace(/([A-Za-z0-9π)])\^\(([^)]+)\)/g, (_, base, sup) => `${base}^{${sup}}`);

  // Superscript số đơn, ví dụ x^2
  s = s.replace(/([A-Za-z0-9π)\]])\^(\d+)/g, (_, base, sup) => `${base}^{${sup}}`);

  // Dấu câu + khoảng trắng (chỉ thêm nếu không có sẵn)
  s = s.replace(/([.,;:!?])([^\s])/g, "$1 $2");

  // Loại bỏ khoảng trắng thừa
  s = s.replace(/\s{2,}/g, " ");

  // Subscript & superscript Unicode
  const subMap = { '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9' };
  const supMap = { '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9' };
  s = s.replace(/[\u2080-\u2089]/g, m => subMap[m] || m);
  s = s.replace(/[\u2070-\u2079]/g, m => `^${supMap[m] || m}`);

  return s;
}


function wrapMath(expr) {
  if (!expr) return "";
  expr = expr.trim();
  // avoid double wrapping
  if (/^\\\(.*\\\)$/.test(expr)) return expr;
  return `\\(${expr}\\)`;
}
function processMathContent(content) {
  let s = applyGeneralFormatting(content);
  s = wrapRelationalExpressions(s);
  s = s.replace(/\s{2,}/g, " ").trim();
  s = s.replace(/([^\s])∫/g, "$1 ∫");
  s = s.replace(/∫([^\s])/g, "∫ $1");
  s = s.replace(/([^\s])dx\b/gi, "$1 dx");
  s = s.replace(/([^\s])\\pi/g, "$1 \\pi");
  s = s.replace(/\\pi([^\s])/g, "\\pi $1");
  s = s.replace(/\b(sin|cos|tan|cot|sec|csc|arctan|arcsin|arccos|ln|log)\s*([A-Za-z0-9\\pi])/gi, "$1 $2");
  s = s.replace(/\bGiảihệbấtphươngtrình\b/gi, "Giải hệ bất phương trình");
  s = s.replace(/\bGiảibấtphươngtrình\b/gi, "Giải bất phương trình");
  s = s.replace(/\blog(\d+)\(([^)]+)\)/gi, (_, base, arg) => `\\log_{${base}}(${arg.trim()})`);
  s = s.replace(/\blog\(([^)]+)\)/gi, (_, arg) => `\\log(${arg.trim()})`);
  s = s.replace(/ln\(([^)]+)\)/gi, (_, arg) => `\\ln(${arg.trim()})`);
  s = s.replace(/frac\(([^,]+),([^)]+)\)/gi, (_, a, b) => `\\frac{${a.trim()}}{${b.trim()}}`);
  // Updated fraction rule to handle LaTeX commands like \pi
  s = s.replace(/\b((?:\\(?:pi|sqrt|log|ln|sum|int|frac)\{[^}]*\}|[A-Za-z0-9]+|[0-9]+))\/((?:\\(?:pi|sqrt|log|ln|sum|int|frac)\{[^}]*\}|[A-Za-z0-9]+|[0-9]+))\b/g,
    (_, a, b) => `\\frac{${a.trim()}}{${b.trim()}}`);
  s = s.replace(/sqrt\[(\d+)\]\(([^)]+)\)/gi, (_, n, val) => `\\sqrt[${n}]{${val.trim()}}`);
  s = s.replace(/sqrt\(([^)]+)\)/gi, (_, val) => `\\sqrt{${val.trim()}}`);
  s = s.replace(/([A-Za-z])_(\d+)/g, (_, base, sub) => `${base}_{${sub}}`);
  s = s.replace(/([A-Za-z0-9])\^(\d+)/g, (_, base, sup) => `${base}^{${sup}}`);

  // 👇 bổ sung rule cho ( ... )^n
  s = s.replace(/\)\s*\^(\d+)/g, (_, sup) => `)^{${sup}}`);

  s = s.replace(/int_([^_]+)(?:_([^_]+))?([^]*?)(?=\s|$)/gi, (_, from, to, body) =>
    `\\int${from ? `_{${from}}` : ""}${to ? `^{${to}}` : ""}${body.trim()}`
  );
  s = s.replace(/sum_([^_]+)(?:_([^_]+))?([^]*?)(?=\s|$)/gi, (_, from, to, body) =>
    `\\sum${from ? `_{${from}}` : ""}${to ? `^{${to}}` : ""}${body.trim()}`
  );
  s = s.replace(/lim_([^_]+)([^]*?)(?=\s|$)/gi, (_, limit, body) => `\\lim_{${limit}}${body.trim()}`);
  s = s.replace(/d\/dx\(([^)]+)\)/gi, (_, expr) => `\\frac{d}{dx}(${expr.trim()})`);
  s = s.replace(/\be\s*\(\s*([^)]+?)\s*\)/g, (_, p1) => `e^{${p1.replace(/\s+/g, "")}}`);
  s = s.replace(/\be\^\s*\(\s*([^)]+?)\s*\)/g, (_, p1) => `e^{${p1.replace(/\s+/g, "")}}`);
  s = s.replace(/(?<!\\frac\{)1\s*\/\s*([a-zA-Z0-9\\pi\+\-\*\/]+)/g, "\\frac{1}{$1}");
  s = s.replace(/∫\s*từ\s*([^\s]+)\s*đến\s*([^\s]+)\s*của\s*\(?\s*([^)]+?)\s*\)?\s*dx/gi,
    (_, a, b, expr) => `\\int_{${a.replace(/π/g, "\\pi")}}^{${b.replace(/π/g, "\\pi")}} ${expr.trim()} \\, dx`
  );
  s = s.replace(/∫\s*([^\n\r]+?)\s*dx\b/gi, (_, expr) => `\\int ${expr.trim()} \\, dx`);
  return s;
}

function processPhysicsContent(content) {
  let s = applyGeneralFormatting(content);
  s = s.replace(/vec\{(\w+)\}/gi, (_, v) => `\\vec{${v}}`);
  s = s.replace(/\|vec\{(\w+)\}\|/gi, (_, v) => `|\\vec{${v}}|`);
  s = s.replace(/Delta/g, "\\Delta");
  s = s.replace(/nabla/g, "\\nabla");
  s = s.replace(/(\w+)_(\w+)/g, (_, base, sub) => `${base}_{${sub}}`);
  s = s.replace(/(\w+)\^(\w+)/g, (_, base, sup) => `${base}^{${sup}}`);
  return s;
}

function processChemistryContent(content) {
  let s = applyGeneralFormatting(content);
  s = s.replace(/H_2O/g, "\\ce{H2O}");
  s = s.replace(/CO_2/g, "\\ce{CO2}");
  s = s.replace(/([A-Z][a-z]?)(\d+)/g, '$1<sub>$2</sub>');
  s = s.replace(/([A-Z][a-z]?)_(\d+)/g, (_, elem, num) => `\\ce{${elem}${num}}`);
  s = s.replace(/([A-Z][a-z]?)(\d+)/g, "\\ce{$1_$2}");
  s = s.replace(/([A-Z][a-z]?)[\s]*([0-9]+)/g, (_, elem, num) => `${elem}${num}`);
  const chemRegex = /(?:[A-Z][a-z]?\d*|\([A-Z][a-z]?\d*\)\d*)(?:\s*(?:[A-Z][a-z]?\d*|\([A-Z][a-z]?\d*\)\d*))*/g;
  s = s.replace(chemRegex, match => {
    if (/^[A-Za-z\s]+$/.test(match)) return match;
    return `\\ce{${match}}`;
  });
  return s;
}

function processExamContent(content) {
  let s = applyGeneralFormatting(content);
  s = processMathContent(s);
  s = processPhysicsContent(s);
  s = processChemistryContent(s);
  const patterns = [
    /\\int[\s\S]*?\\,\s*dx/g,
    /\\frac\{[^}]+\}\{[^}]+\}/g,
    /\\sqrt(?:\[[^\]]+\])?\{[^}]+\}/g,
    /\\log_\{\d+\}\([^)]*\)/g,
    /\b(?:log\d*|log|ln|sin|cos|tan|exp)\([^)]*\)/gi,
    /[A-Za-z0-9]+_\{\d+\}/g,
    /[A-Za-z0-9]\^\{\d+\}/g,
    /\\ce\{[^}]+\}/g,
    /\\Delta/g,
    /\\nabla/g,
    /e\^\{[^}]+\}/g
  ];
  patterns.forEach((pattern) => {
    s = s.replace(pattern, function (match, ...args) {
      const offset = args[args.length - 2];
      const str = args[args.length - 1];
      if (isInsideMath(str, offset)) return match;
      if (/^\\\(.*\\\)$/.test(match)) return match;
      return `\\(${match}\\)`;
    });
  });
  s = s.replace(/\s{2,}/g, " ").trim();
  return s;
}



function isInsideMath(str, offset) {
  const upto = str.slice(0, offset);
  const lastOpen = upto.lastIndexOf("\\(");
  const lastClose = upto.lastIndexOf("\\)");
  return lastOpen > lastClose;
}


function processAllQuestions(questions) {
  return questions.map(q => {
    const qq = { ...q };
    qq.noi_dung = processExamContent(qq.noi_dung);
    if (qq.lua_chon && typeof qq.lua_chon === 'object') {
      for (const k in qq.lua_chon) {
        if (Object.prototype.hasOwnProperty.call(qq.lua_chon, k)) {
          qq.lua_chon[k] = processExamContent(qq.lua_chon[k]);
        }
      }
    }
    qq.dap_an_dung = qq.dap_an_dung ? String(qq.dap_an_dung).trim() : '';
    qq.goi_y_dap_an = qq.goi_y_dap_an ? processExamContent(qq.goi_y_dap_an) : '';
    return qq;
  });
}

function getAnswerValue(index) {
  const q = questionData[index];
  if ((q.kieu_cau_hoi || '').toLowerCase() === 'tu_luan') {
    const ta = qs(`#q${index}`);
    return ta ? ta.value.trim() : '';
  } else {
    const radios = qsa(`input[name="q${index}"]`);
    for (const r of radios) {
      if (r.checked) return r.value;
    }
    return '';
  }
}

function renderQuestions(questions) {
  const container = qs('#questions');
  container.innerHTML = '';

  const unansweredLabel = document.createElement('p');
  unansweredLabel.id = 'unanswered-count';
  unansweredLabel.className = 'text-red-600 font-bold mb-4';
  container.appendChild(unansweredLabel);

  questions.forEach((q, i) => {
    const div = document.createElement('div');
    div.className = 'mb-6 p-4 bg-gray-50 rounded-lg shadow-sm';
    div.id = `q-container-${i}`;

    const label = document.createElement('label');
    label.className = 'block font-semibold mb-2 text-lg';
    label.innerHTML = `Câu ${i + 1}: ${safeHTML(q.noi_dung)}`;
    div.appendChild(label);

    const type = (q.kieu_cau_hoi || '').toLowerCase();

    // Tự luận
    if (type === 'tu_luan') {
      const ta = document.createElement('textarea');
      ta.id = `q${i}`;
      ta.rows = 4;
      ta.placeholder = 'Nhập câu trả lời...';
      ta.className = 'border p-2 w-full rounded-md';
      ta.setAttribute('data-type', 'tu_luan');
      div.appendChild(ta);
    }

    // Trắc nghiệm 1 lựa chọn
    else if (q.lua_chon && type !== 'dung_sai_nhieu_lua_chon') {
      const wrap = document.createElement('div');
      wrap.className = 'border rounded-md p-2 max-h-40 overflow-y-auto space-y-2';
      Object.entries(q.lua_chon).forEach(([k, v]) => {
        const id = `q${i}_${k}`;
        const row = document.createElement('div');
        row.className = 'flex items-start gap-2';
        row.innerHTML = `
          <input type="radio" name="q${i}" id="${id}" value="${k}" class="mt-1">
          <label for="${id}" class="overflow-x-auto block" style="max-width: calc(100% - 30px);">
            ${safeHTML(`${k}. ${v}`)}
          </label>
        `;
        wrap.appendChild(row);
      });
      div.appendChild(wrap);
    }

    // Đúng/Sai nhiều lựa chọn
    else if (type === 'dung_sai_nhieu_lua_chon' && q.lua_chon) {
      Object.entries(q.lua_chon).forEach(([k, v]) => {
        const subDiv = document.createElement('div');
        subDiv.className = 'mb-2 pl-4';
        const subLabel = document.createElement('p');
        subLabel.className = 'mb-1 font-medium';
        subLabel.innerHTML = `${k}. ${safeHTML(v)}`;
        subDiv.appendChild(subLabel);

        const btnWrap = document.createElement('div');
        btnWrap.className = 'flex items-center gap-4 pl-6';
        btnWrap.innerHTML = `
          <label class="flex items-center gap-1">
            <input type="radio" name="q${i}_${k}" value="Đúng"> Đúng
          </label>
          <label class="flex items-center gap-1">
            <input type="radio" name="q${i}_${k}" value="Sai"> Sai
          </label>
        `;
        subDiv.appendChild(btnWrap);
        div.appendChild(subDiv);
      });
    }

    container.appendChild(div);
  });

  // ✅ Gắn sự kiện lưu câu tự luận
  document.querySelectorAll('textarea[data-type="tu_luan"]').forEach((textarea, i) => {
    textarea.addEventListener('input', e => {
      const val = e.target.value.trim();
      const saved = JSON.parse(localStorage.getItem(nsKey('savedAnswers')) || '{}');
      saved[`q${i}`] = val;
      localStorage.setItem(nsKey('savedAnswers'), JSON.stringify(saved));
    });
  });
}


function showResults(questions) {
  const container = qs('#results');
  container.innerHTML = '';

  const saved = JSON.parse(localStorage.getItem(nsKey('savedAnswers')) || '{}');
  let total = 0;
  let score = 0;

  questions.forEach((q, i) => {
    const div = document.createElement('div');
    div.className = 'mb-4 p-3 bg-gray-50 rounded-lg shadow-sm';

    const type = (q.kieu_cau_hoi || '').toLowerCase();
    let userAns, correctAns, mark;

    const title = document.createElement('p');
    title.className = 'font-semibold';
    title.innerHTML = `Câu ${i + 1}: ${safeHTML(q.noi_dung)}`;
    div.appendChild(title);

    // -----------------------------
    // 1. Câu hỏi tự luận
    // -----------------------------
    if (type === 'tu_luan') {
      userAns = saved[`q${i}`] || '';
      correctAns = q.goi_y_dap_an || '';
      mark = userAns.trim() ? '✅' : '❌'; // đánh dấu nếu có trả lời
      div.innerHTML += `<p>Trả lời của bạn: ${safeHTML(userAns)} ${mark}</p>`;
      div.innerHTML += `<p>Gợi ý đáp án: ${safeHTML(correctAns)}</p>`;
    }

    // -----------------------------
    // 2. Trắc nghiệm (1 lựa chọn)
    // -----------------------------
    else if (type !== 'dung_sai_nhieu_lua_chon') {
      userAns = saved[`q${i}`] || '';
      correctAns = q.dap_an_dung; // ví dụ "a"
      mark = userAns === correctAns ? '✅' : '❌';
      div.innerHTML += `<p>Bạn chọn: ${userAns || '...'} ${mark}</p>`;
      div.innerHTML += `<p>Đáp án đúng: ${correctAns}</p>`;
      if (mark === '✅') score += 1;
      total += 1;
    }

    // -----------------------------
    // 3. Đúng/Sai nhiều lựa chọn
    // -----------------------------
    else if (type === 'dung_sai_nhieu_lua_chon') {
      const resList = [];
      Object.keys(q.lua_chon).forEach(k => {
        userAns = saved[`q${i}_${k}`] || '';
        correctAns = q.dap_an_dung[k]; // "Đúng" hoặc "Sai"
        mark = userAns === correctAns ? '✅' : '❌';
        resList.push(`${k}: Bạn chọn ${userAns || '...'} ${mark}, Đáp án đúng: ${correctAns}`);
        if (userAns === correctAns) score += 1;
        total += 1;
      });
      div.innerHTML += `<p>${resList.join('<br>')}</p>`;
    }

    container.appendChild(div);
  });

  // Tổng điểm
  const scoreDiv = document.createElement('div');
  scoreDiv.className = 'mt-4 p-3 bg-green-50 rounded-lg font-bold';
  scoreDiv.innerHTML = `Điểm: ${score.toFixed(2)} / ${total}`;
  container.appendChild(scoreDiv);
}

async function uploadResultsToServer() {
  const saved = JSON.parse(localStorage.getItem(nsKey('savedAnswers')) || '{}');

  // Tạo danh sách câu trả lời gửi lên server
  const answers = questions.map((q, i) => {
    const type = (q.kieu_cau_hoi || '').toLowerCase();
    let user_answer = '';
    let suggest_answer = q.goi_y_dap_an || '';
    let correct_answer = '';
    
    // --- 1️⃣ CÂU TỰ LUẬN ---
    if (type === 'tu_luan') {
      user_answer = saved[`q${i}`]?.trim() || "[Chưa trả lời]";
    }

    // --- 2️⃣ CÂU TRẮC NGHIỆM 1 LỰA CHỌN ---
    else if (type !== 'dung_sai_nhieu_lua_chon') {
      const selected = saved[`q${i}`];
      user_answer = selected ? `${selected}. ${q.lua_chon[selected]}` : "[Chưa trả lời]";
      correct_answer = Array.isArray(q.dap_an_dung) ? q.dap_an_dung[0] : q.dap_an_dung;
    }

    // --- 3️⃣ CÂU ĐÚNG/SAI NHIỀU LỰA CHỌN ---
    else if (type === 'dung_sai_nhieu_lua_chon') {
      const lines = [];
      Object.keys(q.lua_chon || {}).forEach(k => {
        const ua = saved[`q${i}_${k}`] || "[Chưa chọn]";
        const da = q.dap_an_dung?.[k] || '';
        lines.push(`${k}: Bạn chọn ${ua}, Đáp án đúng: ${da}`);
      });
      user_answer = lines.join('; ');
    }

    return {
      cau: i + 1,
      question: q.noi_dung || "Không có nội dung", // ✅ nội dung câu hỏi
      user_answer,
      suggest_answer,
      correct_answer,
      kieu: type
    };
  });

  const payload = {
    hoten: qs('#hoten')?.value || '',
    sbd: qs('#sbd')?.value || '',
    ngaysinh: qs('#ngaysinh')?.value || '',
    made: qs('#made')?.value || '',
    diem: window.finalScore || 0,
    answers
  };

  try {
    const res = await fetch('/save_result', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log('✅ Đã gửi kết quả:', data);
    if (data.status === 'saved') alert("✅ Bài làm đã được lưu lên server!");
  } catch (err) {
    console.error('❌ Lỗi khi gửi kết quả:', err);
    alert("❌ Không thể lưu kết quả lên server!");
  }
}



  // Cập nhật số câu chưa trả lời
  function updateUnansweredCount() {
    let unanswered = 0;
    questions.forEach((q, i) => {
      const type = (q.kieu_cau_hoi || '').toLowerCase();
      if (type === 'tu_luan') {
        if (!qs(`#q${i}`)?.value.trim()) unanswered++;
      } else if (type === 'dung_sai_nhieu_lua_chon') {
        Object.keys(q.lua_chon).forEach(k => {
          if (!qsa(`input[name="q${i}_${k}"]:checked`).length) unanswered++;
        });
      } else {
        if (!qsa(`input[name="q${i}"]:checked`).length) unanswered++;
      }
    });
    unansweredLabel.textContent = `Câu chưa trả lời: ${unanswered}`;
  }

  function saveAnswers() {
    const cur = {};
    questions.forEach((q, i) => {
      const type = (q.kieu_cau_hoi || '').toLowerCase();
      if (type === 'tu_luan') cur[`q${i}`] = qs(`#q${i}`)?.value || '';
      else if (type === 'dung_sai_nhieu_lua_chon') {
        Object.keys(q.lua_chon).forEach(k => {
          const sel = qs(`input[name="q${i}_${k}"]:checked`);
          cur[`q${i}_${k}`] = sel ? sel.value : '';
        });
      } else {
        const sel = qs(`input[name="q${i}"]:checked`);
        cur[`q${i}`] = sel ? sel.value : '';
      }
    });
    localStorage.setItem(nsKey('savedAnswers'), JSON.stringify(cur));
    updateUnansweredCount();
  }

  // Thêm sự kiện input/change
  questions.forEach((q, i) => {
    const type = (q.kieu_cau_hoi || '').toLowerCase();
    if (type === 'tu_luan') qs(`#q${i}`)?.addEventListener('input', saveAnswers);
    else if (type === 'dung_sai_nhieu_lua_chon') {
      Object.keys(q.lua_chon).forEach(k => {
        qsa(`input[name="q${i}_${k}"]`).forEach(r => r.addEventListener('change', saveAnswers));
      });
    } else qsa(`input[name="q${i}"]`).forEach(r => r.addEventListener('change', saveAnswers));
  });

  updateUnansweredCount();
  typeset?.(container);

  // Nộp bài và tính điểm
 
 window.showResults = function() {
    const saved = JSON.parse(localStorage.getItem(nsKey('savedAnswers')) || '{}');
    let totalScore = 0;

    questions.forEach((q, i) => {
      const qDiv = qs(`#q-container-${i}`);
      const type = (q.kieu_cau_hoi || '').toLowerCase();
      const resultDiv = document.createElement('div');
      resultDiv.className = 'mt-2 p-2 bg-gray-100 rounded-md text-sm';

      if (type === 'tu_luan') {
        const userAns = saved[`q${i}`] || '';
        resultDiv.innerHTML = `<strong>Gợi ý đáp án:</strong> ${safeHTML(q.goi_y_dap_an || '')}<br>
                               <strong>Đáp án của bạn:</strong> ${safeHTML(userAns)}`;
      } else if (type === 'dung_sai_nhieu_lua_chon') {
        let correctCount = 0, total = Object.keys(q.lua_chon).length;
        let display = '';
        Object.keys(q.lua_chon).forEach(k => {
          const userAns = saved[`q${i}_${k}`] || '';
          const correct = q.dap_an_dung.includes(k) ? 'Đúng' : 'Sai';
          const mark = userAns === correct ? '✅' : '❌';
          if(userAns === correct) correctCount++;
          display += `${k}: Bạn chọn ${userAns || '...'} ${mark}, Đáp án đúng: ${correct}<br>`;
        });
        totalScore += correctCount / total;
        resultDiv.innerHTML = display;
      } else {
        const userAns = saved[`q${i}`] || '';
        const correctAns = Array.isArray(q.dap_an_dung) ? q.dap_an_dung[0] : q.dap_an_dung;
        const mark = userAns === correctAns ? '✅' : '❌';
        if(userAns === correctAns) totalScore += 1;
        resultDiv.innerHTML = `Bạn chọn: ${userAns || '...'} ${mark}<br>Đáp án đúng: ${correctAns}`;
      }

      qDiv.appendChild(resultDiv);
    });

    const scoreDiv = document.createElement('div');
    scoreDiv.className = 'mt-4 text-lg font-bold text-green-700';
    scoreDiv.innerHTML = `Điểm: ${totalScore.toFixed(2)}`;
    container.appendChild(scoreDiv);
  }
}






function renderAnswerSheet() {
  const sheet = qs('#answer-sheet');
  sheet.innerHTML = '';
  questionData.forEach((_, i) => {
    const answer = getAnswerValue(i);
    const div = document.createElement('div');
    div.className = `p-2 rounded text-center cursor-pointer ${answer ? 'bg-green-100' : 'bg-gray-100'}`;
    div.innerText = `Câu ${i + 1}: ${answer || '-'}`;
    div.onclick = () => qs(`#q${i}`).scrollIntoView({ behavior: 'smooth' });
    sheet.appendChild(div);
  });
  typeset(sheet);
  updateReviewList();
}

function updateReviewList() {
  const reviewList = qs('#review-list');
  reviewList.innerHTML = '';
  const flagged = JSON.parse(localStorage.getItem(nsKey('flaggedQuestions')) || '[]');
  flagged.forEach(i => {
    const li = document.createElement('li');
    li.innerHTML = `Câu ${i + 1}`;
    li.className = 'cursor-pointer hover:underline';
    li.onclick = () => qs(`#q${i}`).scrollIntoView({ behavior: 'smooth' });
    reviewList.appendChild(li);
  });
  typeset(reviewList);
}

function toggleReview(index) {
  const flagged = JSON.parse(localStorage.getItem(nsKey('flaggedQuestions')) || '[]');
  if (flagged.includes(index)) {
    flagged.splice(flagged.indexOf(index), 1);
  } else {
    flagged.push(index);
  }
  localStorage.setItem(nsKey('flaggedQuestions'), JSON.stringify(flagged));
  updateReviewList();
}

function restoreAnswers() {
  const saved = JSON.parse(localStorage.getItem(nsKey('savedAnswers')) || '{}');
  for (const [key, value] of Object.entries(saved)) {
    const idx = Number(key.replace('q', ''));
    const q = questionData[idx] || {};
    if ((q.kieu_cau_hoi || '').toLowerCase() === 'tu_luan') {
      const ta = qs(`#${key}`);
      if (ta) ta.value = value;
    } else {
      const radio = qs(`#${key}_${value}`);
      if (radio) radio.checked = true;
    }
  }
  renderAnswerSheet();
}

function clearTempStorage() {
  localStorage.removeItem(nsKey('savedAnswers'));
  localStorage.removeItem(nsKey('savedTime'));
  localStorage.removeItem(nsKey('flaggedQuestions'));
}






async function gradeEssayWithAPI(selected, q) {
  const daChonText = selected?.trim() || '';
  const goiY = q.goi_y_dap_an?.trim() || '';
  if (!daChonText || !goiY) return 0;

  // 🔹 Lấy CSRF token từ <meta> trong <head>
  const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

  try {
    const res = await fetch(`${API_BASE}/api/grade_essay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': csrfToken  // gửi token CSRF
      },
      body: JSON.stringify({ answer: daChonText, reference: goiY })
    });
    const data = await res.json();
    return data.score ?? 0;
  } catch (e) {
    console.error('Lỗi gọi API chấm tự luận:', e);
    return 0;
  }
}



qs('#btn-submit')?.addEventListener('click', () => submitExam(false));

async function submitExam(autoByTime) {
  // --- Bảng điểm theo loại câu hỏi ---
  const scoreTable = {
    trac_nghiem: 0.25,                 // trắc nghiệm 1 lựa chọn
    trac_nghiem_nhieu: 0.25,           // trắc nghiệm nhiều lựa chọn
    dung_sai: 0.25,                  // đúng/sai
    dung_sai_nhieu_lua_chon: 1,     // đúng/sai nhiều lựa chọn
    tu_luan: 1                       // tự luận
  };
// --- Nếu server có trọng số riêng cho mã đề, tải trước khi chấm ---
try {
  const res = await fetch(`/api/get_score_weights?made=${qs('#made').value}`);
  const data = await res.json();
  if (data.status === "success" && data.weights) {
    Object.assign(scoreTable, data.weights); // cập nhật trọng số
    console.log("📊 Đã tải trọng số từ server:", scoreTable);
  } else {
    console.log("⚠️ Không tìm thấy trọng số trên server, dùng mặc định");
  }
} catch (err) {
  console.warn("⚠️ Lỗi khi tải trọng số, dùng mặc định", err);
}

  async function gradeEssayWithAPI(studentAnswer, question) {
    try {
      const res = await fetch(`${API_BASE}/api/grade_essay_advanced`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": csrf()
        },
        body: JSON.stringify({
          answers: [{
            question: question.noi_dung || "",
            answer: studentAnswer || "",
            correct_answer: question.goi_y_dap_an || ""
          }]
        })
      });
      const data = await res.json();
      if (data && data.status === "success" && Array.isArray(data.graded) && data.graded.length) {
        return data.graded[0];
      }
      if (data && typeof data.score === "number") return { score: data.score };
      return { score: 0 };
    } catch (err) {
      console.error("Lỗi gọi API chấm tự luận:", err);
      return { score: 0 };
    }
  }

  clearInterval(timer);

  const name = qs('#hoten').value.trim();
  const made = qs('#made').value;
  currentMade = made;
  const sbd = qs('#sbd').value.trim();
  const dob = qs('#ngaysinh').value;

  function readStudentAnswer(q, i) {
    const kieu = (q.kieu_cau_hoi || 'trac_nghiem').toLowerCase();

    if (kieu === 'tu_luan') {
      const ta = qs(`#q${i}`);
      return ta ? ta.value.trim() : '';
    }

    if (kieu === 'dung_sai_nhieu_lua_chon') {
      const res = {};
      for (const key of Object.keys(q.lua_chon || {})) {
        const el = qs(`input[name="q${i}_${key}"]:checked`);
        res[key] = el ? el.value : '';
      }
      return res;
    }

    if (kieu === 'trac_nghiem_nhieu' || kieu === 'nhieu_lua_chon' || kieu === 'trac_nghiem_nhieu_lua_chon') {
      return qsa(`input[name="q${i}"]:checked`).map(n => n.value);
    }

    const sel = qs(`input[name="q${i}"]:checked`);
    return sel ? sel.value : '';
  }

  let unanswered = 0;
  questionData.forEach((q, i) => {
    const ans = readStudentAnswer(q, i);
    const kieu = (q.kieu_cau_hoi || 'trac_nghiem').toLowerCase();
    let empty = false;
    if (kieu === 'tu_luan') empty = !String(ans).trim();
    else if (kieu === 'dung_sai_nhieu_lua_chon') {
      empty = Object.keys(q.lua_chon || {}).some(k => !(ans && ans[k]));
    } else if (Array.isArray(ans)) {
      empty = ans.length === 0;
    } else {
      empty = !ans;
    }
    if (empty) unanswered++;
  });

  if (!autoByTime && unanswered > 0) {
    if (!confirm(`Bạn còn ${unanswered} câu chưa trả lời. Bạn có chắc muốn nộp bài không?`)) {
      timer = setInterval(updateCountdown, 1000);
      return;
    }
  }

  const answers = [];
  let scoreTracNghiem1 = 0;
  let scoreDungSai = 0;
  let scoreTuLuan = 0;

  for (let i = 0; i < questionData.length; i++) {
    const q = questionData[i];
    const kieu = (q.kieu_cau_hoi || 'trac_nghiem').toLowerCase();
    const student = readStudentAnswer(q, i);
    const correctKeyRaw = q.dap_an_dung ?? '';
    let selectedContent = '';
    let correctContent = '';
    let isCorrect = false;
    let matchScore = 0;

    const weight = scoreTable[kieu] || 0; // Trọng số câu hỏi

    // --- Trắc nghiệm 1 lựa chọn ---
    if (kieu === 'trac_nghiem') {
      const sel = student || '';
      const selLetter = String(sel).trim().toUpperCase();
      const corr = String(correctKeyRaw || '').trim().toUpperCase();
      selectedContent = sel ? `${selLetter}${q.lua_chon && q.lua_chon[sel] ? `. ${q.lua_chon[sel]}` : ''}` : '(chưa chọn)';
      correctContent = corr ? `${corr}${q.lua_chon && q.lua_chon[corr.toLowerCase()] ? `. ${q.lua_chon[corr.toLowerCase()]}` : ''}` : '';
      if (sel && corr && selLetter === corr) {
        isCorrect = true;
        matchScore = weight;
        scoreTracNghiem1 += weight;
      }
    } 
    // --- Trắc nghiệm nhiều lựa chọn ---
    else if (kieu === 'trac_nghiem_nhieu' || kieu === 'nhieu_lua_chon' || kieu === 'trac_nghiem_nhieu_lua_chon') {
      const selArr = Array.isArray(student) ? student.map(s => String(s).trim().toUpperCase()).filter(Boolean) : [];
      const corrArr = String(correctKeyRaw || '').split(/[,; ]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      const perChoiceScore = corrArr.length ? weight / corrArr.length : 0;
      let scoreThisQuestion = 0;
      selArr.forEach(a => { if (corrArr.includes(a)) scoreThisQuestion += perChoiceScore; });
      matchScore = scoreThisQuestion;
      scoreTracNghiem1 += scoreThisQuestion;
      selectedContent = selArr.length ? selArr.map(a => `${a}${q.lua_chon && q.lua_chon[a.toLowerCase()] ? `. ${q.lua_chon[a.toLowerCase()]}` : ''}`).join(', ') : '(chưa chọn)';
      correctContent = corrArr.length ? corrArr.map(a => `${a}${q.lua_chon && q.lua_chon[a.toLowerCase()] ? `. ${q.lua_chon[a.toLowerCase()]}` : ''}`).join(', ') : '';
      isCorrect = scoreThisQuestion === weight && corrArr.length === selArr.length && selArr.every(x => corrArr.includes(x));
    } 
    // --- Đúng/Sai ---
    else if (kieu === 'dung_sai') {
      const sel = student || '';
      let daChonNorm = (!sel ? '' : ['A','ĐÚNG','DUNG'].includes(sel.toUpperCase()) ? 'Đúng' : 'Sai');
      let dapAnDungNorm = (!correctKeyRaw ? '' : ['A','ĐÚNG','DUNG'].includes(correctKeyRaw.toUpperCase()) ? 'Đúng' : 'Sai');
      selectedContent = daChonNorm || '(chưa chọn)';
      correctContent = dapAnDungNorm || '';
      if (daChonNorm && dapAnDungNorm && daChonNorm === dapAnDungNorm) {
        isCorrect = true;
        matchScore = weight;
        scoreDungSai += weight;
      }
    } 
    // --- Đúng/Sai nhiều lựa chọn ---
    else if (kieu === 'dung_sai_nhieu_lua_chon') {
      const studentObj = student || {};
      let correctObj = {};
      try {
        if (typeof q.dap_an_dung === "string" && q.dap_an_dung.trim().startsWith("{")) correctObj = JSON.parse(q.dap_an_dung);
        else if (typeof q.dap_an_dung === "object" && q.dap_an_dung !== null) correctObj = q.dap_an_dung;
      } catch (e) { correctObj = {}; }

      const keys = Object.keys(q.lua_chon || {});
      const perItemScore = keys.length ? weight / keys.length : 0;
      let scoreThisQuestion = 0;
      const displayStudent = [];
      const displayCorrectArr = [];

      for (const key of keys) {
        const st = (studentObj[key] || '').trim();
        let corrRaw = (correctObj[key] || '').trim();
        let corr = ['A','ĐÚNG','DUNG'].includes(corrRaw.toUpperCase()) ? 'Đúng' : (['B','SAI'].includes(corrRaw.toUpperCase()) ? 'Sai' : corrRaw);
        let stNorm = ['A','ĐÚNG','DUNG'].includes(st.toUpperCase()) ? 'Đúng' : (['B','SAI'].includes(st.toUpperCase()) ? 'Sai' : st);
        const ok = stNorm === corr;
        displayStudent.push(st ? `${key}: ${stNorm} ${ok ? '✅' : '❌'}` : `${key}: (chưa chọn) ❌`);
        if (ok) scoreThisQuestion += perItemScore;
        displayCorrectArr.push(`${key}: ${corr || '(không có)'}`);
      }

      matchScore = scoreThisQuestion;
      scoreDungSai += scoreThisQuestion;
      selectedContent = displayStudent.join(', ');
      correctContent = displayCorrectArr.join(', ');
      isCorrect = scoreThisQuestion === weight;
    }
    // --- Tự luận ---
    else if (kieu === 'tu_luan') {
      const studentText = student || '';
      const result = await gradeEssayWithAPI(studentText, q);
      const rscore = (result && typeof result === 'object') ? (result.score || 0) : (Number(result) || 0);
      matchScore = rscore * weight; // Nhân trọng số
      scoreTuLuan += matchScore;
      selectedContent = studentText || '(chưa trả lời)';
      correctContent = q.goi_y_dap_an || '';
      isCorrect = matchScore > 0;
    }

    answers.push({
      cau: i + 1,
      noi_dung: q.noi_dung || '',
      da_chon: selectedContent,
      dap_an_dung: correctContent,
      dung: isCorrect,
      diem: Number(matchScore) || 0,
      kieu,
      goi_y_dap_an: q.goi_y_dap_an || ''
    });
  }
const totalScore = scoreTracNghiem1 + scoreDungSai + scoreTuLuan;
  const finalScore = Math.min(totalScore, 10).toFixed(2);
  clearTempStorage();

  const now = new Date();
  const formattedDate = now.toLocaleString('vi-VN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

  // --- HIỂN THỊ KẾT QUẢ ---
  let fileContent = `
    <div><strong>KẾT QUẢ BÀI THI</strong></div>
    <div><strong>Họ tên:</strong> ${safeHTML(name)}</div>
    <div><strong>SBD:</strong> ${safeHTML(sbd)}</div>
    <div><strong>Ngày sinh:</strong> ${safeHTML(dob)}</div>
    <div><strong>Mã đề:</strong> ${safeHTML(made)}</div>
    <div>Điểm Trắc nghiệm 1 lựa chọn: ${scoreTracNghiem1.toFixed(2)}</div>
    <div>Điểm Đúng/Sai: ${scoreDungSai.toFixed(2)}</div>
    <div>Điểm Tự luận: ${scoreTuLuan.toFixed(2)}</div>
    <div><strong style="color:red;">Tổng điểm: ${finalScore}/10</strong></div>
    <div>Nộp lúc: ${safeHTML(formattedDate)}</div><br>
  `;

  answers.forEach(ans => {
    const color = ans.dung ? 'green' : 'red';
    const symbol = ans.dung ? '✅' : '❌';
    const diemText = (typeof ans.diem === 'number') ? ` (${ans.diem.toFixed(2)} điểm)` : '';
    fileContent += `<div style="margin-bottom: .75rem; border-bottom: 1px solid #eee; padding-bottom: .5rem;">`;
    fileContent += `<div><strong>Câu ${ans.cau}:</strong> ${safeHTML(ans.noi_dung)}</div>`;

    if (['trac_nghiem','trac_nghiem_nhieu','trac_nghiem_nhieu_lua_chon','nhieu_lua_chon'].includes(ans.kieu)) {
      fileContent += `<div>Bạn chọn: <span style="color:${color}; font-weight:bold;">${safeHTML(ans.da_chon || '-')}</span></div>`;
      if (ans.dap_an_dung) fileContent += `<div>Đáp án đúng: ${safeHTML(ans.dap_an_dung)}</div>`;
      fileContent += `<div><strong style="color:${color};">${symbol}${diemText}</strong></div>`;
    } else if (['dung_sai','dung_sai_nhieu_lua_chon'].includes(ans.kieu)) {
      fileContent += `<div><strong>Bạn chọn:</strong> ${safeHTML(ans.da_chon || '-')}</div>`;
      if (ans.dap_an_dung) fileContent += `<div><strong>Đáp án đúng:</strong> ${safeHTML(ans.dap_an_dung)}</div>`;
      fileContent += `<div><strong style="color:${color};">${symbol}${diemText}</strong></div>`;
    } else if (ans.kieu === 'tu_luan') {
      fileContent += `<div><strong>Bạn trả lời:</strong><div style="margin-left:1rem;">${safeHTML(ans.da_chon)}</div></div>`;
      if (ans.goi_y_dap_an) fileContent += `<div><strong>Gợi ý đáp án:</strong><div style="margin-left:1rem;">${safeHTML(ans.goi_y_dap_an)}</div></div>`;
      fileContent += `<div><strong>Điểm:</strong> ${ans.diem.toFixed(2)} ${symbol}</div>`;
    }

    fileContent += `</div>`;
  });

  const resultDiv = qs('#result-container');
  resultDiv.classList.remove('hidden');
  resultDiv.innerHTML = `
    <h1 class="text-2xl font-bold text-green-600 mb-4">✅ KẾT QUẢ BÀI THI</h1>
    <p class="text-sm text-gray-500 mb-4">🕒 Nộp lúc: ${safeHTML(formattedDate)}</p>
    <div id="result-html" class="result-scrollable">${fileContent}</div>
    <div class="flex gap-4 mt-4">
      <button id="btn-download-doc" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">⬇️ Tải kết quả .DOC</button>
      <button id="btn-download-pdf" class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">⬇️ Tải kết quả .PDF</button>
    </div>
  `;

  qs('#exam-container').classList.add('hidden');
  typeset(resultDiv);

  qs('#btn-download-doc')?.addEventListener('click', () => downloadDOC(name, made));
  qs('#btn-download-pdf')?.addEventListener('click', () => downloadPDF(name, made, answers, finalScore, formattedDate));

  try {
    await fetch(`${API_BASE}/save_result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
      body: JSON.stringify({ hoten: name, sbd, ngaysinh: dob, made, diem: finalScore, answers })
    });
  } catch (err) {
    console.error('Lỗi lưu backend:', err);
  }
}


function downloadDOC(name, made) {
  const container = qs('#result-html');
  const header = `<!DOCTYPE html><html><head><meta charset='utf-8'><title>Kết quả</title><script src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-chtml.js"></script></head><body>`;
  const footer = '</body></html>';
  const blob = new Blob(['\ufeff', header + container.innerHTML + footer], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `KQ_${(name || '').replace(/\s+/g, '_')}_${made}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}


function downloadPDF(name, made, answers, finalScore, formattedDate) {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    let y = 40;
    const margin = 40;
    const pageHeight = doc.internal.pageSize.height;
    const maxWidth = 500;

    function addText(text, x, y, options = {}) {
      if (y > pageHeight - margin) {
        doc.addPage();
        y = 40;
      }
      doc.text(text, x, y, options);
      return y + (options.lineHeight || 20);
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    y = addText('KẾT QUẢ BÀI THI', margin, y);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    y = addText(`Họ tên: ${name}`, margin, y);
    y = addText(`SBD: ${qs('#sbd').value}`, margin, y);
    y = addText(`Ngày sinh: ${qs('#ngaysinh').value}`, margin, y);
    y = addText(`Mã đề: ${made}`, margin, y);
    y = addText(`Điểm: ${finalScore}/10`, margin, y);
    y = addText(`Nộp lúc: ${formattedDate}`, margin, y);
    y += 10;

    answers.forEach(ans => {
      const cleanContent = ans.noi_dung.replace(/\\\(.*?\\\)/g, match => match.slice(2, -2));
      const cleanSelected = ans.da_chon.replace(/\\\(.*?\\\)/g, match => match.slice(2, -2));
      const cleanCorrect = ans.dap_an_dung.replace(/\\\(.*?\\\)/g, match => match.slice(2, -2));
      const cleanHint = ans.goi_y_dap_an.replace(/\\\(.*?\\\)/g, match => match.slice(2, -2));
      y = addText(`Câu ${ans.cau}: ${cleanContent}`, margin, y, { maxWidth });
      y = addText(`Bạn chọn: ${cleanSelected}${ans.kieu === 'trac_nghiem' ? (ans.dung ? ' - ĐÚNG' : ' - SAI') : ''}`, margin, y, { maxWidth });
      if (ans.kieu === 'trac_nghiem' && ans.dap_an_dung) {
        y = addText(`Đáp án đúng: ${cleanCorrect}`, margin, y, { maxWidth });
      }
      if (ans.goi_y_dap_an) {
        y = addText(`Gợi ý đáp án: ${cleanHint}`, margin, y, { maxWidth });
      }
      y += 10;
    });

    doc.save(`KQ_${(name || '').replace(/\s+/g, '_')}_${made}.pdf`);
  } catch (err) {
    console.error('Lỗi tạo PDF:', err);
    alert('Không thể tạo tệp PDF. Vui lòng thử lại hoặc kiểm tra console để biết chi tiết!');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  startQrScanner();
});

























