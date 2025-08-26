const API_BASE = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? 'http://127.0.0.1:5000' : 'https://xuka.com.vn';
let time = 0;
let timer = null;
let questionData = [];
let examDeadline = null;
let currentMade = '';
let isExamMode = false;
let serviceWorkerRegistration = null;

// Khóa phím để ngăn gian lận trong chế độ thi
function enableKeyLock() {
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('contextmenu', handleContextMenu);
  window.addEventListener('beforeunload', handleBeforeUnload);
  window.addEventListener('popstate', handlePopState);
  history.pushState(null, document.title, location.href);
  console.log('[DEBUG] Đã kích hoạt khóa phím');
}

// Mở khóa phím sau khi thi xong
function disableKeyLock() {
  document.removeEventListener('keydown', handleKeyDown);
  document.removeEventListener('contextmenu', handleContextMenu);
  window.removeEventListener('beforeunload', handleBeforeUnload);
  window.removeEventListener('popstate', handlePopState);
  console.log('[DEBUG] Đã tắt khóa phím');
}

function handleKeyDown(e) {
  if (e.ctrlKey && ['c', 'v', 's', 'r', 'p', 'f', 'a', 'u'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    console.log('[DEBUG] Khóa phím:', e.key);
  }
  if (e.key === 'F5' || e.key === 'F12' || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i')) {
    e.preventDefault();
    console.log('[DEBUG] Khóa phím:', e.key);
  }
  if (e.key === 'Backspace' && !['input', 'textarea'].includes(e.target.tagName.toLowerCase())) {
    e.preventDefault();
    console.log('[DEBUG] Khóa phím Backspace ngoài input/textarea');
  }
  if (e.altKey && e.key.toLowerCase() === 'tab') {
    e.preventDefault();
    console.log('[DEBUG] Khóa phím Alt+Tab (hạn chế)');
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    console.log('[DEBUG] Khóa phím Escape');
  }
}

function handleContextMenu(e) {
  e.preventDefault();
  console.log('[DEBUG] Chặn nhấp chuột phải');
}

function handleBeforeUnload(e) {
  e.preventDefault();
  e.returnValue = 'Bạn đang trong lúc thi. Bạn có chắc muốn rời khỏi?';
}

function handlePopState() {
  history.pushState(null, document.title, location.href);
}

// Kích hoạt ngắt mạng bằng Service Worker
async function enableNetworkBlock() {
  if ('serviceWorker' in navigator) {
    try {
      if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        console.warn('[WARN] Service Worker yêu cầu HTTPS hoặc localhost. URL hiện tại:', location.href);
        alert('Không thể ngắt mạng: Yêu cầu HTTPS hoặc localhost.');
        return;
      }
      serviceWorkerRegistration = await navigator.serviceWorker.register('/static/sw.js', { scope: '/' });
      console.log('[DEBUG] Service Worker registered:', serviceWorkerRegistration);
    } catch (err) {
      console.error('[ERROR] Service Worker registration failed:', err);
      alert(`Không thể ngắt mạng: ${err.message}.`);
    }
  } else {
    console.error('[ERROR] Trình duyệt không hỗ trợ Service Worker');
    alert('Trình duyệt không hỗ trợ ngắt mạng.');
  }
}

// Vô hiệu hóa Service Worker
async function disableNetworkBlock() {
  if (serviceWorkerRegistration) {
    try {
      await serviceWorkerRegistration.unregister();
      console.log('[DEBUG] Service Worker unregistered');
      serviceWorkerRegistration = null;
    } catch (err) {
      console.error('[ERROR] Failed to unregister Service Worker:', err);
    }
  }
}

// Hiệu ứng thông báo thành công
function showSuccessEffect(message = "Quét thành công!") {
  const div = document.createElement("div");
  div.innerText = message;
  div.className = "fixed top-5 right-5 bg-green-500 text-white px-4 py-2 rounded-xl shadow-lg animate-bounce z-50";
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2000);
}

// Tiện ích
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

// Kiểm tra quyền camera
async function checkCameraPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach(t => t.stop());
    return true;
  } catch (err) {
    qs('#qr-error').textContent = 'Vui lòng cấp quyền camera trong cài đặt trình duyệt hoặc kiểm tra thiết bị camera!';
    qs('#qr-error').classList.remove('hidden');
    return false;
  }
}

// Khởi tạo scanner QR
async function ensureScanner() {
  if (!html5QrCode) html5QrCode = new Html5Qrcode('reader');
  return html5QrCode;
}

// Dừng scanner QR
async function stopScanner() {
  if (html5QrCode) {
    try { await html5QrCode.stop(); } catch (_) {}
    try { await html5QrCode.clear(); } catch (_) {}
    html5QrCode = null;
  }
}

// Bắt đầu quét QR
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
    const qrbox = window.innerWidth <= 640 ? { width: 200, height: 200 } : { width: 250, height: 250 };
    await html5QrCode.start(camId, { fps: 10, qrbox }, async (decodedText) => {
      console.log('[DEBUG] Mã QR được giải mã:', decodedText);
      await stopScanner();
      await verifyAndLogin(decodedText);
    }, () => {});
  } catch (err) {
    qs('#qr-error').textContent = `Lỗi camera: ${err?.message || 'Không thể khởi động camera.'}`;
    qs('#qr-error').classList.remove('hidden');
  }
}

// Xử lý sự kiện chuyển camera
qs('#flip-camera')?.addEventListener('click', async () => {
  if (!devices.length || !html5QrCode) return;
  camIndex = (camIndex + 1) % devices.length;
  try {
    await html5QrCode.stop();
    const qrbox = window.innerWidth <= 640 ? { width: 200, height: 200 } : { width: 250, height: 250 };
    await html5QrCode.start(devices[camIndex].id, { fps: 10, qrbox }, async (dt) => {
      console.log('[DEBUG] Mã QR được giải mã (chuyển camera):', dt);
      await stopScanner();
      await verifyAndLogin(dt);
    }, () => {});
  } catch (e) {
    console.error('[ERROR] Không đổi được camera:', e);
    qs('#qr-error').textContent = 'Không thể chuyển camera!';
    qs('#qr-error').classList.remove('hidden');
  }
});

// Xử lý tải lên file QR
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
    qs('#qr-error').textContent = 'Vui lòng chọn một tệp hình ảnh (JPG, PNG, v.v.)!';
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
    console.log('[DEBUG] Mã QR được giải mã từ tệp:', decoded);
    URL.revokeObjectURL(img.src);
    await stopScanner();
    await verifyAndLogin(decoded);
  } catch (err) {
    qs('#qr-error').textContent = `Không thể đọc mã QR từ ảnh: ${err.message || 'Lỗi không xác định.'}`;
    qs('#qr-error').classList.remove('hidden');
  } finally {
    qrFileInput.value = '';
  }
});

// Xác thực và đăng nhập bằng mã QR
async function verifyAndLogin(qrText) {
  qs('#qr-error').classList.add('hidden');
  if (!qrText) {
    qs('#qr-error').textContent = 'Mã QR rỗng!';
    qs('#qr-error').classList.remove('hidden');
    return;
  }
  console.log('[DEBUG] Gửi mã QR đến server:', qrText, 'CSRF Token:', csrf());
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
      throw new Error(errorData.msg || `Lỗi máy chủ: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    if (data.status === 'success') {
      showSuccessEffect();
      qs('#button-group').classList.add('hidden');
      qs('#qr-login').classList.add('hidden');
      qs('#account-login').classList.remove('hidden');
      qs('#account-login').scrollIntoView({ behavior: 'smooth' });
    } else {
      throw new Error(data.msg || 'Mã QR không hợp lệ!');
    }
  } catch (err) {
    console.error('[ERROR] Lỗi verifyAndLogin:', err);
    qs('#qr-error').textContent = err.message || 'Lỗi kết nối máy chủ!';
    qs('#qr-error').classList.remove('hidden');
  }
}

// Xử lý đăng nhập bằng tài khoản
qs('#account-login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = qs('#username').value.trim();
  const password = qs('#password').value;
  if (!username || !password) {
    const x = qs('#login-error');
    x.textContent = 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!';
    x.classList.remove('hidden');
    return;
  }
  try {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.status === 'success') {
      qs('#account-login').classList.add('hidden');
      qs('#login-form').classList.remove('hidden');
      qs('#login-form').scrollIntoView({ behavior: 'smooth' });
      loadExamCodes();
    } else {
      throw new Error(data.msg || 'Sai tên đăng nhập hoặc mật khẩu!');
    }
  } catch (err) {
    const x = qs('#login-error');
    x.textContent = err.message;
    x.classList.remove('hidden');
  }
});

// Tải danh sách mã đề
async function loadExamCodes() {
  const select = qs('#made');
  try {
    const res = await fetch(`${API_BASE}/get_exam_codes`, { headers: { 'Accept': 'application/json', 'X-CSRFToken': csrf() } });
    const data = await res.json();
    const codes = Array.isArray(data) ? data : (data.codes || []);
    select.innerHTML = '<option value="">-- Chọn mã đề --</option>' + codes.map(c => `<option value="${c}">${c}</option>`).join('');
  } catch (err) {
    const p = document.createElement('p');
    p.className = 'text-red-600 mt-2 font-semibold';
    p.textContent = 'Không thể tải danh sách mã đề. Vui lòng kiểm tra kết nối mạng!';
    select.parentElement.appendChild(p);
  }
}

// Bắt đầu bài thi
qs('#btn-start-exam')?.addEventListener('click', startExam);

async function startExam() {
  const name = qs('#hoten').value.trim();
  const sbd = qs('#sbd').value.trim();
  const dob = qs('#ngaysinh').value;
  const made = qs('#made').value;
  const formError = qs('#form-error');

  // Kiểm tra định dạng SBD
  if (!/^\d+$/.test(sbd)) {
    formError.textContent = 'Số báo danh chỉ được chứa chữ số!';
    formError.classList.remove('hidden');
    return;
  }
  // Kiểm tra ngày sinh hợp lệ
  const dobDate = new Date(dob);
  if (isNaN(dobDate.getTime()) || dobDate > new Date()) {
    formError.textContent = 'Ngày sinh không hợp lệ!';
    formError.classList.remove('hidden');
    return;
  }
  if (!name || !sbd || !dob || !made) {
    formError.textContent = 'Vui lòng nhập đầy đủ thông tin!';
    formError.classList.remove('hidden');
    return;
  }

  formError.classList.add('hidden');
  currentMade = made;
  isExamMode = true;
  enableKeyLock();
  await enableNetworkBlock();
  qs('#exam-notice').classList.remove('hidden');

  try {
    await document.documentElement.requestFullscreen();
    console.log('[DEBUG] Kích hoạt chế độ toàn màn hình');
  } catch (err) {
    console.warn('[WARN] Không thể kích hoạt toàn màn hình:', err);
  }

  qs('#login-form').classList.add('hidden');
  qs('#exam-container').classList.remove('hidden');

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
      alert(`Không thể tải câu hỏi: ${e.message}. Vui lòng kiểm tra kết nối mạng!`);
    }
  }
}

// Cập nhật đồng hồ đếm ngược
function updateCountdown() {
  const now = Date.now();
  const remainMs = Math.max(0, (examDeadline || now) - now);
  const remain = Math.floor(remainMs / 1000);
  const m = String(Math.floor(remain / 60)).padStart(2, '0');
  const s = String(remain % 60).padStart(2, '0');
  qs('#countdown').innerText = `Thời gian: ${m}:${s}`;
  localStorage.setItem(nsKey('savedTime'), remain);
  if (remain <= 0) {
    clearInterval(timer);
    submitExam(true);
  }
}

// Định dạng chung cho nội dung câu hỏi
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
  const subMap = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };
  s = s.replace(/[\u2080-\u2089]/g, m => subMap[m] || m);
  return s;
}

// Xử lý nội dung toán học
function processMathContent(content) {
  let s = applyGeneralFormatting(content);
  s = s.replace(/([^\s])∫/g, "$1 ∫");
  s = s.replace(/∫([^\s])/g, "∫ $1");
  s = s.replace(/([^\s])dx\b/gi, "$1 dx");
  s = s.replace(/\b(sin|cos|tan|cot|sec|csc|arctan|arcsin|arccos|ln|log)\s*([A-Za-z0-9\\pi])/gi, "$1 $2");
  s = s.replace(/\bGiảihệbấtphươngtrình\b/gi, "Giải hệ bất phương trình");
  s = s.replace(/\bGiảibấtphươngtrình\b/gi, "Giải bất phương trình");
  s = s.replace(/\blog(\d+)\(([^)]+)\)/gi, (_, base, arg) => `\\log_{${base}}(${arg.trim()})`);
  s = s.replace(/\blog\(([^)]+)\)/gi, (_, arg) => `\\log(${arg.trim()})`);
  s = s.replace(/ln\(([^)]+)\)/gi, (_, arg) => `\\ln(${arg.trim()})`);
  s = s.replace(/frac\(([^,]+),([^)]+)\)/gi, (_, a, b) => `\\frac{${a.trim()}}{${b.trim()}}`);
  s = s.replace(/\b([A-Za-z0-9]+)\/([A-Za-z0-9]+)\b/g, (_, a, b) => `\\frac{${a}}{${b}}`);
  s = s.replace(/sqrt\[(\d+)\]\(([^)]+)\)/gi, (_, n, val) => `\\sqrt[${n}]{${val.trim()}}`);
  s = s.replace(/sqrt\(([^)]+)\)/gi, (_, val) => `\\sqrt{${val.trim()}}`);
  s = s.replace(/([A-Za-z])_(\d+)/g, (_, base, sub) => `${base}_{${sub}}`);
  s = s.replace(/([A-Za-z0-9])\^(\d+)/g, (_, base, sup) => `${base}^{${sup}}`);
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

// Xử lý nội dung vật lý
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

// Xử lý nội dung hóa học
function processChemistryContent(content) {
  let s = applyGeneralFormatting(content);
  s = s.replace(/H_2O/g, "\\ce{H2O}");
  s = s.replace(/CO_2/g, "\\ce{CO2}");
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

// Xử lý nội dung bài thi
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

// Xử lý tất cả câu hỏi
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

// Lấy giá trị câu trả lời
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

// Hiển thị câu hỏi
function renderQuestions(questions) {
  const container = qs('#questions');
  container.innerHTML = '';
  const unansweredLabel = document.createElement('p');
  unansweredLabel.id = 'unanswered-count';
  unansweredLabel.className = 'text-red-600 font-bold mb-4 text-base';
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
      ta.className = 'border p-3 w-full rounded-md text-base';
      div.appendChild(ta);
    } else if (q.lua_chon) {
      const wrap = document.createElement('div');
      wrap.className = 'border rounded-md p-3 max-h-40 overflow-y-auto space-y-3';
      Object.entries(q.lua_chon).forEach(([k, v]) => {
        const row = document.createElement('div');
        row.className = 'flex items-start gap-2 min-w-max';
        const id = `q${i}_${k}`;
        row.innerHTML = `
          <input type="radio" name="q${i}" id="${id}" value="${k}" class="mt-1 w-5 h-5">
          <label for="${id}" class="overflow-x-auto block text-base" style="max-width: calc(100% - 30px);">${safeHTML(`${k}. ${v}`)}</label>
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

// Khôi phục câu trả lời đã lưu
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

// Xóa bộ nhớ tạm
function clearTempStorage() {
  localStorage.removeItem(nsKey('savedAnswers'));
  localStorage.removeItem(nsKey('savedTime'));
}

// Nộp bài thi
qs('#btn-submit')?.addEventListener('click', () => submitExam(false));

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
  let score = 0;
  questionData.forEach((q, i) => {
    const selected = getAnswerValue(i);
    const correctKey = q.dap_an_dung ? q.dap_an_dung.trim() : '';
    const kieu = (q.kieu_cau_hoi || 'trac_nghiem').toLowerCase();
    let selectedContent = '';
    let correctContent = '';
    if (kieu === 'trac_nghiem') {
      selectedContent = selected && q.lua_chon ? q.lua_chon[selected] : '(chưa chọn)';
      correctContent = correctKey && q.lua_chon ? q.lua_chon[correctKey] : '';
    } else {
      selectedContent = selected || '(chưa trả lời)';
    }
    const isCorrect = (kieu === 'trac_nghiem') && selected && correctKey && selected.toUpperCase() === correctKey.toUpperCase();
    if (isCorrect) score++;
    answers.push({
      cau: i + 1,
      noi_dung: q.noi_dung,
      da_chon: processExamContent(selectedContent),
      dap_an_dung: processExamContent(correctContent),
      dung: !!isCorrect,
      kieu,
      goi_y_dap_an: q.goi_y_dap_an || ''
    });
  });
  const finalScore = questionData.length ? (score / questionData.length * 10).toFixed(2) : '0.00';
  clearTempStorage();
  const now = new Date();
  const formattedDate = now.toLocaleString('vi-VN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
  let fileContent = `<div><strong>KẾT QUẢ BÀI THI</strong></div>` +
    `<div>Họ tên: ${safeHTML(name)}</div>` +
    `<div>SBD: ${safeHTML(sbd)}</div>` +
    `<div>Ngày sinh: ${safeHTML(dob)}</div>` +
    `<div>Mã đề: ${safeHTML(made)}</div>` +
    `<div>Điểm: ${safeHTML(finalScore)}/10</div>` +
    `<div>Nộp lúc: ${safeHTML(formattedDate)}</div><br>`;
  answers.forEach(ans => {
    fileContent += `<div style="margin-bottom: .75rem;">Câu ${ans.cau}: <span>${safeHTML(ans.noi_dung)}</span></div>`;
    fileContent += `<div>Bạn chọn: <span>${safeHTML(ans.da_chon)}</span>`;
    if (ans.kieu === 'trac_nghiem') {
      fileContent += ` ${ans.dung ? '- ĐÚNG' : '- SAI'}</div>`;
      if (ans.dap_an_dung) {
        fileContent += `<div>Đáp án đúng: <span>${safeHTML(ans.dap_an_dung)}</span></div>`;
      }
    } else {
      fileContent += `</div>`;
      if (ans.goi_y_dap_an) {
        fileContent += `<div>Gợi ý đáp án: <span>${safeHTML(ans.goi_y_dap_an)}</span></div>`;
      }
    }
    fileContent += `<br>`;
  });
  const resultDiv = qs('#result-container');
  resultDiv.classList.remove('hidden');
  resultDiv.innerHTML = `
    <h1 class="text-2xl font-bold text-green-600 mb-4">✅ KẾT QUẢ BÀI THI</h1>
    <p class="text-sm text-gray-500 mb-4">🕒 Nộp lúc: ${safeHTML(formattedDate)}</p>
    <div id="result-html" class="result-scrollable">${fileContent}</div>
    <div class="flex gap-4 mt-4 flex-wrap">
      <button id="btn-download-doc" class="px-5 py-3 bg-blue-600 text-white rounded text-base hover:bg-blue-700 touch-action-manipulation">⬇️ Tải kết quả .DOC</button>
      <button id="btn-download-pdf" class="px-5 py-3 bg-red-600 text-white rounded text-base hover:bg-red-700 touch-action-manipulation">⬇️ Tải kết quả .PDF</button>
    </div>
  `;
  qs('#exam-container').classList.add('hidden');
  typeset(resultDiv);
  qs('#btn-download-doc')?.addEventListener('click', () => downloadDOC(name, made));
  qs('#btn-download-pdf')?.addEventListener('click', () => downloadPDF(name, made, answers, finalScore, formattedDate));
  
  isExamMode = false;
  disableKeyLock();
  await disableNetworkBlock();

  try {
    await fetch(`${API_BASE}/save_result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf() },
      body: JSON.stringify({ hoten: name, sbd, ngaysinh: dob, made, diem: finalScore, answers })
    });
  } catch (err) {
    console.error('[ERROR] Lỗi lưu backend:', err);
  }
}

// Tải file DOC
function downloadDOC(name, made) {
  const container = qs('#result-html');
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

// Tải file PDF
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
    console.error('[ERROR] Lỗi tạo PDF:', err);
    alert('Không thể tạo tệp PDF. Vui lòng thử lại!');
  }
}

// Khởi động ứng dụng
document.addEventListener('DOMContentLoaded', () => {
  startQrScanner();
});