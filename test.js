const fs = require('fs');
const vm = require('vm');
const path = require('path');

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log('  PASS  ' + name);
  } else {
    failed += 1;
    console.log('  FAIL  ' + name + (detail ? ' -> ' + detail : ''));
  }
}

class FakeClassList {
  constructor(el) { this.el = el; }
  _set() { return new Set(String(this.el.className || '').split(/\s+/).filter(Boolean)); }
  add(...names) { const s = this._set(); names.forEach(n => s.add(n)); this.el.className = [...s].join(' '); }
  remove(...names) { const s = this._set(); names.forEach(n => s.delete(n)); this.el.className = [...s].join(' '); }
  contains(name) { return this._set().has(name); }
}

class FakeElement {
  constructor(tag, document) {
    this.tagName = String(tag || 'div').toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this.type = '';
    this.name = '';
    this.href = '';
    this.target = '';
    this.rel = '';
    this._id = '';
    this._text = '';
    this.className = '';
    this.classList = new FakeClassList(this);
  }
  set id(v) {
    this._id = String(v || '');
    if (this._id) this.ownerDocument.byId[this._id] = this;
  }
  get id() { return this._id; }
  set textContent(v) { this.children = []; this._text = String(v == null ? '' : v); }
  get textContent() { return this._text + this.children.map(c => c.textContent || '').join(''); }
  set innerHTML(v) { this.children = []; this._text = String(v || ''); }
  get innerHTML() { return this.textContent; }
  appendChild(child) { this.children.push(child); child.parentNode = this; return child; }
  append(...children) { children.forEach(c => this.appendChild(c)); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  dispatchEvent(event) {
    const ev = event || { type: 'click' };
    (this.listeners[ev.type] || []).forEach(fn => fn.call(this, ev));
    return true;
  }
  click() { this.dispatchEvent({ type: 'click', preventDefault() {} }); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this.id = value; }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  focus() {}
  scrollIntoView() {}
  querySelectorAll(selector) { const tags = selector.toUpperCase().split(','); return walk(this).filter(e=>tags.includes(e.tagName)); }
  querySelector(selector) {
    if (selector.startsWith('#')) return walk(this).find(e => e.id === selector.slice(1));
    if (selector === 'button') return walk(this).find(e => e.tagName === 'BUTTON');
    if (selector === '.err') return walk(this).find(e => e !== this && e.classList.contains('err')) || null;
    if (selector === 'input,select,textarea') {
      return walk(this).find(e => ['INPUT','SELECT','TEXTAREA'].includes(e.tagName)) || null;
    }
    return null;
  }
}

class FakeDocument {
  constructor() { this.byId = {}; }
  createElement(tag) { return new FakeElement(tag, this); }
  createTextNode(text) { const n = new FakeElement('#text', this); n.textContent = text; return n; }
  getElementById(id) {
    if (!this.byId[id]) { const e = this.createElement('div'); e.id = id; }
    return this.byId[id];
  }
  querySelectorAll(selector) {
    const roots = Object.values(this.byId);
    const all = [];
    roots.forEach(r => walk(r).forEach(e => { if (!all.includes(e)) all.push(e); }));
    if (selector === '[data-eg]') return all.filter(e => e.getAttribute('data-eg') !== null);
    const checked = selector.match(/^\.([a-z0-9_-]+):checked$/i);
    if (checked) return all.filter(e => e.classList.contains(checked[1]) && e.checked);
    if (selector === '.f.bad') return all.filter(e => e.classList.contains('f') && e.classList.contains('bad'));
    return [];
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function walk(root, out = []) {
  out.push(root);
  (root.children || []).forEach(c => walk(c, out));
  return out;
}
function findByText(root, tag, prefix) {
  return walk(root).find(e => e.tagName === tag.toUpperCase() && e.textContent.trim().startsWith(prefix));
}

function loadFrontend(keywordOverrides = {}) {
  const htmlPath = path.join(__dirname, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (scripts.length < 2) throw new Error('Expected CONFIG and application scripts.');

  const document = new FakeDocument();
  ['tab-upload','tab-record','tab-retrieve','p-upload','p-record','p-retrieve','q','backbar','picker','recordBody','retrieveFilters','results','readback','chip','chipId']
    .forEach(id => document.getElementById(id));

  const posts = [];
  const transferred = [];
  const context = {
    console,
    document,
    setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,1)),
    clearTimeout,
    Promise,
    Date,
    JSON,
    Math,
    Array,
    Object,
    String,
    Number,
    RegExp,
    encodeURIComponent,
    XMLHttpRequest: class {
      constructor(){ this.upload={}; }
      open() {}
      setRequestHeader(name,value){if(name==='Content-Range')this.range=value;}
      getResponseHeader(){return 'bytes=0-16777215';}
      send(body){
        transferred.push(this.range);
        if(transferred.length===2){this.onerror();return;}
        this.status=body && transferred.length>2 ? 200 : 308;
        this.onload();
      }
    },
    Option: function Option(text, value) {
      const o = document.createElement('option');
      o.textContent = text;
      o.value = value === undefined ? text : value;
      return o;
    },
    fetch(url, options) {
      if (options && options.method === 'POST') {
        const body = JSON.parse(options.body);
        posts.push(body);
        if(body.action==='beginUpload')return Promise.resolve({ok:true,json:async()=>({ok:true,session:'https://example.test/upload'})});
        if(body.action==='saveUpload' && posts.filter(p=>p.action==='saveUpload').length===1) return Promise.reject(Error('Lost save response'));
        if(body.action==='saveUpload')return Promise.resolve({ok:true,json:async()=>({ok:true,id:'AKR-0001',next:'AKR-0002',driveLink:'https://drive.google.com/open?id=mockFile123'})});
        if (body.action === 'addFolder') {
          const parentPath = String(body.parentPath || '').trim();
          const fullPath = parentPath ? parentPath + ' > ' + body.name : body.name;
          const u = 'https://drive.google.com/drive/folders/' + fullPath.replace(/[^a-z0-9]+/gi, '_');
          const folders = {};
          folders[body.library + ' > ' + fullPath] = u;
          if (parentPath) folders[body.library + ' > ' + parentPath] = 'https://drive.google.com/drive/folders/PARENT_' + parentPath.replace(/[^a-z0-9]+/gi, '_');
          return Promise.resolve({ ok:true, json: () => Promise.resolve({
            ok: true, library: body.library, parentPath, path: fullPath,
            name: body.name, url: u, parentUrl: folders[body.library + ' > ' + parentPath] || '',
            existed: false, folders
          }) });
        }
        if (body.action === 'addClient') {
          const u = 'https://drive.google.com/drive/folders/CLIENT_' + body.name.replace(/[^a-z0-9]+/gi, '_');
          return Promise.resolve({ ok:true, json: () => Promise.resolve({
            ok: true, name: body.name, industry: body.industry, url: u,
            folders: { ['01 Clients > ' + body.name]: u }
          }) });
        }
        if (body.action === 'addPerson') {
          const u = 'https://drive.google.com/drive/folders/PERSON_' + body.name.replace(/[^a-z0-9]+/gi, '_');
          return Promise.resolve({ ok:true, json: () => Promise.resolve({
            ok: true, name: body.name, language: body.language, url: u,
            folders: { ['04 People > ' + body.name]: u }
          }) });
        }
        return Promise.resolve({ ok:true, json: () => Promise.resolve({ ok: true, id: 'AKR-0001', next: 'AKR-0002' }) });
      }
      return Promise.resolve({ ok:true, json: () => Promise.resolve({ ok: true, clients: [], people: [], folders: {}, next: 'AKR-0001' }) });
    }
  };
  context.window = context;
  context.window.scrollTo = function() {};
  vm.createContext(context);
  vm.runInContext(scripts[0] + ';CONFIG.ENDPOINT="https://example.test/exec";', context, { filename: 'config.js' });
  const seed = vm.runInContext('KEYWORD_SEED', loadBackend().context);
  context.seed = { ...seed, ...keywordOverrides };
  const appScript = scripts[scripts.length - 1].replace(/\nboot\(\);\n/, '\napplyKeywords(seed);\n');
  vm.runInContext(appScript, context, { filename: 'app.js' });
  return { html, context, document, app: context.__AKR, posts, transferred };
}

let driveId = 0;
class FileItem {
  constructor(name, mimeType = 'application/pdf', size = 500000) {
    this.name = name;
    this.mimeType = mimeType;
    this.size = size;
    this.trashed = false;
  }
  getName() { return this.name; }
  getMimeType() { return this.mimeType; }
  getSize() { return this.size; }
  setTrashed(value) { this.trashed = !!value; return this; }
}
class Folder {
  constructor(name) {
    this.name = name;
    this.children = [];
    this.files = [];
    this.trashed = false;
    this.id = ++driveId;
    this.created = 0;
  }
  getName() { return this.name; }
  getId() { return 'F' + this.id; }
  getUrl() { return 'https://drive.google.com/drive/folders/F' + this.id; }
  _iterator(items) { let i = 0; return { hasNext: () => i < items.length, next: () => items[i++] }; }
  getFoldersByName(name) { return this._iterator(this.children.filter(f => !f.trashed && f.name === name)); }
  getFolders() { return this._iterator(this.children.filter(f => !f.trashed)); }
  getFiles() { return this._iterator(this.files.filter(f => !f.trashed)); }
  createFolder(name) { this.created += 1; const f = new Folder(name); this.children.push(f); return f; }
  createFile(name, mimeType, size) { const f = new FileItem(name, mimeType, size); this.files.push(f); return f; }
  setTrashed(value) { this.trashed = !!value; return this; }
  child(name) { return this.children.find(f => !f.trashed && f.name === name); }
  activeChildren() { return this.children.filter(f => !f.trashed); }
  activeFiles() { return this.files.filter(f => !f.trashed); }
}

function colToNumber(letters) {
  let n = 0;
  for (const c of letters) n = n * 26 + c.charCodeAt(0) - 64;
  return n;
}
function parseA1(a1) {
  const m = String(a1).toUpperCase().match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
  if (!m) throw new Error('Unsupported A1 range: ' + a1);
  const row = Number(m[2]);
  const col = colToNumber(m[1]);
  const endRow = m[4] ? Number(m[4]) : row;
  const endCol = m[3] ? colToNumber(m[3]) : col;
  return [row, col, endRow - row + 1, endCol - col + 1];
}
class Range {
  constructor(sheet, row, col, rows, cols) { this.sheet = sheet; this.row = row; this.col = col; this.rows = rows; this.cols = cols; }
  _ensure(r, c) {
    while (this.sheet.data.length < r) this.sheet.data.push([]);
    while (this.sheet.data[r - 1].length < c) this.sheet.data[r - 1].push('');
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        this._ensure(this.row + r, this.col + c);
        row.push(this.sheet.data[this.row + r - 1][this.col + c - 1]);
      }
      out.push(row);
    }
    return out;
  }
  setValues(values) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this._ensure(this.row + r, this.col + c);
        this.sheet.data[this.row + r - 1][this.col + c - 1] = values[r][c];
      }
    }
    return this;
  }
  getValue() { return this.getValues()[0][0]; }
  setValue(value) { return this.setValues([[value]]); }
  clearContent() {
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      this._ensure(this.row + r, this.col + c);
      this.sheet.data[this.row + r - 1][this.col + c - 1] = '';
    }
    return this;
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setVerticalAlignment() { return this; }
  setWrapStrategy() { return this; }
  setFontColor() { return this; }
  setFontStyle() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.data = []; this.maxRows = 100; this.maxColumns = 26; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') [a, b, c, d] = parseA1(a);
    const rows = c || 1;
    const cols = d || 1;
    if (a < 1 || b < 1 || a + rows - 1 > this.maxRows || b + cols - 1 > this.maxColumns) {
      throw new Error('Range is outside the sheet grid.');
    }
    return new Range(this, a, b, rows, cols);
  }
  getLastRow() {
    for (let r = this.data.length - 1; r >= 0; r--) if ((this.data[r] || []).some(v => String(v).trim() !== '')) return r + 1;
    return 0;
  }
  getLastColumn() {
    let max = 0;
    this.data.forEach(r => { for (let c = r.length - 1; c >= 0; c--) if (String(r[c]).trim() !== '') { max = Math.max(max, c + 1); break; } });
    return max;
  }
  getMaxRows() { return Math.max(this.maxRows, this.data.length); }
  getMaxColumns() { return this.maxColumns; }
  insertRowsAfter(after, howMany) { this.maxRows += Number(howMany) || 0; }
  insertColumnsAfter(after, howMany) { this.maxColumns += Number(howMany) || 0; }
  appendRow(row) {
    if (this.data.length >= this.maxRows) this.maxRows += 1;
    if (row.length > this.maxColumns) this.maxColumns = row.length;
    this.data.push(row.slice());
    return this;
  }
  setFrozenRows() {}
  setRowHeight() {}
  setColumnWidth() {}
}
class Spreadsheet {
  constructor() { this.sheets = {}; }
  getSheetByName(name) { return this.sheets[name] || null; }
  insertSheet(name) { const sh = new Sheet(name); sh.getSheetId = () => Object.keys(this.sheets).indexOf(name); this.sheets[name] = sh; return sh; }
}

function loadBackend() {
  const code = fs.readFileSync(path.join(__dirname, 'Code.gs'), 'utf8');
  new vm.Script(code, { filename: 'Code.gs' });

  const parent = new Folder('PARENT');
  const repo = parent.createFolder('Alliance Knowledge Repository');
  const libraries = ['01 Clients','02 Content','03 Market & Sell','04 People','05 Research','06 Alliance IP','99 Archive'];
  libraries.forEach(name => repo.createFolder(name));
  repo.child('02 Content').createFolder('Leadership').createFile('sample.pdf');
  repo.child('01 Clients').createFolder('SAMPLE CLIENT').createFolder('01 Commercial');
  repo.child('99 Archive').createFile('old-sample.txt');
  repo.createFolder('UNEXPECTED ROOT SAMPLE').createFile('root-sample.pdf');
  repo.createFolder('02 Content').createFile('duplicate-main-sample.pdf');
  repo.createFile('loose-root-sample.txt');

  const ss = new Spreadsheet();
  const index = ss.insertSheet('Knowledge Index');
  index.maxColumns = 15;
  index.appendRow(['ID','Date Added','Title','Description','Drive Link','Doc Type','Topics','Client','People','Industry','Language','Library','Folder Path','Year','Status']);
  index.appendRow(['AKR-0001','2026-01-01','Sample','Sample description long enough','https://drive.google.com/file/d/1/view','Other','','','','','English','02 Content','Leadership',2026,'Active']);
  const lists = ss.insertSheet('Lists');
  lists.maxColumns = 5;
  lists.getRange('A1:E1').setValues([['Client','Industry','','Person','Language']]);
  lists.getRange(2, 1, 1, 5).setValues([['SAMPLE CLIENT','Energy','','Sample Person','English']]);
  const folders = ss.insertSheet('Folders');
  folders.maxRows = 2;
  folders.maxColumns = 2;
  folders.getRange('A1:B1').setValues([['Path','URL']]);
  folders.getRange(2, 1, 1, 2).setValues([['02 Content > Leadership','https://drive.google.com/drive/folders/OLD']]);

  Object.values(ss.sheets).forEach((t,i) => t.getSheetId = () => i);
  const props = {SHEET_ID:'test-sheet', PARENT_ID:'test-folder', UPLOADER_KEY:'uploader', TEAM_KEY:'team', ADMIN_KEY:'admin'};
  const driveFiles = {
    xyz: new FileItem('Workshop Guide.pdf', 'application/pdf', 3 * 1024 * 1024),
    googleDoc: new FileItem('Leadership Notes', 'application/vnd.google-apps.document', 0),
    legacyDoc: new FileItem('Legacy Deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 22 * 1024 * 1024)
  };
  const lock = { waited: false, released: false, hasLock() { return this.waited && !this.released; }, waitLock() { this.waited = true; this.released = false; }, releaseLock() { this.released = true; } };
  const context = {
    console,
    SpreadsheetApp: {
      flush() {},
      WrapStrategy: { WRAP: 'WRAP' },
      openById() { return ss; }
    },
    DriveApp: {
      getFolderById() { return parent; },
      getRootFolder() { return parent; },
      getFileById(id) {
        if (!driveFiles[id]) throw new Error('File not found: ' + id);
        return driveFiles[id];
      }
    },
    Sheets:{Spreadsheets:{batchUpdate({requests}){
      for (const {updateCells:{start,rows}} of requests){
        const tab = Object.values(ss.sheets).find(t => t.getSheetId() === start.sheetId);
        const values = rows.map(r => r.values.map(c => c.userEnteredValue.stringValue));
        tab.getRange(start.rowIndex+1, start.columnIndex+1, values.length, values[0].length).setValues(values);
      }
    }}},
    Drive:{Files:{
      generateIds(){return {ids:["reserved-test-id"]};},
      create(meta, blob){
        if (driveFiles[meta.id]) throw Error("ID already exists");
        driveFiles[meta.id] = {...meta,size:blob.length,webViewLink:"https://drive.google.com/open?id="+meta.id};
        return driveFiles[meta.id];
      },
      get(id){if (!driveFiles[id]) throw Error("Missing file"); return driveFiles[id];}
    }},
    LockService: { getScriptLock() { return lock; } },
    PropertiesService: { getScriptProperties() { return { getProperty(k) { return props[k] || ''; }, setProperty(k, v) { props[k] = v; } }; } },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(value) { return { value, setMimeType() { return this; } }; }
    },
    Utilities: {
      DigestAlgorithm:{SHA_256:"sha256"}, Charset:{UTF_8:"utf8"},
      computeDigest(algo, value, charset){ return Array.from(require("crypto").createHash(algo).update(value,charset).digest()); },
      base64Decode(s){return Array.from(Buffer.from(s,"base64"));}, newBlob(bytes){return bytes;}, formatDate() { return '2026-07-30 12:00'; }
    },
    Session: { getScriptTimeZone() { return 'Asia/Kolkata'; } },
    Logger: { log() {} },
    Date,
    JSON,
    String,
    Object,
    Array,
    Math
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'Code.gs' });
  vm.runInContext('json_ = function(o){ return o; };', context);
  return { context, parent, repo, ss, props, lock, code, libraries, driveFiles };
}

async function main() {
  console.log('\n===== FRONTEND: FLEXIBLE FOLDER FLOW =====');
  const f = loadFrontend();
  const { app, document, html, posts } = f;
  const picker = document.getElementById('picker');

  check('frontend script loads without a runtime exception', !!app);
  app.renderPicker();
  check('exactly seven fixed main folders are rendered', picker.children.length === 7);

  const contentButton = findByText(picker, 'button', '02 Content');
  check('02 Content is selectable', !!contentButton);
  contentButton.click();
  check('empty main folder offers folder creation', !!findByText(picker, 'button', '+ Create a folder here'));
  check('no predefined Content subfolders remain', !findByText(picker, 'button', 'Leadership'));
  check('files cannot be left loose in a main folder', !findByText(picker, 'button', 'Use this folder'));

  findByText(picker, 'button', '+ Create a folder here').click();
  document.byId.nf.value = 'Programmes';
  findByText(picker, 'button', 'Create folder').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  check('top-level folder request uses an empty parent path', posts.some(p => p.action === 'addFolder' && p.library === '02 Content' && p.parentPath === '' && p.name === 'Programmes'));
  check('after creation the operator is inside the new folder', app.S.nav.path === 'Programmes');
  check('new folder offers upload', !!findByText(picker, 'button', 'Use this folder'));
  check('new folder offers another nested folder', !!findByText(picker, 'button', '+ Create a subfolder here'));

  findByText(picker, 'button', '+ Create a subfolder here').click();
  document.byId.nf.value = 'Leadership 2026';
  findByText(picker, 'button', 'Create folder').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  check('nested folder request includes its complete parent path', posts.some(p => p.action === 'addFolder' && p.parentPath === 'Programmes' && p.name === 'Leadership 2026'));
  check('navigation supports folders inside folders', app.S.nav.path === 'Programmes > Leadership 2026');

  const exact = app.folderTarget('02 Content', 'Programmes > Leadership 2026');
  check('the exact selected nested folder URL is used when known', exact.exact === true && /Leadership_2026/.test(exact.url));
  findByText(picker, 'button', 'Use this folder').click();
  check('upload destination keeps the full nested path', app.S.dest && app.S.dest.folderPath === 'Programmes > Leadership 2026');
  check('Drive button opens the exact selected folder', app.S.dest && app.S.dest.exactFolder === true);
  check('chosen path collapses into one destination', document.byId.folderCaption.textContent.includes('Leadership 2026') && document.byId.folderPicker.open === false);

  app.S.dest = null;
  app.S.folders = {
    '02 Content': 'https://drive.google.com/drive/folders/CONTENT_MAIN',
    '02 Content > A': 'https://drive.google.com/drive/folders/A',
    '02 Content > A > B': 'https://drive.google.com/drive/folders/B',
    '02 Content > A > B > C': 'https://drive.google.com/drive/folders/C'
  };
  check('direct-child listing hides grandchildren', JSON.stringify(app.folderChildren('02 Content', 'A')) === JSON.stringify(['B']));
  check('deep child listing returns only the next level', JSON.stringify(app.folderChildren('02 Content', 'A > B')) === JSON.stringify(['C']));

  console.log('\n===== FRONTEND: CLIENTS, PEOPLE, RECORD AND RETRIEVE =====');
  app.S.nav = { lib:null, path:'' };
  app.S.clients = [{ name:'ADNOC GAS', industry:'Energy' }];
  app.S.people = [{ name:'Sara Haddad', language:'Arabic' }];
  app.S.folders = {
    '01 Clients':'https://drive.google.com/drive/folders/CLIENTS',
    '01 Clients > ADNOC GAS':'https://drive.google.com/drive/folders/ADNOC',
    '04 People':'https://drive.google.com/drive/folders/PEOPLE',
    '04 People > Sara Haddad':'https://drive.google.com/drive/folders/SARA'
  };
  app.renderPicker();
  findByText(picker, 'button', '01 Clients').click();
  check('Clients root keeps the purpose-built client creation option', !!findByText(picker, 'button', '+ Create a new client folder'));
  findByText(picker, 'button', 'ADNOC GAS').click();
  check('a selected client has no forced Commercial/Delivery/Relationship folders', !/01 Commercial|02 Delivery|03 Relationship/.test(picker.textContent));
  check('a selected client can create any subfolder needed', !!findByText(picker, 'button', '+ Create a subfolder here'));
  check('client name is derived from the first folder level', app.destinationExtra('01 Clients', 'ADNOC GAS > Project X > Contracts').client === 'ADNOC GAS');
  check('person name is derived from the first folder level', app.destinationExtra('04 People', 'Sara Haddad > Bios').person === 'Sara Haddad');

  app.S.dest = {
    library:'01 Clients', folderPath:'ADNOC GAS > Project X', client:'ADNOC GAS',
    url:'https://drive.google.com/drive/folders/PROJECT', exactFolder:true
  };
  app.renderRecord();
  const recordBody = document.getElementById('recordBody');
  const form = document.getElementById('recForm');
  const formIds = form.children.map(x => x.id);
  check('title is first and client is inferred from the folder',formIds[0] === 'f-title' && app.S.dest.client === 'ADNOC GAS');
  check('no manual link field or Record tab', !html.includes('id="tab-record"') && !formIds.includes('f-link'));
  check('record form uses tappable multi-select document types', !!document.byId.docChoices && findByText(document.byId.docChoices, 'button', 'Framework'));
  check('record form has one combined Tags and Keywords section', !!document.byId.recordKeywordBrowser && !!findByText(recordBody, 'summary', 'Tags and Keywords'));
  check('Topic is visible without opening optional details', recordBody.textContent.includes('Topic') && !!document.byId.topic);
  check('approved tag groups are present', ['What is it for?','Who is it for?','How is it used?','Style and features','Region','Language'].every(x => recordBody.textContent.includes(x)));
  const approvedTagValues = [
    'Client Delivery','Learning Material','Sales Material','Marketing Material','Research','Alliance IP','Internal Use','Planning','Reporting','Proposal Support',
    'Executives','Senior Leaders','Managers','Employees','Participants','Facilitators','Coaches','HR','Learning & Development','Client Team','Internal Team',
    'Workshop','Learning Programme','Presentation','Coaching','Keynote','Webinar','Meeting','Offsite','Self-Paced Learning','Train the Trainer',
    'Editable','Print Ready','Presentation Ready','Client Ready','Interactive','Visual','One Page','Executive Summary','Customisable','Reusable','Practical','Strategic',
    'UAE','Saudi Arabia','GCC','Middle East','MENA','Global','English','Arabic','English & Arabic','French','Multiple Languages','Other Language'
  ];
  const actualTagValues = app.TAG_GROUPS.filter(g => g.key !== 'topic').flatMap(g => g.values);
  const addedValues = ['Zulu', 'stage 10', 'alpha', 'Stage 2', 'Bravo'];
  const updatedCatalog = loadFrontend({custom:addedValues}).app.TAG_GROUPS;
  check('new keywords sort within their group regardless of insertion order, case, or number', updatedCatalog.find(g => g.key === 'custom').values.join('|') === 'alpha|Bravo|Stage 2|stage 10|Zulu');
  check('the full approved Tags and Keywords list is present without omissions', approvedTagValues.every(v => actualTagValues.includes(v)) && actualTagValues.length === approvedTagValues.length);
  check('Stage group has been removed', !recordBody.textContent.includes('What stage is it at?') && !html.includes('What stage is it at?'));
  check('selected summary is kept in the live form', recordBody.textContent.includes('Selected') && recordBody.textContent.includes('English'));
  check('client record stays locked to its client', app.plan({ library:'01 Clients' }).client === 'locked');
  check('Industry stays hidden in normal records and is requested only for Research', !Object.prototype.hasOwnProperty.call(document.byId, 'industry') && app.plan({ library:'05 Research' }).industry === 'ask');
  check('People records no longer use a separate topic field', !Object.prototype.hasOwnProperty.call(app.plan({ library:'04 People' }), 'topics'));

  findByText(document.byId.docChoices, 'button', 'Framework').click();
  findByText(document.byId.docChoices, 'button', 'Slide Deck').click();
  check('document types change state by tapping the option', app.S.record.docTypes.join(', ') === 'Framework, Slide Deck');
  document.byId.topic.value='Leadership'; document.byId.topic.dispatchEvent({type:'change'});
  check('a Topic is selected by tapping it inside Tags and Keywords', app.S.record.selected.some(x => x.kind === 'topic' && x.value === 'Leadership'));
  check('keyword changes have a dedicated manager', html.includes('Manage keywords') && !document.byId.newTopic);
  app.S.record.selected.push({ kind:'purpose', value:'Client Delivery' });
  app.S.record.selected.push({ kind:'usage', value:'Workshop' });
  app.S.record.selected.push({ kind:'features', value:'Reusable' });
  document.byId.title.value = '2025 - ADNOC GAS - Own The Room Framework - v1';
  document.byId.desc.value = 'A reusable leadership framework for an executive client workshop.';
  const pickerInput=document.byId.uploadFile;
  const chosen={name:'2025 - ADNOC GAS - Own The Room Framework - v1',size:16777217,type:'text/plain',slice:(start,end)=>({size:end-start})};
  pickerInput.dispatchEvent({type:'change',target:{files:[chosen]}});
  const xhr = f.context.XMLHttpRequest.prototype, sendChunk = xhr.send;
  let rejectedChunks = 0;
  xhr.send = function(){
    rejectedChunks++;
    this.status = 403;
    this.responseText = JSON.stringify({error:{errors:[{reason:'storageQuotaExceeded'}]}});
    this.onload();
  };
  form.dispatchEvent({type:'submit',preventDefault(){}});
  await new Promise(resolve=>setTimeout(resolve,20));
  check('Drive storage rejection stops after one chunk and shows an actionable warning', rejectedChunks===1 &&
    document.byId.formerr.textContent.includes('Drive owner to free up space') && document.byId.uploadProgress.hidden);
  check('storage failure keeps the file details ready for Retry and does not index the file',
    document.byId.go.textContent==='Retry' && document.byId.title.value===chosen.name && !posts.some(p=>p.action==='saveUpload'));
  xhr.send = sendChunk;
  const sessionsBeforeRetry = posts.filter(p=>p.action==='beginUpload').length;
  form.dispatchEvent({ type:'submit', preventDefault() {} });
  await new Promise(resolve => setTimeout(resolve, 20));
  check('interrupted upload queries Drive and resumes at the confirmed byte',f.transferred.join('|')===
    'bytes 0-16777215/16777217|bytes 16777216-16777216/16777217|bytes */16777217|bytes 16777216-16777216/16777217');
  check('failed indexing offers retry while preserving form details', document.byId.go.textContent==='Retry' && document.byId.title.value===chosen.name);
  form.dispatchEvent({type:'submit',preventDefault(){}});
  await new Promise(resolve=>setTimeout(resolve,0));
  check('index retry reuses one upload and produces the success view', posts.filter(p=>p.action==='beginUpload').length===sessionsBeforeRetry+1 &&
    posts.filter(p=>p.action==='saveUpload').length===2 && recordBody.textContent.includes('File saved'));
  const recordPost = posts.filter(x => x.action === 'saveUpload').slice(-1)[0];
  check('record submission stores every checked document type', recordPost && recordPost.docType === 'Framework, Slide Deck');
  check('topics are stored in the existing Topics field', recordPost && recordPost.topics === 'Leadership');
  check('approved keyword groups are stored together', recordPost && /Client Delivery/.test(recordPost.tags) && /Workshop/.test(recordPost.tags) && /Reusable/.test(recordPost.tags));
  check('the document year is taken from the title automatically', recordPost && recordPost.year === 2025);

  app.S.records = [
    { id:'AKR-1', title:'Executive Presence Workbook', description:'Participant workbook for senior leaders', tags:'Learning Material, Executives, Keynote, Reusable', driveLink:'https://drive.google.com/file/d/1/view', docType:'Workbook, Framework', topics:'Leadership', client:'', people:'', industry:'', language:'English', library:'02 Content', folderPath:'Programmes > Executive Presence', year:2026, status:'Active', fileFormat:'PDF', fileSize:'Under 1 MB' },
    { id:'AKR-2', title:'ADNOC AI Proposal', description:'AI proposal for ADNOC', tags:'Client Delivery, Workshop, Executives', driveLink:'https://drive.google.com/file/d/2/view', docType:'Proposal, Slide Deck', topics:'Artificial Intelligence', client:'ADNOC GAS', people:'Sara Haddad', industry:'Energy', language:'English & Arabic', library:'03 Market & Sell', folderPath:'ADNOC GAS > AI Proposal', year:2025, status:'Active', fileFormat:'PowerPoint', fileSize:'1-10 MB' },
    { id:'AKR-3', title:'Sara Haddad Biography', description:'Arabic facilitator for AI programmes', tags:'Internal Use, Facilitators', driveLink:'https://drive.google.com/file/d/3/view', docType:'CV / Biography', topics:'Artificial Intelligence', client:'', people:'Sara Haddad', industry:'', language:'Arabic', library:'04 People', folderPath:'Sara Haddad', year:2026, status:'Active', fileFormat:'Google Doc', fileSize:'Google file' },
    { id:'AKR-4', title:'Government Sector Trends', description:'Sector evidence and reference material.', tags:'Strategic', driveLink:'https://drive.google.com/file/d/4/view', docType:'Report', topics:'Future of Work', client:'', people:'', industry:'Government', language:'English', library:'05 Research', folderPath:'Sector Reports', year:2026, status:'Active', fileFormat:'PDF', fileSize:'10-50 MB' },
    { id:'AKR-5', title:'Campaign Evidence Pack', description:'Evidence used to support a marketing campaign.', tags:'Research, Marketing Material', driveLink:'https://drive.google.com/file/d/5/view', docType:'Slide Deck', topics:'Innovation', client:'', people:'', industry:'', language:'English', library:'03 Market & Sell', folderPath:'Campaigns', year:2026, status:'Active', fileFormat:'PowerPoint', fileSize:'1-10 MB' },
    { id:'AKR-6', title:'Legacy Finance Reference', description:'An older record created before tags and file metadata existed.', driveLink:'https://drive.google.com/file/d/6/view', docType:'Report', topics:'Leadership', client:'', people:'', industry:'Banking & Finance', language:'English', library:'05 Research', folderPath:'Legacy', year:2024, status:'Active' }
  ];
  app.buildFacets();
  check('a selected keyword can retrieve a tagged file', app.runSearch('keynote').hits[0].r.id === 'AKR-1');
  check('existing records remain searchable through normal words and aliases', app.runSearch('rfp adnoc').hits[0].r.id === 'AKR-2');
  check('older records without Tags, File Format or File Size remain searchable', app.runSearch('legacy finance').hits[0].r.id === 'AKR-6');
  check('existing AI alias still resolves', app.parseQuery('ai').facets.some(x => x.value === 'Artificial Intelligence'));
  check('existing “who can” people search still works', app.runSearch('who can deliver AI in arabic').hits[0].r.library === '04 People');
  check('multi-select document types remain filterable', app.runSearch('slide deck adnoc').hits[0].r.id === 'AKR-2');
  check('typed Research keeps the original Research-library meaning', app.parseQuery('research').facets.some(x => x.kind === 'library' && x.value === '05 Research') && app.runSearch('research').hits[0].r.id === 'AKR-4');
  check('the Research purpose tag is still available as a tapped filter', app.runSearch('', { facets:[{ kind:'purpose', value:'Research', source:'tap' }], free:[] }).hits[0].r.id === 'AKR-5');
  check('English and Arabic is recognised as one language filter', app.parseQuery('english and arabic').facets.some(x => x.kind === 'language' && x.value === 'English & Arabic'));
  check('file format is searchable and filterable', app.runSearch('pdf').hits.some(x => x.r.id === 'AKR-1'));
  check('file size works as a tappable filter', app.runSearch('', { facets:[{ kind:'fileFormat', value:'PDF', source:'tap' }, { kind:'fileSize', value:'Under 1 MB', source:'tap' }], free:[] }).hits[0].r.id === 'AKR-1');
  const tapped = { facets:[
    { kind:'purpose', value:'Client Delivery', source:'tap' },
    { kind:'usage', value:'Workshop', source:'tap' }
  ], free:[] };
  check('tapped filters work across categories with AND logic', app.runSearch('', tapped).hits[0].r.id === 'AKR-2');

  app.S.retrieve.filters = [];
  app.S.retrieve.activeTag = '';
  app.renderRetrieveFilters();
  const retrieveFilters = document.getElementById('retrieveFilters');
  check('Retrieve contains the same Tags and Keywords groups', ['Topic','What is it for?','Who is it for?','How is it used?','Style and features','Region','Language'].every(x => retrieveFilters.textContent.includes(x)));
  check('Retrieve also offers Client, Document Type, File Format, File Size and Year', ['Client','Document Type','File Format','File Size','Year'].every(x => retrieveFilters.textContent.includes(x)));
  findByText(retrieveFilters, 'button', 'What is it for?').click();
  findByText(document.getElementById('retrieveFilters'), 'button', 'Client Delivery').click();
  check('users can tap a keyword in Retrieve without typing', app.S.retrieve.filters.some(x => x.kind === 'purpose' && x.value === 'Client Delivery'));
  check('tapped Retrieve filters return matching results with an empty search box', document.getElementById('results').textContent.includes('ADNOC AI Proposal'));
  app.S.retrieve.filters = [];
  app.S.retrieve.activeTag = '';
  app.renderRetrieveFilters();
  findByText(document.getElementById('retrieveFilters'), 'button', 'File Format').click();
  findByText(document.getElementById('retrieveFilters'), 'button', 'PDF').click();
  findByText(document.getElementById('retrieveFilters'), 'button', 'File Size').click();
  findByText(document.getElementById('retrieveFilters'), 'button', 'Under 1 MB').click();
  check('File Format and File Size can both be applied by tapping', app.S.retrieve.filters.some(x => x.kind === 'fileFormat' && x.value === 'PDF') && app.S.retrieve.filters.some(x => x.kind === 'fileSize' && x.value === 'Under 1 MB'));
  check('combined quick filters immediately update the results', document.getElementById('results').textContent.includes('Executive Presence Workbook') && !document.getElementById('results').textContent.includes('Government Sector Trends'));
  check('safeLink accepts Drive links', app.safeLink('https://drive.google.com/file/d/x/view') === true);
  check('safeLink rejects javascript links', app.safeLink('javascript:alert(1)') === false);
  check('no previous account folder links are embedded', !html.includes('FOLDER_LINKS'));
  check('no fixed client subfolder vocabulary remains', !html.includes('var CLIENT_SUBS'));

  console.log('\n===== APPS SCRIPT: RESET, SETUP AND NESTED FOLDERS =====');
  const b = loadBackend();
  b.context.resetForGoLive();
  const repo = b.parent.child('Alliance Knowledge Repository');
  check('go-live reset preserves all seven main folders', b.libraries.every(name => !!repo.child(name)));
  check('go-live reset leaves exactly the seven fixed folders at repository root', repo.activeChildren().length === 7 && repo.activeFiles().length === 0);
  check('go-live reset removes all sample subfolders and files', b.libraries.every(name => repo.child(name).activeChildren().length === 0 && repo.child(name).activeFiles().length === 0));
  check('go-live reset clears sample records', b.ss.getSheetByName('Knowledge Index').getLastRow() === 1);
  const listSheet = b.ss.getSheetByName('Lists');
  check('go-live reset clears sample client and person lists', !listSheet.data.slice(1).some(r => String(r[0] || '').trim() || String(r[3] || '').trim()));
  check('setup seeds managed topics', b.context.keywords_(b.ss).topic.includes('Leadership'));
  check('go-live reset keeps Tags & Keywords at column 16', b.ss.getSheetByName('Knowledge Index').getRange(1, 16).getValue() === 'Tags & Keywords');
  check('setup appends File Format and File Size as columns 17 and 18', b.ss.getSheetByName('Knowledge Index').getRange(1, 17).getValue() === 'File Format' && b.ss.getSheetByName('Knowledge Index').getRange(1, 18).getValue() === 'File Size');
  check('setup safely expands an older 15-column Knowledge Index', b.ss.getSheetByName('Knowledge Index').getMaxColumns() >= 18);
  check('folder index expands beyond its previous row limit', b.ss.getSheetByName('Folders').getMaxRows() >= 8);
  check('go-live reset is protected against a second run', (() => { try { b.context.resetForGoLive(); return false; } catch (e) { return /already been completed/i.test(String(e)); } })());

  const client = b.context.addClient_({ name:'ADNOC GAS', industry:'Energy' });
  const clientRoot = repo.child('01 Clients').child('ADNOC GAS');
  check('new client creates only one client folder', client.ok === true && clientRoot && clientRoot.activeChildren().length === 0);
  check('new client does not recreate Commercial/Delivery/Relationship', !clientRoot.child('01 Commercial') && !clientRoot.child('02 Delivery') && !clientRoot.child('03 Relationship'));

  const project = b.context.addFolder_({ library:'01 Clients', parentPath:'adnoc gas', name:'Own The Room' });
  check('folder creation accepts an existing parent case-insensitively', project.ok === true && project.parentPath === 'ADNOC GAS');
  check('client project folder is created under the client', !!clientRoot.child('Own The Room'));
  const delivery = b.context.addFolder_({ library:'01 Clients', parentPath:'ADNOC GAS > own the room', name:'Delivery Files' });
  check('folders can be created inside folders at arbitrary useful depth', delivery.ok === true && delivery.path === 'ADNOC GAS > Own The Room > Delivery Files');
  check('nested path and URL are written to the Folders map', !!b.ss.getSheetByName('Folders').data.some(r => r[0] === '01 Clients > ADNOC GAS > Own The Room > Delivery Files'));

  const content = b.context.addFolder_({ library:'02 Content', parentPath:'', name:'Leadership Programmes' });
  const contentNested = b.context.addFolder_({ library:'02 Content', parentPath:'leadership programmes', name:'Participant Materials' });
  check('non-client libraries support top-level and nested creation', content.ok === true && contentNested.ok === true);
  const before = repo.child('02 Content').child('Leadership Programmes').activeChildren().length;
  const reused = b.context.addFolder_({ library:'02 Content', parentPath:'Leadership Programmes', name:'participant materials' });
  const after = repo.child('02 Content').child('Leadership Programmes').activeChildren().length;
  check('case-insensitive nested folder reuse prevents duplicates', reused.existed === true && before === after);
  check('generic client root creation is blocked so metadata is not lost', b.context.addFolder_({ library:'01 Clients', parentPath:'', name:'Wrong Route' }).ok === false);
  check('generic People root creation is blocked so metadata is not lost', b.context.addFolder_({ library:'04 People', parentPath:'', name:'Wrong Route' }).ok === false);
  check('missing parent paths are rejected', b.context.addFolder_({ library:'05 Research', parentPath:'Missing', name:'Child' }).ok === false);
  check('folder delimiter characters are rejected', b.context.addFolder_({ library:'05 Research', parentPath:'', name:'A > B' }).ok === false);

  console.log('\n===== APPS SCRIPT: RECORD AND RETRIEVE DATA =====');
  const post = (action, payload = {}, accessKey = "uploader") => b.context.doPost({postData:{contents:JSON.stringify({action, accessKey, ...payload})}});
  check('index requires repository access', !post('records', {}, '').ok && !post('records', {}, 'team').ok && !post('init', {}, 'admin').ok && post('init').admin);
  check('retired keys cannot edit keywords', !post('editKeyword', {operation:'add',group:'topic',value:'Blocked'}, 'team').ok);
  check('admins can add a keyword', post('editKeyword',{operation:'add',group:'topic',value:'Customer Experience'}).ok);
  post('editKeyword',{operation:'add',group:'custom',value:'Own The Room'});
  check('duplicate keywords rejected ignoring case', !post('editKeyword',{operation:'add',group:'topic',value:'customer experience'}).ok);
  const deviceFile = {uploadId:'device-upload-boundary',name:'guide.bin',mime:'application/octet-stream',
    size:1000000000,library:'02 Content',folderPath:'Leadership Programmes'};
  const session = 'https://www.googleapis.com/upload/drive/v3/files?upload_id=test-session';
  let initRequest;
  b.context.ScriptApp={getOAuthToken:()=> 'test-owner-token'};
  b.context.UrlFetchApp={fetch(url,options){
    initRequest=options;
    return {getResponseCode:()=> options.method==='post' ? 200 : 308,
      getAllHeaders:()=>options.method==='post' ? {Location:session} : {Range:'bytes=0-262143'}};
  }};
  check('device size limit accepts exactly one decimal GB', post('beginUpload',deviceFile).session===session &&
    initRequest.headers['X-Upload-Content-Length']==='1000000000');
  check('only the single upload session is returned to the browser', !JSON.stringify(post('beginUpload',deviceFile)).includes('test-owner-token'));
  check('oversized or negative file lengths are refused', !post('beginUpload',{...deviceFile,size:1000000001}).ok &&
    !post('beginUpload',{...deviceFile,size:-1}).ok);
  check('progress probe returns the first uncommitted byte', post('uploadStatus',{session,size:deviceFile.size}).offset===262144);
  check('progress probe rejects unrelated destinations', !post('uploadStatus',{session:'https://example.org/',size:0}).ok);
  let forbiddenBody;
  b.context.UrlFetchApp.fetch=()=>({getResponseCode:()=>403,getContentText:()=>forbiddenBody});
  forbiddenBody=JSON.stringify({error:{errors:[{reason:'storageQuotaExceeded'}]}});
  check('Drive reports insufficient storage at session creation and progress checks',
    post('beginUpload',deviceFile).code==='storageQuotaExceeded' && post('uploadStatus',{session,size:42}).code==='storageQuotaExceeded');
  for(const body of ['userRateLimitExceeded','insufficientPermissions','teamDriveFileLimitExceeded','malformed']){
    forbiddenBody=body==='malformed' ? '<html>Error</html>' : JSON.stringify({error:{errors:[{reason:body}]}});
    const rejected=post('beginUpload',deviceFile);
    check(body+' keeps the ordinary Drive error', !rejected.ok && !rejected.code && rejected.error.includes('(403)'));
  }
  const deviceParent=repo.child('02 Content').child('Leadership Programmes').getId();
  b.driveFiles[deviceFile.uploadId]={id:deviceFile.uploadId, size:'42',parents:[deviceParent],
    appProperties:{repositoryUpload:deviceFile.uploadId,repositoryBytes:'43'}};
  check('a size mismatch cannot be indexed', !post('saveUpload',deviceFile).ok);
  b.driveFiles[deviceFile.uploadId].appProperties.repositoryBytes='42';
  check('completed upload metadata is verified against its actual parent', b.context.verifyUpload_(deviceFile).id===deviceFile.uploadId &&
    !post('saveUpload',{...deviceFile,folderPath:'Leadership Programmes > Participant Materials'}).ok);
  const id = post('reserveUpload').id;
  const payload = {id, name:'notes.txt', mime:'text/plain', size:3,content:'YWJj',library:'02 Content',folderPath:'Leadership Programmes'};
  const uploaded = post('upload', payload);
  check('local bytes reach chosen folder', uploaded.ok && b.driveFiles[id].parents[0] === repo.child('02 Content').child('Leadership Programmes').getId());
  check('retry returns same Drive file', post('upload',payload).url === uploaded.url && !!uploaded.url);
  check('link-only and wrong destinations cannot upload', !post('upload',{...payload,content:undefined}).ok && !post('upload',{...payload,folderPath:'Wrong'}).ok);
  const googleMeta = b.context.driveMetadata_('https://docs.google.com/document/d/googleDoc/edit');
  check('Google-native files receive a clear format and size label', googleMeta.format === 'Google Doc' && googleMeta.size === 'Google file');

  const recorded = b.context.record_({
    title:'2025 - ADNOC GAS - Workshop Guide - v1',
    description:'A workshop guide for the Own The Room programme.',
    tags:'Client Delivery, Workshop, Executives, Own The Room',
    driveLink:'https://drive.google.com/file/d/xyz/view',
    docType:'Facilitator Guide, Framework', topics:'Leadership, Customer Experience', client:'ADNOC GAS', people:'', industry:'Energy',
    language:'English & Arabic', library:'01 Clients', folderPath:'ADNOC GAS > Own The Room > Delivery Files', year:2025
  });
  check('record endpoint still saves successfully', recorded.ok === true);
  const indexRows = b.ss.getSheetByName('Knowledge Index').data;
  check('the original 16 record columns stay in place and metadata is appended', indexRows[indexRows.length - 1].length === 18);
  check('multiple document types stay in the existing Doc Type column', indexRows[indexRows.length - 1][5] === 'Facilitator Guide, Framework');
  check('multiple and custom topics stay in the existing Topics column', indexRows[indexRows.length - 1][6] === 'Leadership, Customer Experience');
  check('Tags & Keywords remains column 16', indexRows[indexRows.length - 1][15] === 'Client Delivery, Workshop, Executives, Own The Room');
  check('file format and size are detected from Drive without extra form fields', indexRows[indexRows.length - 1][16] === 'PDF' && indexRows[indexRows.length - 1][17] === '1-10 MB');
  check('the supplied document year is stored instead of upload year', indexRows[indexRows.length - 1][13] === 2025);
  const readBack = b.context.readRecords_(b.ss)[0];
  check('records API returns old and new metadata together', readBack.tags.includes('Client Delivery') && readBack.docType.includes('Framework') && readBack.folderPath.includes('Delivery Files') && readBack.fileFormat === 'PDF' && readBack.fileSize === '1-10 MB');
  b.ss.getSheetByName('Knowledge Index').appendRow([
    'AKR-0999','2024-01-01','Legacy Deck','An older record created before file metadata existed.',
    'https://drive.google.com/file/d/legacyDoc/view','Slide Deck','Leadership','','','','English',
    '02 Content','Legacy',2024,'Active','Learning Material'
  ]);
  const backfilled = b.context.backfillFileMetadata_(b.ss.getSheetByName('Knowledge Index'));
  const legacyRow = b.ss.getSheetByName('Knowledge Index').data.slice(-1)[0];
  check('existing records are backfilled non-destructively during setup', backfilled.updated >= 1 && legacyRow[16] === 'PowerPoint' && legacyRow[17] === '10-50 MB' && legacyRow[15] === 'Learning Material');
  check('Drive link validation remains enforced', b.context.record_({ title:'Bad', description:'This description is long enough.', driveLink:'javascript:alert(1)', docType:'Other', library:'02 Content', folderPath:'X' }).ok === false);

  const rename = {operation:'rename',group:'usage',original:'Workshop',value:'Group Session',count:1};
  check('admin sees actual usage', post('keywordUsage',rename).count === 1);
  check('rename updates existing records and catalog', post('editKeyword',rename).ok && b.context.readRecords_(b.ss)[0].tags.includes('Group Session') && !b.context.keywords_(b.ss).usage.includes('Workshop'));
  check('stale removal count rejected', !post('editKeyword',{...rename,operation:'remove',original:'Group Session',value:'Keynote',count:0}).ok);
  check('remove reassigns existing files', post('editKeyword',{...rename,operation:'remove',original:'Group Session',value:'Keynote'}).ok && b.context.readRecords_(b.ss)[0].tags.includes('Keynote'));
  check('standard topics can be retired',post('editKeyword',{operation:'remove',group:'topic',original:'Innovation',value:'',count:0}).ok);
  const routed = post('addFolder',{library:'05 Research',parentPath:'',name:'Sector Reports'});
  check('uploader can create folders', routed.ok && routed.name === 'Sector Reports');
  check('all write requests still use the script lock', b.lock.waited && b.lock.released);

  /* A manual Drive folder is picked up by setupEverything, which repairs the
     Folders sheet without recreating any defaults. */
  repo.child('06 Alliance IP').createFolder('Manual Folder').createFolder('Nested Manual');
  b.context.setupEverything();
  check('setup preserves retired keywords', !b.context.keywords_(b.ss).topic.includes('Innovation'));
  const folderPaths = b.ss.getSheetByName('Folders').data.map(r => r[0]);
  check('setupEverything scans and indexes manually created nested folders', folderPaths.includes('06 Alliance IP > Manual Folder > Nested Manual'));
  check('setupEverything remains non-destructive', !!repo.child('06 Alliance IP').child('Manual Folder').child('Nested Manual'));

  console.log('\n===== DOCUMENTATION AND PACKAGE =====');
  const readme = fs.readFileSync(path.join(__dirname, 'README.txt'), 'utf8');
  const setup = fs.readFileSync(path.join(__dirname, 'SETUP.txt'), 'utf8');
  const operator = fs.readFileSync(path.join(__dirname, 'OPERATOR_GUIDE.txt'), 'utf8');
  const checklist = fs.readFileSync(path.join(__dirname, 'GO_LIVE_CHECKLIST.txt'), 'utf8');
  const maintenance = fs.readFileSync(path.join(__dirname, 'MAINTENANCE.md'), 'utf8');
  check('README documents flexible nested folders', /folders inside folders/i.test(readme));
  check('SETUP uses the non-destructive upgrade path', /run setupEverything once/i.test(setup) && /NEVER RUN resetForGoLive/i.test(setup));
  check('operator guide explains all seven main folders', b.libraries.every(name => operator.includes(name)));
  check('operator guide explains normal search and tappable Tags and Keywords', /Tags and Keywords/i.test(operator) && /NORMAL SEARCH/i.test(operator) && /tap Filters/i.test(operator));
  check('operator guide and UI both omit the Stage category', !/What stage is it at/i.test(operator) && !/What stage is it at/i.test(html));
  check('simple checklist tests both typed and tapped retrieval', /normal typed search/i.test(checklist) && /tapping the same Topic or Tag/i.test(checklist));
  check('maintenance notes document the compatible 18-column schema', /18 columns/i.test(maintenance) && /first 16 columns are unchanged/i.test(maintenance));
  check('package has no external runtime test dependency', !/require\(['"]\.\.\//.test(fs.readFileSync(__filename, 'utf8')));

  console.log('\n================================');
  console.log('  ' + passed + ' passed, ' + failed + ' failed');
  console.log('================================\n');
  process.exitCode = failed ? 1 : 0;
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
