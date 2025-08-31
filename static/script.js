
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

async function startExam(name, sbd, dob, made) {
  currentMade = made;
  qs('#info-hoten').textContent = name;
  qs('#info-sbd').textContent = sbd;
  qs('#info-made').textContent = made;
  qs('#login-form').classList.add('hidden');
  qs('#exam-container').classList.remove('hidden');
  qs('#exam-container').scrollIntoView({ behavior: 'smooth' });

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
    const res = await fetch(`${API_BASE}/get_questions?made=${encodeURIComponent(made)}`, { headers: { 'Accept': 'application/json', 'X-CSRFToken': csrf() } });
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Dữ liệu câu hỏi không phải mảng');
    questionData = processAllQuestions(data);
    renderQuestions(questionData);
    renderAnswerSheet();
    restoreAnswers();
    updateProgress();
  } catch (err) {
    const jsonFile = `/questions/questions${made}.json`;
    try {
      const res = await fetch(jsonFile, { headers: { 'Accept': 'application/json' } });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Dữ liệu câu hỏi không phải mảng');
      questionData = processAllQuestions(data);
      renderQuestions(questionData);
      renderAnswerSheet();
      restoreAnswers();
      updateProgress();
    } catch (e) {
      console.error('Lỗi tải câu hỏi:', e);
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
    const flagBtn = document.createElement('button');
    flagBtn.className = 'mt-2 text-blue-600 hover:underline text-sm';
    flagBtn.innerText = 'Đánh dấu';
    flagBtn.onclick = () => toggleReview(i);
    div.appendChild(flagBtn);
    container.appendChild(div);
  });
  function updateUnansweredCount() {
    let unanswered = 0;
    questions.forEach((_, i) => {
      const sel = getAnswerValue(i);
      if (!sel) unanswered++;
    });
    unansweredLabel.textContent = `Câu chưa trả lời: ${unanswered}`;
    updateProgress();
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
          renderAnswerSheet();
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
          renderAnswerSheet();
        });
      });
    }
  });
  updateUnansweredCount();
  typeset(container);
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
