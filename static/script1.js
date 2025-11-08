const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://127.0.0.1:5000' : 'https://xuka.com.vn';
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
    MathJax.typesetPromise([el]).catch(err => {
      console.error('MathJax Error:', err);
      const errorDiv = document.createElement('div');
      errorDiv.className = 'text-red-600';
      errorDiv.textContent = 'Lỗi hiển thị công thức toán học. Vui lòng kiểm tra kết nối hoặc thử lại!';
      el.appendChild(errorDiv);
    });
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
    const qrError = qs('#qr-error');
    if (qrError) {
      qrError.textContent = 'Vui lòng cấp quyền camera trong cài đặt trình duyệt!';
      qrError.classList.remove('hidden');
    } else {
      console.error('[ERROR] Không tìm thấy #qr-error để hiển thị lỗi camera');
    }
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
  if (!readerElem) {
    console.error('[ERROR] Không tìm thấy #reader');
    return;
  }
  await ensureScanner();
  const hasPerm = await checkCameraPermission();
  if (!hasPerm) return;

  try {
    const list = await Html5Qrcode.getCameras();
    devices = list || [];
    if (devices.length === 0) {
      const qrError = qs('#qr-error');
      if (qrError) {
        qrError.textContent = 'Không tìm thấy camera trên thiết bị!';
        qrError.classList.remove('hidden');
      } else {
        console.error('[ERROR] Không tìm thấy #qr-error để hiển thị lỗi camera');
      }
      return;
    }
    const camId = devices[camIndex]?.id || { facingMode: 'environment' };
    await html5QrCode.start(camId, { fps: 10, qrbox: { width: 250, height: 250 } }, async (decodedText) => {
      console.log('Mã QR được giải mã:', decodedText);
      await stopScanner();
      await verifyAndLogin(decodedText);
    }, () => {});
  } catch (err) {
    const qrError = qs('#qr-error');
    if (qrError) {
      qrError.textContent = `Lỗi camera: ${err?.message || err}`;
      qrError.classList.remove('hidden');
    } else {
      console.error('[ERROR] Không tìm thấy #qr-error để hiển thị lỗi camera:', err);
    }
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
    const qrError = qs('#qr-error');
    if (qrError) {
      qrError.textContent = 'Không thể đổi camera!';
      qrError.classList.remove('hidden');
    } else {
      console.error('[ERROR] Không tìm thấy #qr-error để hiển thị lỗi đổi camera');
    }
  }
});

const qrFileInput = qs('#qr-file');
qs('#upload-qr')?.addEventListener('click', () => {
  const qrError = qs('#qr-error');
  if (qrError) {
    qrError.classList.add('hidden');
  }
  qrFileInput?.click();
});

qrFileInput?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) {
    const qrError = qs('#qr-error');
    if (qrError) {
      qrError.textContent = 'Không có tệp nào được chọn!';
      qrError.classList.remove('hidden');
    } else {
      console.error('[ERROR] Không tìm thấy #qr-error để hiển thị lỗi không chọn tệp');
    }
    return;
  }
  if (!file.type.startsWith('image/')) {
    const qrError = qs('#qr-error');
    if (qrError) {
      qrError.textContent = 'Vui lòng chọn một tệp hình ảnh!';
      qrError.classList.remove('hidden');
    } else {
      console.error('[ERROR] Không tìm thấy #qr-error để hiển thị lỗi định dạng tệp');
    }
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
    const qrError = qs('#qr-error');
    if (qrError) {
      qrError.textContent = `Không thể đọc mã QR từ ảnh: ${err.message || err}`;
      qrError.classList.remove('hidden');
    } else {
      console.error('[ERROR] Không tìm thấy #qr-error để hiển thị lỗi đọc mã QR:', err);
    }
  } finally {
    qrFileInput.value = '';
  }
});

async function verifyAndLogin(qrText) {
  const qrError = qs('#qr-error');
  if (qrError) {
    qrError.classList.add('hidden');
  }
  if (!qrText) {
    if (qrError) {
      qrError.textContent = 'Mã QR rỗng!';
      qrError.classList.remove('hidden');
    } else {
      console.error('[ERROR] Không tìm thấy #qr-error để hiển thị lỗi mã QR rỗng');
    }
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
      const leftColumn = qs('#left-column');
      const rightColumn = qs('#right-column');
      const buttonGroup = qs('#button-group');
      const qrLogin = qs('#qr-login');
      const accountLogin = qs('#account-login');
      
      if (leftColumn) {
        leftColumn.classList.add('hidden');
        console.log('[DEBUG] Đã thêm lớp hidden cho #left-column');
      } else {
        console.error('[ERROR] Không tìm thấy #left-column');
      }
      if (rightColumn) {
        rightColumn.classList.add('hidden');
        console.log('[DEBUG] Đã thêm lớp hidden cho #right-column');
      } else {
        console.error('[ERROR] Không tìm thấy #right-column');
      }
      if (buttonGroup) {
        buttonGroup.classList.add('hidden');
      } else {
        console.error('[ERROR] Không tìm thấy #button-group');
      }
      if (qrLogin) {
        qrLogin.classList.add('hidden');
      } else {
        console.error('[ERROR] Không tìm thấy #qr-login');
      }
      if (accountLogin) {
        accountLogin.classList.remove('hidden');
        accountLogin.scrollIntoView({ behavior: 'smooth' });
      } else {
        console.error('[ERROR] Không tìm thấy #account-login');
      }
    } else {
      throw new Error(data.msg || 'Mã QR không hợp lệ!');
    }
  } catch (err) {
    console.error('Lỗi verifyAndLogin:', err);
    if (qrError) {
      qrError.textContent = err.message || 'Lỗi kết nối máy chủ!';
      qrError.classList.remove('hidden');
    } else {
      console.error('[ERROR] Không tìm thấy #qr-error để hiển thị lỗi verifyAndLogin:', err);
    }
  }
}

qs('#account-login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = qs('#username')?.value.trim();
  const password = qs('#password')?.value;
  const loginError = qs('#login-error');
  if (!username || !password) {
    if (loginError) {
      loginError.textContent = 'Vui lòng nhập đầy đủ tài khoản và mật khẩu!';
      loginError.classList.remove('hidden');
    } else {
      console.error('[ERROR] Không tìm thấy #login-error để hiển thị lỗi đăng nhập');
    }
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
      const accountLogin = qs('#account-login');
      const loginForm = qs('#login-form');
      if (accountLogin) {
        accountLogin.classList.add('hidden');
      } else {
        console.error('[ERROR] Không tìm thấy #account-login');
      }
      if (loginForm) {
        loginForm.classList.remove('hidden');
        loginForm.scrollIntoView({ behavior: 'smooth' });
      } else {
        console.error('[ERROR] Không tìm thấy #login-form');
      }
      loadExamCodes();
    } else {
      throw new Error(data?.message || 'Sai tài khoản hoặc mật khẩu!');
    }
  } catch (err) {
    if (loginError) {
      loginError.textContent = err.message;
      loginError.classList.remove('hidden');
    } else {
      console.error('[ERROR] Không tìm thấy #login-error để hiển thị lỗi đăng nhập:', err);
    }
  }
});

async function loadExamCodes() {
  const select = qs('#made');
  if (!select) {
    console.error('[ERROR] Không tìm thấy #made');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/get_exam_codes`, { headers: { 'Accept': 'application/json', 'X-CSRFToken': csrf() } });
    const data = await res.json();
    const codes = Array.isArray(data) ? data : (data.codes || []);
    select.innerHTML = '<option value="">-- Chọn mã đề --</option>' + codes.map(c => `<option value="${c}">${c}</option>`).join('');
  } catch (err) {
    const p = document.createElement('p');
    p.className = 'text-red-600 mt-2 font-semibold';
    p.textContent = 'Không thể tải danh sách mã đề. Vui lòng thử lại!';
    select.parentElement.appendChild(p);
    console.error('[ERROR] Lỗi tải mã đề:', err);
  }
}




qs('#btn-start-exam')?.addEventListener('click', startExam);

async function startExam() {
  const name = qs('#hoten')?.value.trim();
  const sbd = qs('#sbd')?.value.trim();
  const dob = qs('#ngaysinh')?.value;
  const made = qs('#made')?.value;

  if (!name || !sbd || !dob || !made) {
    alert('Vui lòng nhập đầy đủ Họ tên, SBD, Ngày sinh và Mã đề!');
    return;
  }

  currentMade = made;

  const loginForm = qs('#login-form');
  const examContainer = qs('#exam-container');
  const formError = qs('#form-error');

  if (loginForm) loginForm.classList.add('hidden');
  if (examContainer) examContainer.classList.remove('hidden');

  // --- Thiết lập thời gian làm bài ---
  try {
    const res = await fetch(`${API_BASE}/exam_session?made=${encodeURIComponent(made)}`, {
      headers: { 'Accept': 'application/json', 'X-CSRFToken': csrf() }
    });
    const data = await res.json();
    const duration = Number(data?.duration_sec || 3600);
    examDeadline = data?.deadline ? Number(data.deadline) : Date.now() + duration * 1000;
  } catch (err) {
    console.error('[ERROR] Lỗi lấy thời gian làm bài:', err);
    examDeadline = Date.now() + 3600 * 1000;
  }

  updateCountdown();
  timer = setInterval(updateCountdown, 1000);

  // --- Hàm load câu hỏi ---
  async function loadQuestionsFrom(url) {
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Dữ liệu câu hỏi không phải mảng');

      // Xử lý câu hỏi: hiển thị công thức và giữ dap_an_dung gốc
      questionData = data.map((q, i) => {
        // giữ dap_an_dung gốc
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

        // Xử lý hiển thị công thức
        let fixed = processAllQuestions([q])[0];
        fixed.dap_an_dung = original.dap_an_dung; // gắn lại đáp án gốc
        fixed.cau = i + 1;

        return fixed;
      });

      renderQuestions(questionData);
      restoreAnswers();
      renderAnswerSheet(); // hiển thị đáp án đúng/sai
      updateProgress();

      // Render LaTeX nếu có
      if (window.MathJax) MathJax.typeset();

      return true;
    } catch (err) {
      console.error('[ERROR] Lỗi tải câu hỏi từ', url, err);
      if (formError) {
        formError.textContent = `Không thể tải câu hỏi từ ${url}: ${err.message}`;
        formError.classList.remove('hidden');
      } else {
        alert(`Không thể tải câu hỏi từ ${url}: ${err.message}`);
      }
      return false;
    }
  }

  const apiUrl = `${API_BASE}/get_questions?made=${encodeURIComponent(made)}`;
  const localUrl = `/questions/questions${made}.json`;

  if (!(await loadQuestionsFrom(apiUrl))) {
    await loadQuestionsFrom(localUrl);
  }
}






function updateCountdown() {
  const now = Date.now();
  const remainMs = Math.max(0, (examDeadline || now) - now);
  const remain = Math.floor(remainMs / 1000);
  const m = String(Math.floor(remain / 60)).padStart(2, '0');
  const s = String(remain % 60).padStart(2, '0');
  const countdown = qs('#countdown');
  if (countdown) {
    countdown.innerText = `Thời gian: ${m}:${s}`;
  } else {
    console.error('[ERROR] Không tìm thấy #countdown');
  }
  localStorage.setItem(nsKey('savedTime'), remain);
  if (remain <= 0) {
    clearInterval(timer);
    submitExam(true);
  }
}

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
  s = s.replace(/< \/ span>/g, ""); // Remove malformed < / span> tags
  s = s.replace(/π/g, "\\pi");
  
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
  s = s.replace(/([A-Za-z0-9π)])\^\(([^)]+)\)/g, (_, base, sup) => `${base}^{${sup}}`);
  s = s.replace(/([A-Za-z0-9π)\]])\^(\d+)/g, (_, base, sup) => `${base}^{${sup}}`);
  s = s.replace(/([.,;:!?])([^\s])/g, "$1 $2");
  s = s.replace(/\s{2,}/g, " ");
  const subMap = { '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9' };
  const supMap = { '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9' };
  s = s.replace(/[\u2080-\u2089]/g, m => `_{${subMap[m] || m}}`);
  s = s.replace(/[\u2070-\u2079]/g, m => `^{${supMap[m] || m}}`);

  

 
  
  return s;
}

function wrapMath(expr) {
  if (!expr) return "";
  expr = expr.trim();
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
  s = s.replace(/\b((?:\\(?:pi|sqrt|log|ln|sum|int|frac)\{[^}]*\}|[A-Za-z0-9]+|[0-9]+))\/((?:\\(?:pi|sqrt|log|ln|sum|int|frac)\{[^}]*\}|[A-Za-z0-9]+|[0-9]+))\b/g,
    (_, a, b) => `\\frac{${a.trim()}}{${b.trim()}}`);
  s = s.replace(/sqrt\[(\d+)\]\(([^)]+)\)/gi, (_, n, val) => `\\sqrt[${n}]{${val.trim()}}`);
  s = s.replace(/sqrt\(([^)]+)\)/gi, (_, val) => `\\sqrt{${val.trim()}}`);
  s = s.replace(/([A-Za-z])_(\d+)/g, (_, base, sub) => `${base}_{${sub}}`);
  s = s.replace(/([A-Za-z0-9])\^(\d+)/g, (_, base, sup) => `${base}^{${sup}}`);
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

    // ===== Hàm phụ hiển thị chú thích =====
    function appendHint(hintText) {
      if (!hintText || hintText.trim() === '') return;
      const hintBox = document.createElement('div');
      hintBox.className = 'mt-3 p-2 border border-yellow-200 bg-yellow-50 rounded text-sm text-gray-700';

      const imgWidth = q.chu_thich_img_width || '300px';
      const imgHeight = q.chu_thich_img_height || 'auto';

      // Tách chuỗi theo khoảng trắng
      const parts = hintText.trim().split(/\s+/);
      parts.forEach(part => {
        if (/\.(jpg|jpeg|png|gif|webp)$/i.test(part)) {
          const imgWrapper = document.createElement('div');
          imgWrapper.style.textAlign = 'center';
          imgWrapper.className = 'my-2';
          const img = document.createElement('img');
          img.src = part;
          img.alt = 'Chú thích hình ảnh';
          img.style.maxWidth = imgWidth;
          img.style.height = imgHeight;
          img.className = 'rounded-md shadow-sm';
          imgWrapper.appendChild(img);
          hintBox.appendChild(imgWrapper);
        } else {
          const span = document.createElement('span');
          if (hintBox.childNodes.length > 0) span.appendChild(document.createElement('br'));
          span.textContent = part + ' ';
          hintBox.appendChild(span);
        }
      });

      div.appendChild(hintBox);
    }

    // ===== TỰ LUẬN =====
    if (type === 'tu_luan') {
      const ta = document.createElement('textarea');
      ta.id = `q${i}`;
      ta.rows = 4;
      ta.placeholder = 'Nhập câu trả lời...';
      ta.className = 'border p-2 w-full rounded-md';
      div.appendChild(ta);

      appendHint(q.chu_thich);
    }

    // ===== TRẮC NGHIỆM 1 LỰA CHỌN =====
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
      appendHint(q.chu_thich);
    }

    // ===== ĐÚNG/SAI NHIỀU LỰA CHỌN =====
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

      appendHint(q.chu_thich);
    }

    container.appendChild(div);
  });



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
  if (!sheet) return; // kiểm tra tồn tại

  sheet.innerHTML = '';

  questionData.forEach((_, i) => {
    const answer = getAnswerValue(i);
    const div = document.createElement('div');
    div.className = `p-2 rounded text-center cursor-pointer ${answer ? 'bg-green-100' : 'bg-gray-100'}`;
    div.innerText = `Câu ${i + 1}: ${answer || '-'}`;

    div.onclick = () => {
      const qEl = qs(`#q${i}`);
      if (qEl) qEl.scrollIntoView({ behavior: 'smooth' });
    };

    sheet.appendChild(div);
  });

  typeset?.(sheet); // typeset MathJax nếu có
  updateReviewList();
}

function updateReviewList() {
  const reviewList = qs('#review-list');
  if (!reviewList) return; // kiểm tra tồn tại

  reviewList.innerHTML = '';

  const flagged = JSON.parse(localStorage.getItem(nsKey('flaggedQuestions')) || '[]');
  flagged.forEach(i => {
    const li = document.createElement('li');
    li.className = 'cursor-pointer hover:underline';
    li.innerText = `Câu ${i + 1}`;
    li.onclick = () => {
      const qEl = qs(`#q${i}`);
      if (qEl) qEl.scrollIntoView({ behavior: 'smooth' });
    };
    reviewList.appendChild(li);
  });

  typeset?.(reviewList);
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
  // Xóa tất cả key localStorage có tiền tố 'xuka_{made}_{sbd}_'
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith(`xuka_${currentMade || ''}_${currentStudentId || ''}_`)) {
      localStorage.removeItem(k);
    }
  });
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

async function submitExam(autoByTime = false) {
  clearInterval(timer);

  // --- Thông tin học sinh ---
  const name = qs('#hoten').value.trim();
  const made = qs('#made').value;
  currentMade = made;
  const sbd = qs('#sbd').value.trim();
  const dob = qs('#ngaysinh').value;

  // --- LẤY TRỌNG SỐ TỰ LUẬN ---
  function layTrongSoTuLuan() {
    const tuLuan = {};
    document.querySelectorAll(".tu-luan-row").forEach(row => {
      const cau = row.querySelector(".question-number")?.value?.trim();
      const diem = row.querySelector(".score-input")?.value?.trim();
      if (cau && diem) tuLuan[cau] = parseFloat(diem);
    });
    console.log("TRỌNG SỐ TỰ LUẬN:", tuLuan);
    return tuLuan;
  }

  // --- Khởi tạo + CHỜ LẤY TU_LUAN ---
  let scoreTable = {
    trac_nghiem: 0.25,
    trac_nghiem_nhieu: 0.25,
    dung_sai: 0.25,
    dung_sai_nhieu_lua_chon: 1,
    tu_luan: layTrongSoTuLuan()
  };
  console.log("✅ Bảng trọng số mặc định:", scoreTable);

  // --- TẢI TRỌNG SỐ TỪ SERVER ---
  async function taiVaDongBoTrongSo(made) {
    try {
      const res = await fetch(`/api/get_score_weights?made=${made}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.status === "success" && data.weights) {
        const w = data.weights;
        ['trac_nghiem','trac_nghiem_nhieu','dung_sai','dung_sai_nhieu_lua_chon'].forEach(k => {
          if (w[k] !== undefined) scoreTable[k] = parseFloat(w[k]) || w[k];
        });
        if (w.tu_luan && typeof w.tu_luan === 'object') {
          Object.entries(w.tu_luan).forEach(([k, v]) => {
            const num = String(k).replace(/^cau[_]?/i, '');
            if (num && !isNaN(num)) {
              scoreTable.tu_luan[num] = parseFloat(v) || 1;
            }
          });
        }
        console.log("✅ Trọng số sau đồng bộ (tu_luan):", scoreTable.tu_luan);
      }
    } catch (e) {
      console.warn("⚠️ Lỗi tải trọng số:", e);
    }
  }
  await taiVaDongBoTrongSo(made);

  // --- API CHẤM TỰ LUẬN ---
  async function gradeEssayWithAPI(studentAnswer, question) {
    try {
      const res = await fetch(`${API_BASE}/api/grade_essay_advanced`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
        body: JSON.stringify({
          answers: [{ question: question.noi_dung || "", answer: studentAnswer || "", correct_answer: question.goi_y_dap_an || "" }]
        })
      });
      const data = await res.json();
      if (data?.status === "success" && Array.isArray(data.graded) && data.graded.length) return data.graded[0];
      if (typeof data?.score === "number") return { score: data.score };
      return { score: 0 };
    } catch (err) {
      console.error("Lỗi API chấm tự luận:", err);
      return { score: 0 };
    }
  }

  // --- ĐỌC ĐÁP ÁN ---
  function readStudentAnswer(q, i) {
    const kieu = (q.kieu_cau_hoi || 'trac_nghiem').toLowerCase();
    if (kieu === 'tu_luan') return qs(`#q${i}`)?.value.trim() || '';
    if (kieu === 'dung_sai_nhieu_lua_chon') {
      const res = {};
      Object.keys(q.lua_chon || {}).forEach(key => {
        const el = qs(`input[name="q${i}_${key}"]:checked`);
        res[key] = el ? el.value : '';
      });
      return res;
    }
    if (['trac_nghiem_nhieu','nhieu_lua_chon','trac_nghiem_nhieu_lua_chon'].includes(kieu)) {
      return Array.from(qsa(`input[name="q${i}"]:checked`)).map(n => n.value);
    }
    return qs(`input[name="q${i}"]:checked`)?.value || '';
  }

  // --- KIỂM TRA CHƯA TRẢ LỜI ---
  let unanswered = 0;
  questionData.forEach((q, i) => {
    const ans = readStudentAnswer(q, i);
    const kieu = (q.kieu_cau_hoi || 'trac_nghiem').toLowerCase();
    let empty = false;
    if (kieu === 'tu_luan') empty = !String(ans).trim();
    else if (kieu === 'dung_sai_nhieu_lua_chon') empty = Object.keys(q.lua_chon || {}).some(k => !(ans && ans[k]));
    else if (Array.isArray(ans)) empty = ans.length === 0;
    else empty = !ans;
    if (empty) unanswered++;
  });

  if (!autoByTime && unanswered > 0) {
    if (!confirm(`Bạn còn ${unanswered} câu chưa trả lời. Bạn có chắc muốn nộp bài không?`)) {
      timer = setInterval(updateCountdown, 1000);
      return;
    }
  }

  // --- CHẤM ĐIỂM ---
  const answers = [];
  let scoreTracNghiem1 = 0, scoreDungSai = 0, scoreTuLuan = 0;

  for (let i = 0; i < questionData.length; i++) {
    const q = questionData[i];
    const kieu = (q.kieu_cau_hoi || 'trac_nghiem').toLowerCase();
    const student = readStudentAnswer(q, i);
    let selectedContent = '', correctContent = '', isCorrect = false, matchScore = 0;
    const questionNumber = String(q.so_thu_tu || (i + 1));
    const weight = kieu === 'tu_luan' ? (scoreTable.tu_luan[questionNumber] || 1) : (scoreTable[kieu] || 0);

    if (kieu === 'trac_nghiem') {
      const selLetter = (student || '').trim().toUpperCase();
      const corr = String(q.dap_an_dung || '').trim().toUpperCase();
      selectedContent = selLetter ? `${selLetter}${q.lua_chon?.[student] ? `. ${q.lua_chon[student]}` : ''}` : '(chưa chọn)';
      correctContent = corr ? `${corr}${q.lua_chon?.[corr.toLowerCase()] ? `. ${q.lua_chon[corr.toLowerCase()]}` : ''}` : '';
      if (selLetter === corr) { isCorrect = true; matchScore = weight; scoreTracNghiem1 += weight; }
    } else if (['trac_nghiem_nhieu','nhieu_lua_chon','trac_nghiem_nhieu_lua_chon'].includes(kieu)) {
      const selArr = Array.isArray(student) ? student.map(s => s.trim().toUpperCase()).filter(Boolean) : [];
      const corrArr = String(q.dap_an_dung || '').split(/[,; ]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      const perChoiceScore = corrArr.length ? weight / corrArr.length : 0;
      let scoreThisQ = 0;
      selArr.forEach(a => { if (corrArr.includes(a)) scoreThisQ += perChoiceScore; });
      matchScore = scoreThisQ; scoreTracNghiem1 += scoreThisQ;
      selectedContent = selArr.length ? selArr.map(a => `${a}${q.lua_chon?.[a.toLowerCase()] ? `. ${q.lua_chon[a.toLowerCase()]}` : ''}`).join(', ') : '(chưa chọn)';
      correctContent = corrArr.length ? corrArr.map(a => `${a}${q.lua_chon?.[a.toLowerCase()] ? `. ${q.lua_chon[a.toLowerCase()]}` : ''}`).join(', ') : '';
      isCorrect = scoreThisQ === weight;
    } else if (kieu === 'dung_sai') {
      const selNorm = ['A','ĐÚNG','DUNG'].includes((student||'').toUpperCase()) ? 'Đúng' : 'Sai';
      const corrNorm = ['A','ĐÚNG','DUNG'].includes((q.dap_an_dung||'').toUpperCase()) ? 'Đúng' : 'Sai';
      selectedContent = selNorm || '(chưa chọn)'; correctContent = corrNorm;
      if (selNorm === corrNorm) { isCorrect = true; matchScore = weight; scoreDungSai += weight; }
    } else if (kieu === 'dung_sai_nhieu_lua_chon') {
      const studentObj = student || {};
      let correctObj = {};
      try { correctObj = typeof q.dap_an_dung === "string" && q.dap_an_dung.trim().startsWith("{") ? JSON.parse(q.dap_an_dung) : (q.dap_an_dung || {}); } catch(e) {}
      const keys = Object.keys(q.lua_chon || {});
      const perItemScore = keys.length ? weight / keys.length : 0;
      let scoreThisQ = 0;
      const displayStudent = [], displayCorrect = [];
      keys.forEach(key => {
        const st = (studentObj[key] || '').trim();
        const corrRaw = (correctObj[key] || '').trim();
        const corr = ['A','ĐÚNG','DUNG'].includes(corrRaw.toUpperCase()) ? 'Đúng' : (['B','SAI'].includes(corrRaw.toUpperCase()) ? 'Sai' : corrRaw);
        const stNorm = ['A','ĐÚNG','DUNG'].includes(st.toUpperCase()) ? 'Đúng' : (['B','SAI'].includes(st.toUpperCase()) ? 'Sai' : st);
        displayStudent.push(st ? `${key}: ${stNorm} ${stNorm === corr ? '✅' : '❌'}` : `${key}: (chưa chọn) ❌`);
        if (stNorm === corr) scoreThisQ += perItemScore;
        displayCorrect.push(`${key}: ${corr || '(không có)'}`);
      });
      matchScore = scoreThisQ; scoreDungSai += scoreThisQ;
      selectedContent = displayStudent.join(', '); correctContent = displayCorrect.join(', ');
      isCorrect = scoreThisQ === weight;
    } else if (kieu === 'tu_luan') {
      const studentText = student || '';
      const weightCau = scoreTable.tu_luan[questionNumber] || 1;
      const result = await gradeEssayWithAPI(studentText, q);
      const rscore = result?.score ?? 0;
      matchScore = Number((rscore * weightCau).toFixed(2));
      scoreTuLuan += matchScore;
      selectedContent = studentText || '(chưa trả lời)';
      correctContent = q.goi_y_dap_an || '';
      isCorrect = matchScore > 0;
    }

    answers.push({
      cau: questionNumber,
      noi_dung: q.noi_dung || '',
      da_chon: selectedContent,
      dap_an_dung: correctContent,
      dung: isCorrect,
      diem: Number(matchScore) || 0,
      kieu,
      goi_y_dap_an: q.goi_y_dap_an || ''
    });
  }

  // --- TỔNG ĐIỂM ---
  const totalScore = scoreTracNghiem1 + scoreDungSai + scoreTuLuan;
  const finalScore = Math.min(totalScore, 10).toFixed(2);

  const now = new Date();
  const formattedDate = now.toLocaleString('vi-VN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
  const resultDiv = qs('#result-container'); resultDiv.classList.remove('hidden');

  // --- Hiển thị kết quả ---
  let fileContent = `<div><strong>KẾT QUẢ BÀI THI</strong></div>
    <div><strong>Họ tên:</strong> ${safeHTML(name)}</div>
    <div><strong>SBD:</strong> ${safeHTML(sbd)}</div>
    <div><strong>Ngày sinh:</strong> ${safeHTML(dob)}</div>
    <div><strong>Mã đề:</strong> ${safeHTML(made)}</div>
    <div><strong style="color:red;">Tổng điểm: ${finalScore}/10</strong></div>
    <div>Nộp lúc: ${safeHTML(formattedDate)}</div><br>`;

  answers.forEach(ans => {
    const color = ans.dung ? 'green' : 'red';
    const symbol = ans.dung ? '✅' : '❌';
    const diemText = ` (${ans.diem.toFixed(2)} điểm)`;
    fileContent += `<div style="margin-bottom:.75rem;border-bottom:1px solid #eee;padding-bottom:.5rem;">
      <div><strong>Câu ${ans.cau}:</strong> ${safeHTML(ans.noi_dung)}</div>
      <div>Bạn chọn: <span style="color:${color};font-weight:bold;">${safeHTML(ans.da_chon||'-')}</span></div>
      ${ans.dap_an_dung ? `<div>Đáp án đúng: ${safeHTML(ans.dap_an_dung)}</div>` : ''}
      ${ans.kieu === 'tu_luan' && ans.goi_y_dap_an ? `<div>Gợi ý đáp án: ${safeHTML(ans.goi_y_dap_an)}</div>` : ''}
      <div><strong style="color:${color};">${symbol}${diemText}</strong></div>
    </div>`;
  });

  resultDiv.innerHTML = `<h1 class="text-2xl font-bold text-green-600 mb-4">✅ KẾT QUẢ BÀI THI</h1>
    <p class="text-sm text-gray-500 mb-4">🕒 Nộp lúc: ${safeHTML(formattedDate)}</p>
    <div id="result-html" class="result-scrollable">${fileContent}</div>
    <div class="flex gap-4 mt-4">
      <button id="btn-download-doc" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">⬇️ Tải .DOC</button>
      <button id="btn-download-pdf" class="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700">⬇️ Tải .PDF</button>
    </div>`;

  qs('#exam-container').classList.add('hidden');
  typeset(resultDiv);
  qs('#btn-download-doc')?.addEventListener('click', () => downloadDOC(name, made));
  qs('#btn-download-pdf')?.addEventListener('click', () => downloadPDF(name, made, answers, finalScore, formattedDate));

  // --- GỬI SERVER ---
  const payload = {
    hoten: name, sbd, ngaysinh: dob, made, diem: finalScore, answers,
    score_table: {
      ...scoreTable,
      tu_luan: Object.keys(scoreTable.tu_luan).length > 0 ? scoreTable.tu_luan : null
    }
  };

  try {
    const res = await fetch(`${API_BASE}/save_result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    console.log("📥 PHẢN HỒI:", data);

    if (data.status === "saved") {
      console.log("✅ LƯU THÀNH CÔNG!");

      // 🔹 XÓA dữ liệu tạm thời sau khi nộp
      const keys = ['savedAnswers','savedTime','flaggedQuestions','lastSaveTime'];
      keys.forEach(k => localStorage.removeItem(nsKey(k)));
    } else {
      console.warn("⚠️ Lưu thất bại:", data.msg);
    }
  } catch (err) {
    console.error('💥 Lỗi gửi:', err);
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





