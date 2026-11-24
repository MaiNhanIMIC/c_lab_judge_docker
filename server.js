const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const UNITY_DIR = path.join(__dirname, 'unity');
const STORAGE_DIR = path.join(__dirname, 'storage');
const RUN_TMP_DIR = path.join(__dirname, '.tmp_runs');
fs.mkdirSync(RUN_TMP_DIR, { recursive: true });
const DB_PATH = path.join(STORAGE_DIR, 'db.json');

const TEACHER_USER = 'bcdv2006';
const TEACHER_PASS = '090925';

fs.mkdirSync(STORAGE_DIR, { recursive: true });

function normalizeFullName(str) {
  return String(str || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function defaultDb() {
  return {
    classes: [
      {
        id: 'cls_default_1',
        name: 'Lớp C/C++ K1',
        students: [
          { id: 'stu_1', name: 'Nguyễn Văn An', code: 'HV01' },
          { id: 'stu_2', name: 'Trần Thị Bình', code: 'HV02' }
        ]
      }
    ],
    customProblems: [],
    testCasesByProblem: {},
    solvedByUser: {},
    submissions: {}
  };
}

function loadDb() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      return { ...defaultDb(), ...parsed };
    }
  } catch (e) {
    console.error('Failed to load db.json:', e.message);
  }
  const initial = defaultDb();
  saveDb(initial);
  return initial;
}

function saveDb(db) {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_PATH);
}

let db = loadDb();

// Load base 18-session problems from public/data/buoi_*.json
function loadBaseProblems() {
  const probs = [];
  for (let i = 1; i <= 18; i++) {
    const fpath = path.join(PUBLIC_DIR, 'data', `buoi_${i}.json`);
    if (fs.existsSync(fpath)) {
      try {
        const data = JSON.parse(fs.readFileSync(fpath, 'utf8'));
        if (Array.isArray(data.problems)) probs.push(...data.problems);
      } catch (e) {
        console.error(`Error loading buoi_${i}.json:`, e.message);
      }
    }
  }
  return probs;
}

const BASE_PROBLEMS = loadBaseProblems();

function getProblemById(pid) {
  const custom = db.customProblems.find(p => p.id === pid);
  const base = BASE_PROBLEMS.find(p => p.id === pid);
  const p = custom || base;
  if (!p) return null;
  const overrideTcs = db.testCasesByProblem[pid];
  return {
    ...p,
    testCases: Array.isArray(overrideTcs) ? overrideTcs : (p.testCases || [])
  };
}

function detectIsCpp(code) {
  return /<\s*(iostream|vector|map|string|memory|stdexcept)\s*>|\b(std::|cout|cin|class\s+|virtual\s+|unique_ptr|shared_ptr|try\s*\{)/.test(code);
}

function compileAndRunGCC({ sourceCode, stdinText = '', isUnit = false, testCode = '' }) {
  return new Promise((resolve) => {
    const tmpDir = fs.mkdtempSync(path.join(RUN_TMP_DIR, 'clab_'));
    const isCpp = detectIsCpp(sourceCode + '\n' + testCode);
    const compiler = isCpp ? 'g++' : 'gcc';
    const ext = isCpp ? 'cpp' : 'c';
    const srcFile = path.join(tmpDir, `main.${ext}`);
    const binFile = path.join(tmpDir, 'app');

    let finalSource = sourceCode;
    if (isUnit) {
      const safeStudent = sourceCode.replace(/\b(int|void)\s+main\s*\(/g, '$1 __student_main(');
      finalSource = `#include "unity_runner.h"\n#include <math.h>\n#include <string.h>\n#include <stdlib.h>\n\n${safeStudent}\n\nint main(void) {\n${testCode}\n    return 0;\n}\n`;
    }

    fs.writeFileSync(srcFile, finalSource, 'utf8');

    const compileArgs = [
      srcFile,
      '-o', binFile,
      `-I${UNITY_DIR}`,
      '-O2',
      '-lm'
    ];

    const t0 = Date.now();
    execFile(compiler, compileArgs, { timeout: 8000, maxBuffer: 512 * 1024 }, (compErr, _cOut, cErr) => {
      if (compErr) {
        const elapsed = Math.max(1, Date.now() - t0);
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        return resolve({
          ok: false,
          status: 'CE',
          error: (cErr || compErr.message || 'Lỗi biên dịch').slice(0, 1500),
          elapsed
        });
      }

      const runT0 = Date.now();
      const child = spawn(binFile, [], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, 2000);

      child.stdout.on('data', (chunk) => {
        if (stdout.length < 64 * 1024) stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 64 * 1024) stderr += chunk.toString('utf8');
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        const elapsed = Math.max(1, Date.now() - runT0);
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
        resolve({ ok: false, status: 'RE', error: err.message, elapsed });
      });

      child.on('close', (code, signal) => {
        clearTimeout(timer);
        const elapsed = Math.max(1, Date.now() - runT0);
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

        if (timedOut) {
          return resolve({
            ok: false,
            status: 'TLE',
            error: 'Vượt quá giới hạn thời gian 2 giây (Time Limit Exceeded).',
            elapsed
          });
        }
        if (signal) {
          return resolve({
            ok: false,
            status: 'RE',
            error: `Chương trình bị dừng bởi tín hiệu ${signal} (lỗi bộ nhớ hoặc chia cho 0).`,
            elapsed
          });
        }
        if (code !== 0) {
          if (isUnit && code === 2) {
            return resolve({
              ok: false,
              status: 'FAIL',
              error: stderr.trim() || 'Assertion thất bại',
              elapsed
            });
          }
          return resolve({
            ok: false,
            status: isUnit ? 'FAIL' : 'RE',
            error: stderr.trim() || `Chương trình thoát với mã lỗi ${code}`,
            elapsed
          });
        }

        resolve({ ok: true, status: 'OK', stdout, elapsed });
      });

      if (stdinText) {
        child.stdin.write(stdinText);
      }
      child.stdin.end();
    });
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString('utf8');
      if (body.length > 2 * 1024 * 1024) reject(new Error('Payload quá lớn'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('JSON không hợp lệ'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

  try {
    // API Routes
    if (urlPath === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { ok: true, compiler: 'gcc/g++', problemsLoaded: BASE_PROBLEMS.length });
    }

    if (urlPath === '/api/state' && req.method === 'GET') {
      return sendJson(res, 200, {
        classes: db.classes,
        customProblems: db.customProblems,
        testCasesByProblem: db.testCasesByProblem,
        solvedByUser: db.solvedByUser,
        submissions: db.submissions
      });
    }

    if (urlPath === '/api/login/student' && req.method === 'POST') {
      const { classId, name } = await readJsonBody(req);
      const cls = db.classes.find(c => c.id === classId);
      if (!cls) return sendJson(res, 404, { error: 'Không tìm thấy lớp học.' });
      const stu = cls.students.find(s => normalizeFullName(s.name) === normalizeFullName(name));
      if (!stu) {
        return sendJson(res, 401, { error: `Không tìm thấy học sinh "${String(name || '').trim()}" trong ${cls.name}.` });
      }
      return sendJson(res, 200, {
        user: { role: 'student', name: stu.name, code: stu.code, classId: cls.id, className: cls.name }
      });
    }

    if (urlPath === '/api/login/teacher' && req.method === 'POST') {
      const { username, pass } = await readJsonBody(req);
      if (String(username || '').trim() !== TEACHER_USER || String(pass || '') !== TEACHER_PASS) {
        return sendJson(res, 401, { error: 'Tên đăng nhập hoặc mật khẩu giáo viên không đúng.' });
      }
      return sendJson(res, 200, { user: { role: 'teacher', name: 'Giáo viên', code: 'GV' } });
    }

    if (urlPath === '/api/classes' && req.method === 'POST') {
      const { name } = await readJsonBody(req);
      const cleanName = String(name || '').trim();
      if (!cleanName) return sendJson(res, 400, { error: 'Tên lớp không được trống.' });
      if (db.classes.some(c => normalizeFullName(c.name) === normalizeFullName(cleanName))) {
        return sendJson(res, 409, { error: 'Lớp học này đã tồn tại.' });
      }
      const newCls = { id: 'cls_' + Date.now(), name: cleanName, students: [] };
      db.classes.push(newCls);
      saveDb(db);
      return sendJson(res, 200, { classItem: newCls, classes: db.classes });
    }

    const delClassMatch = urlPath.match(/^\/api\/classes\/([^/]+)$/);
    if (delClassMatch && req.method === 'DELETE') {
      const cid = delClassMatch[1];
      db.classes = db.classes.filter(c => c.id !== cid);
      saveDb(db);
      return sendJson(res, 200, { classes: db.classes });
    }

    const addStuMatch = urlPath.match(/^\/api\/classes\/([^/]+)\/students$/);
    if (addStuMatch && req.method === 'POST') {
      const cid = addStuMatch[1];
      const cls = db.classes.find(c => c.id === cid);
      if (!cls) return sendJson(res, 404, { error: 'Không tìm thấy lớp.' });
      const { name, code } = await readJsonBody(req);
      const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
      if (!cleanName) return sendJson(res, 400, { error: 'Họ tên không được trống.' });
      if (cls.students.some(st => normalizeFullName(st.name) === normalizeFullName(cleanName))) {
        return sendJson(res, 409, { error: `Học sinh "${cleanName}" đã có trong ${cls.name}.` });
      }
      const stuCode = String(code || '').trim() || ('HV' + String(cls.students.length + 1).padStart(2, '0'));
      const newStu = { id: 'stu_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), name: cleanName, code: stuCode };
      cls.students.push(newStu);
      saveDb(db);
      return sendJson(res, 200, { student: newStu, classes: db.classes });
    }

    const delStuMatch = urlPath.match(/^\/api\/classes\/([^/]+)\/students\/([^/]+)$/);
    if (delStuMatch && req.method === 'DELETE') {
      const [, cid, sid] = delStuMatch;
      const cls = db.classes.find(c => c.id === cid);
      if (cls) {
        cls.students = cls.students.filter(st => st.id !== sid);
        saveDb(db);
      }
      return sendJson(res, 200, { classes: db.classes });
    }

    if (urlPath === '/api/problems' && req.method === 'POST') {
      const { problem } = await readJsonBody(req);
      if (!problem || !problem.id) return sendJson(res, 400, { error: 'Dữ liệu bài tập không hợp lệ.' });
      db.customProblems.push(problem);
      saveDb(db);
      return sendJson(res, 200, { problem });
    }

    const delProbMatch = urlPath.match(/^\/api\/problems\/([^/]+)$/);
    if (delProbMatch && req.method === 'DELETE') {
      const pid = delProbMatch[1];
      db.customProblems = db.customProblems.filter(p => p.id !== pid);
      saveDb(db);
      return sendJson(res, 200, { ok: true });
    }

    const tcMatch = urlPath.match(/^\/api\/problems\/([^/]+)\/testcases$/);
    if (tcMatch && req.method === 'PUT') {
      const pid = tcMatch[1];
      const { testCases } = await readJsonBody(req);
      db.testCasesByProblem[pid] = Array.isArray(testCases) ? testCases : [];
      saveDb(db);
      return sendJson(res, 200, { ok: true });
    }

    if (urlPath === '/api/submissions' && req.method === 'DELETE') {
      db.submissions = {};
      db.solvedByUser = {};
      saveDb(db);
      return sendJson(res, 200, { ok: true });
    }

    if (urlPath === '/api/run' && req.method === 'POST') {
      const { code, stdin } = await readJsonBody(req);
      const result = await compileAndRunGCC({ sourceCode: String(code || ''), stdinText: String(stdin || ''), isUnit: false });
      return sendJson(res, 200, result);
    }

    if (urlPath === '/api/submit' && req.method === 'POST') {
      const { problemId, code, user, chosenOption } = await readJsonBody(req);
      if (!user || !user.name) return sendJson(res, 401, { error: 'Vui lòng đăng nhập trước khi nộp bài.' });
      const p = getProblemById(problemId);
      if (!p) return sendJson(res, 404, { error: 'Không tìm thấy bài tập.' });

      const userKey = `${user.role}_${user.code || user.name}`.toLowerCase();
      const nowStr = new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      if (p.type === 'quiz') {
        const isCorrect = Number(chosenOption) === Number(p.correctIndex);
        const letters = ['A', 'B', 'C', 'D'];
        const overallStatus = isCorrect ? 'AC' : 'WA';
        const score = isCorrect ? 100 : 0;
        const passed = isCorrect ? 1 : 0;
        if (isCorrect) {
          if (!db.solvedByUser[userKey]) db.solvedByUser[userKey] = [];
          if (!db.solvedByUser[userKey].includes(p.id)) db.solvedByUser[userKey].push(p.id);
        }
        const subRecord = {
          id: 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          studentName: user.name,
          studentCode: user.code || 'GV',
          classId: user.classId || '',
          className: user.className || 'Chưa phân lớp',
          problemId: p.id,
          problemTitle: p.title,
          session: p.session || 1,
          timestamp: nowStr,
          status: overallStatus,
          score,
          passed,
          total: 1,
          elapsed: 1,
          code: `Đáp án đã chọn: ${letters[chosenOption]}. ${(p.options || [])[chosenOption] || ''}`
        };
        if (!db.submissions[p.id]) db.submissions[p.id] = [];
        db.submissions[p.id].unshift(subRecord);
        saveDb(db);
        return sendJson(res, 200, { isQuiz: true, isCorrect, overallStatus, score, passed, total: 1, submission: subRecord });
      }

      const results = [];
      let passed = 0;
      let totalElapsed = 0;
      let firstError = null;
      let overallStatus = 'AC';

      for (let i = 0; i < p.testCases.length; i++) {
        const tc = p.testCases[i];
        const runRes = await compileAndRunGCC({ sourceCode: String(code || ''), isUnit: true, testCode: tc.code || '' });
        totalElapsed += runRes.elapsed;
        if (!runRes.ok) {
          if (runRes.status === 'FAIL') {
            if (overallStatus === 'AC') overallStatus = 'WA';
            results.push({ index: i + 1, hidden: tc.hidden, testCode: tc.code || '', actual: runRes.error, passed: false, elapsed: runRes.elapsed });
          } else {
            overallStatus = runRes.status;
            firstError = runRes.error;
            results.push({ index: i + 1, hidden: tc.hidden, testCode: tc.code || '', actual: `[${runRes.status}] ${runRes.error}`, passed: false, elapsed: runRes.elapsed });
            if (runRes.status === 'CE') break;
          }
        } else {
          passed++;
          results.push({ index: i + 1, hidden: tc.hidden, testCode: tc.code || '', actual: 'Tất cả assertion đều đạt (PASS)', passed: true, elapsed: runRes.elapsed });
        }
      }

      const total = p.testCases.length;
      const score = total > 0 ? Math.round((passed / total) * 100) : 0;
      if (passed === total) {
        overallStatus = 'AC';
        if (!db.solvedByUser[userKey]) db.solvedByUser[userKey] = [];
        if (!db.solvedByUser[userKey].includes(p.id)) db.solvedByUser[userKey].push(p.id);
      }

      const subRecord = {
        id: 'sub_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        studentName: user.name,
        studentCode: user.code || 'GV',
        classId: user.classId || '',
        className: user.className || 'Chưa phân lớp',
        problemId: p.id,
        problemTitle: p.title,
        session: p.session || 1,
        timestamp: nowStr,
        status: overallStatus,
        score,
        passed,
        total,
        elapsed: totalElapsed,
        code: String(code || '')
      };
      if (!db.submissions[p.id]) db.submissions[p.id] = [];
      db.submissions[p.id].unshift(subRecord);
      saveDb(db);

      return sendJson(res, 200, {
        isQuiz: false,
        overallStatus,
        score,
        passed,
        total,
        totalElapsed,
        firstError,
        results,
        submission: subRecord
      });
    }

    // Static file serving
    let filePath = path.join(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: err.message || 'Internal Server Error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`C-Lab Judge Server running at http://0.0.0.0:${PORT} (GCC/G++ ready)`);
});
