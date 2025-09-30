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
  if (loginForm) {
    loginForm.classList.add('hidden');
  } else {
    console.error('[ERROR] Không tìm thấy #login-form');
  }
  if (examContainer) {
    examContainer.classList.remove('hidden');
  } else {
    console.error('[ERROR] Không tìm thấy #exam-container');
  }

  try {
    const res = await fetch(`${API_BASE}/exam_session?made=${encodeURIComponent(made)}`, { headers: { 'Accept': 'application/json', 'X-CSRFToken': csrf() } });
    const data = await res.json();
    if (data?.deadline) { examDeadline = Number(data.deadline); }
    const duration = Number(data?.duration_sec || 3600);
    if (!examDeadline) { examDeadline = Date.now() + duration * 1000; }
  } catch (_) {
    examDeadline = Date.now() + 3600 * 1000;
  }

  updateCountdown();
  timer = setInterval(updateCountdown, 1000);

  try {
    const res = await fetch(`${API_BASE}/get_questions?made=${encodeURIComponent(made)}`, { headers: { 'Accept': 'application/json' } });
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Dữ liệu câu hỏi không phải mảng');
    questionData = processAllQuestions(data);
    renderQuestions(questionData);
    restoreAnswers();
  } catch (err) {
    const jsonFile = `/questions/questions${made}.json`;
    try {
      const res = await fetch(jsonFile, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Dữ liệu câu hỏi không phải mảng');
      questionData = processAllQuestions(data);
      renderQuestions(questionData);
      restoreAnswers();
    } catch (e) {
      console.error('[ERROR] Lỗi tải câu hỏi:', e);
      alert(`Không thể tải câu hỏi: ${e.message}`);
    }
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

function validateQuestion(q) {
  const qq = { ...q };
  if (qq.lua_chon && typeof qq.lua_chon === 'object') {
    for (const k in qq.lua_chon) {
      if (Object.prototype.hasOwnProperty.call(qq.lua_chon, k)) {
        if (qq.lua_chon[k].includes('< / span>')) {
          console.warn(`Malformed option in question ${qq.noi_dung}: ${qq.lua_chon[k]}`);
          qq.lua_chon[k] = qq.lua_chon[k].replace(/< \/ span>/g, '');
        }
      }
    }
  }
  if (qq.dap_an_dung && qq.dap_an_dung.includes('< / span>')) {
    console.warn(`Malformed correct answer in question ${qq.noi_dung}: ${qq.dap_an_dung}`);
    qq.dap_an_dung = qq.dap_an_dung.replace(/< \/ span>/g, '');
  }
  return qq;
}

function processAllQuestions(questions) {
  return questions.map(q => {
    const qq = validateQuestion({ ...q });
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
  if (!container) {
    console.error('[ERROR] Không tìm thấy #questions');
    return;
  }
  container.innerHTML = '';
  console.log('[DEBUG] Rendering questions:', questions.map(q => q.noi_dung));
  const unansweredLabel = document.createElement('p');
  unansweredLabel.id = 'unanswered-count';
  unansweredLabel.className = 'text-red-600 font-bold mb-4';
  container.appendChild(unansweredLabel);
  questions.forEach((q, i) => {
    const div = document.createElement('div');
    div.className = 'mb-6 p-4 bg-gray-50 rounded-lg';
    const label = document.createElement('label');
    label.className = 'block font-semibold mb-2 text-lg';
    label.innerHTML = `Câu ${i + 1}: ${safeHTML(q.noi_dung)}`;
    div.appendChild(label);
    if ((q.kieu_cau_hoi || '').toLowerCase() === 'tu_luan') {
      const ta = document.createElement('textarea');
      ta.id = `q${i}`;
      ta.rows = 4;
      ta.placeholder = 'Nhập câu trả lời...';
      ta.className = 'border p-2 w-full rounded-md';
      div.appendChild(ta);
    } else if (q.lua_chon) {
      const wrap = document.createElement('div');
      wrap.className = 'border rounded-md p-2 max-h-40 overflow-y-auto space-y-2';
      Object.entries(q.lua_chon).forEach(([k, v]) => {
        const row = document.createElement('div');
        row.className = 'flex items-start gap-2 min-w-max';
        const id = `q${i}_${k}`;
        row.innerHTML = `
          <input type="radio" name="q${i}" id="${id}" value="${k}" class="mt-1">
          <label for="${id}" class="overflow-x-auto block" style="max-width: calc(100% - 30px);">${safeHTML(`${k}. ${v}`)}</label>
        `;
        wrap.appendChild(row);
      });
      div.appendChild(wrap);
    }
    container.appendChild(div);
  });
  function updateUnansweredCount() {
    let unanswered = 0;
    questions.forEach((q, i) => {
      const sel = getAnswerValue(i);
      if (!sel) unanswered++;
    });
    unansweredLabel.textContent = `Câu chưa trả lời: ${unanswered}`;
  }
  questions.forEach((q, i) => {
    if ((q.kieu_cau_hoi || '').toLowerCase() === 'tu_luan') {
      const ta = qs(`#q${i}`);
      if (ta) {
        ta.addEventListener('input', () => {
          const cur = JSON.parse(localStorage.getItem(nsKey('savedAnswers')) || '{}');
          cur[`q${i}`] = ta.value;
          localStorage.setItem(nsKey('savedAnswers'), JSON.stringify(cur));
          updateUnansweredCount();
        });
      }
    } else {
      const radios = qsa(`input[name="q${i}"]`);
      Array.from(radios).forEach(r => {
        r.addEventListener('change', () => {
          const cur = JSON.parse(localStorage.getItem(nsKey('savedAnswers')) || '{}');
          cur[`q${i}`] = r.value;
          localStorage.setItem(nsKey('savedAnswers'), JSON.stringify(cur));
          updateUnansweredCount();
        });
      });
    }
  });
  updateUnansweredCount();
  typeset(container);
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
}

function clearTempStorage() {
  localStorage.removeItem(nsKey('savedAnswers'));
  localStorage.removeItem(nsKey('savedTime'));
}

qs('#btn-submit')?.addEventListener('click', () => submitExam(false));

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

async function submitExam(autoByTime) {
  clearInterval(timer);
  const name = qs('#hoten').value.trim();
  const made = qs('#made').value;
  currentMade = made;
  const sbd = qs('#sbd').value.trim();
  const dob = qs('#ngaysinh').value;

  let unanswered = 0;
  questionData.forEach((q, i) => {
    if (!getAnswerValue(i)) unanswered++;
  });

  if (!autoByTime && unanswered > 0) {
    if (!confirm(`Bạn còn ${unanswered} câu chưa trả lời. Bạn có chắc muốn nộp bài không?`)) {
      timer = setInterval(updateCountdown, 1000);
      return;
    }
  }

  const answers = [];
  let scoreTracNghiem1 = 0; // Trắc nghiệm 1 lựa chọn
  let scoreDungSai = 0;     // Đúng/Sai
  let scoreTuLuan = 0;      // Tự luận

  questionData.forEach((q, i) => {
    const selected = getAnswerValue(i);
    const correctKey = q.dap_an_dung ? q.dap_an_dung.trim() : '';
    const kieu = (q.kieu_cau_hoi || 'trac_nghiem').toLowerCase();
    let selectedContent = '';
    let correctContent = '';
    let isCorrect = false;

    if (kieu === 'trac_nghiem') {
      selectedContent = selected && q.lua_chon ? q.lua_chon[selected] : '(chưa chọn)';
      correctContent = correctKey && q.lua_chon ? q.lua_chon[correctKey] : '';
      isCorrect = selected && correctKey && selected.toUpperCase() === correctKey.toUpperCase();
      if (isCorrect) scoreTracNghiem1 += 0.25;

    } else if (kieu === 'dung_sai') {
      const daChonNorm = selected
        ? (selected.toUpperCase() === 'A' || selected.toUpperCase() === 'ĐÚNG' ? 'Đúng' : 'Sai')
        : '';
      const dapAnDungNorm = correctKey.toUpperCase() === 'A' ? 'Đúng' : 'Sai';
      isCorrect = selected && daChonNorm === dapAnDungNorm;
      selectedContent = selected ? daChonNorm : '(chưa chọn)';
      correctContent = dapAnDungNorm;
      if (isCorrect) scoreDungSai += 0.25;

    } else if (kieu === 'trac_nghiem_nhieu') {
      const correctArr = correctKey.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      const selectedArr = selected ? selected.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [];
      const matched = selectedArr.filter(ans => correctArr.includes(ans)).length;
      const partialScore = correctArr.length ? (matched / correctArr.length) * 0.25 : 0;
      scoreTracNghiem1 += partialScore;
      selectedContent = selectedArr.join(', ') || '(chưa chọn)';
      correctContent = correctArr.join(', ');
      isCorrect = partialScore === 0.25;

    } else if (kieu === 'tu_luan') {
      const result = gradeEssayAdvanced(selected, q.goi_y_dap_an || '');
      scoreTuLuan += result.score;
      selectedContent = result.selectedContent || '(chưa trả lời)';
      correctContent = result.correctContent || '';
      isCorrect = result.isCorrect;
    }
    answers.push({
      cau: i + 1,
      noi_dung: q.noi_dung,
      da_chon: selectedContent,
      dap_an_dung: correctContent,
      dung: isCorrect,
      kieu,
      goi_y_dap_an: q.goi_y_dap_an || ''
    });
  });

  const totalScore = scoreTracNghiem1 + scoreDungSai + scoreTuLuan;
  const finalScore = Math.min(totalScore, 10).toFixed(2);

  clearTempStorage();

  const now = new Date();
  const formattedDate = now.toLocaleString('vi-VN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });

  // --- PHẦN HIỂN THỊ KẾT QUẢ ---
  let fileContent = `<div><strong>KẾT QUẢ BÀI THI</strong></div>` +
    `<div><strong>Họ tên:</strong> <strong>${safeHTML(name)}</strong></div>` +
    `<div><strong>SBD:</strong> <strong>${safeHTML(sbd)}</strong></div>` +
    `<div><strong>Ngày sinh:</strong> <strong>${safeHTML(dob)}</strong></div>` +
    `<div><strong>Mã đề:</strong> <strong>${safeHTML(made)}</strong></div>` +
    `<div>Điểm Trắc nghiệm 1 lựa chọn: ${scoreTracNghiem1.toFixed(2)}</div>` +
    `<div>Điểm Đúng/Sai: ${scoreDungSai.toFixed(2)}</div>` +
    `<div>Điểm Tự luận: ${scoreTuLuan.toFixed(2)}</div>` +
    `<div><strong style="color:red;">Tổng điểm: ${finalScore}/10</strong></div>` +
    `<div>Nộp lúc: ${safeHTML(formattedDate)}</div><br>`;

  answers.forEach(ans => {
    const color = ans.dung ? 'green' : 'red'; // Đúng xanh, sai đỏ
    const symbol = ans.dung ? '✅' : '❌';
    fileContent += `<div style="margin-bottom: .75rem;">Câu ${ans.cau}: <span>${safeHTML(ans.noi_dung)}</span></div>`;
    fileContent += `<div>Bạn chọn: <span style="color:${color}; font-weight:bold;">${safeHTML(ans.da_chon)} ${symbol}</span></div>`;
    if (ans.dap_an_dung) {
      fileContent += `<div>Đáp án đúng: <span>${safeHTML(ans.dap_an_dung)}</span></div>`;
    } else if (ans.goi_y_dap_an) {
      fileContent += `<div>Gợi ý đáp án: <span>${safeHTML(ans.goi_y_dap_an)}</span></div>`;
    }
    fileContent += `<br>`;
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
  if (!container) {
    console.error('[ERROR] Không tìm thấy #result-html');
    return;
  }
  const header = `<!DOCTYPE html><html><head><meta charset='utf-8'><title>Kết quả</title></head><body>`;
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
    y = addText(`Họ tên: ${name || ''}`, margin, y);
    y = addText(`SBD: ${qs('#sbd')?.value || ''}`, margin, y);
    y = addText(`Ngày sinh: ${qs('#ngaysinh')?.value || ''}`, margin, y);
    y = addText(`Mã đề: ${made || ''}`, margin, y);
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
    console.error('[ERROR] Lỗi tạo PDF:', err);
    alert('Không thể tạo tệp PDF. Vui lòng thử lại hoặc kiểm tra console để biết chi tiết!');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('[DEBUG] Khởi động ứng dụng');
  const qrLogin = qs('#qr-login');
  const buttonGroup = qs('#button-group');
  const accountLogin = qs('#account-login');
  const loginForm = qs('#login-form');
  const examContainer = qs('#exam-container');
  const resultContainer = qs('#result-container');
  const leftColumn = qs('#left-column');
  const rightColumn = qs('#right-column');

  if (qrLogin) qrLogin.classList.remove('hidden');
  if (buttonGroup) buttonGroup.classList.remove('hidden');
  if (accountLogin) accountLogin.classList.add('hidden');
  if (loginForm) loginForm.classList.add('hidden');
  if (examContainer) examContainer.classList.add('hidden');
  if (resultContainer) resultContainer.classList.add('hidden');
  if (leftColumn) {
    leftColumn.classList.remove('hidden');
    console.log('[DEBUG] #left-column được hiển thị ban đầu');
  } else {
    console.error('[ERROR] Không tìm thấy #left-column khi khởi động');
  }
  if (rightColumn) {
    rightColumn.classList.remove('hidden');
    console.log('[DEBUG] #right-column được hiển thị ban đầu');
  } else {
    console.error('[ERROR] Không tìm thấy #right-column khi khởi động');
  }

  startQrScanner();
});



