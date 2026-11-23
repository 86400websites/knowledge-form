/**
 * ============================================================================
 *  ALLIANCE KNOWLEDGE REPOSITORY
 *  Flexible folders, simple recording, powerful retrieval.
 * ============================================================================
 *
 *  UPGRADING AN EXISTING LIVE REPOSITORY
 *  1. Replace the old Code.gs with this file and save.
 *  2. Run setupEverything once. It is non-destructive and preserves records.
 *  3. Deploy a new version of the existing web app.
 *
 *  IMPORTANT
 *  Do not run resetForGoLive on a live repository. It exists only for an
 *  unused sample installation and intentionally deletes sample contents.
 * ============================================================================
 */


/* Configure a separate Apps Script project for each account. */
const SETTINGS = PropertiesService.getScriptProperties();
let SHEET_ID = SETTINGS.getProperty("SHEET_ID");
let PARENT_ID = SETTINGS.getProperty("PARENT_ID");

const TAB         = "Knowledge Index";
const LISTS_TAB   = "Lists";
const FOLDERS_TAB = "Folders";
const ROOT_NAME   = "Alliance Knowledge Repository";

/* New metadata is appended only. The first 16 columns remain in exactly the
   same positions, so every existing record stays compatible. */
const HEADERS = ["ID","Date Added","Title","Description","Drive Link","Doc Type","Topics",
                 "Client","People","Industry","Language","Library","Folder Path","Year","Status",
                 "Tags & Keywords","File Format","File Size"];
const WIDTHS  = [90,140,320,420,240,150,200,150,160,140,90,130,260,60,100,240,120,120];

const LIBRARIES = [
  "01 Clients",
  "02 Content",
  "03 Market & Sell",
  "04 People",
  "05 Research",
  "06 Alliance IP",
  "99 Archive"
];

const KEYWORD_SEED = {
  "topic": [
    "Artificial Intelligence",
    "Leadership",
    "Future of Work",
    "Learning & Skills",
    "Innovation"
  ],
  "purpose": [
    "Client Delivery",
    "Learning Material",
    "Sales Material",
    "Marketing Material",
    "Research",
    "Alliance IP",
    "Internal Use",
    "Planning",
    "Reporting",
    "Proposal Support"
  ],
  "audience": [
    "Executives",
    "Senior Leaders",
    "Managers",
    "Employees",
    "Participants",
    "Facilitators",
    "Coaches",
    "HR",
    "Learning & Development",
    "Client Team",
    "Internal Team"
  ],
  "usage": [
    "Workshop",
    "Learning Programme",
    "Presentation",
    "Coaching",
    "Keynote",
    "Webinar",
    "Meeting",
    "Offsite",
    "Self-Paced Learning",
    "Train the Trainer"
  ],
  "features": [
    "Editable",
    "Print Ready",
    "Presentation Ready",
    "Client Ready",
    "Interactive",
    "Visual",
    "One Page",
    "Executive Summary",
    "Customisable",
    "Reusable",
    "Practical",
    "Strategic"
  ],
  "region": [
    "UAE",
    "Saudi Arabia",
    "GCC",
    "Middle East",
    "MENA",
    "Global"
  ],
  "language": [
    "English",
    "Arabic",
    "English & Arabic",
    "French",
    "Multiple Languages",
    "Other Language"
  ],
  "custom": []
};

const MAX_FOLDER_DEPTH = 30;
const MAX_INDEXED_FOLDERS = 5000;
const RESET_PROPERTY = "AKR_GO_LIVE_RESET_COMPLETED_V2";


/* ==========================================================================
 *  SAFE SETUP
 *
 *  Builds or repairs the Sheet tabs, ensures the seven main folders exist,
 *  and rebuilds the complete folder-path index from Drive. It never deletes
 *  files or folders and never creates predefined subfolders.
 * ========================================================================== */

// Run in the existing project as its deployment owner. Each new account
// gets its own project properties, private index and repository parent.
function prepareFreshRepository() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (!SETTINGS.getProperty("ADMIN_KEY") || !SETTINGS.getProperty("TEAM_KEY") ||
        SETTINGS.getProperty("ADMIN_KEY") === SETTINGS.getProperty("TEAM_KEY"))
      throw new Error("Set distinct TEAM_KEY and ADMIN_KEY values in Script properties first.");
    PARENT_ID = SETTINGS.getProperty("PARENT_ID");
    SHEET_ID = SETTINGS.getProperty("SHEET_ID");
    if (!PARENT_ID) {
      PARENT_ID = DriveApp.createFolder("Alliance Knowledge – repository storage").getId();
      SETTINGS.setProperty("PARENT_ID", PARENT_ID);
    }
    if (!SHEET_ID) {
      SHEET_ID = SpreadsheetApp.create("Alliance Knowledge – repository index").getId();
      SETTINGS.setProperty("SHEET_ID", SHEET_ID);
    }
    setupEverything();
  } finally {
    lock.releaseLock();
  }
}

function setupEverything() {
  if (!SHEET_ID || !PARENT_ID) throw new Error("Set SHEET_ID and PARENT_ID in Script properties first.");

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const log = [];

  /* --- Knowledge Index --- */
  let sh = ss.getSheetByName(TAB) || ss.insertSheet(TAB);
  ensureSheetSize_(sh, 1, HEADERS.length);
  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  sh.getRange(1, 1, 1, HEADERS.length)
    .setFontWeight("bold").setBackground("#EEF2F3").setVerticalAlignment("middle");
  sh.setFrozenRows(1);
  sh.setRowHeight(1, 32);
  WIDTHS.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(1, 3, sh.getMaxRows(), 2).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  const metadataBackfill = backfillFileMetadata_(sh);
  log.push("Knowledge Index ready — " + HEADERS.length + " columns.");
  if (metadataBackfill.updated) {
    log.push("Existing file metadata added — " + metadataBackfill.updated + " record(s).");
  }

  /* --- Lists --- */
  let ls = ss.getSheetByName(LISTS_TAB);
  const listsCreated = !ls;
  if (!ls) ls = ss.insertSheet(LISTS_TAB);
  ensureSheetSize_(ls, 1, 9);
  ls.getRange("A1:G1").setValues([["Client", "Industry", "", "Person", "Language", "", "Topic"]]);
  ls.getRange("A1:G1").setFontWeight("bold").setBackground("#EEF2F3");
  ls.setFrozenRows(1);
  [200, 160, 30, 200, 160, 30, 220].forEach(function (w, i) { ls.setColumnWidth(i + 1, w); });
  ls.getRange("I1").setValue(
    "Written by the repository. Clients, people and new topics are added from the website."
  ).setFontColor("#5A6672").setFontStyle("italic");
  setupKeywords_(ss);
  log.push(listsCreated ? "Lists tab created." : "Lists tab ready — existing data preserved.");

  /* --- Folders --- */
  let fs = ss.getSheetByName(FOLDERS_TAB);
  if (!fs) fs = ss.insertSheet(FOLDERS_TAB);
  ensureSheetSize_(fs, 1, 2);
  fs.getRange("A1:B1").setValues([["Path", "URL"]]);
  fs.getRange("A1:B1").setFontWeight("bold").setBackground("#EEF2F3");
  fs.setFrozenRows(1);
  fs.setColumnWidth(1, 440);
  fs.setColumnWidth(2, 460);

  /* --- Drive --- */
  const root = repoRoot_();
  log.push("");
  log.push(ROOT_NAME + "  →  " + root.getUrl());

  /* Existing client/person metadata should continue to point to real folders
     after a repair. No standard child folders are created. */
  const lists = readLists_(ss);
  const clientsRoot = getOrCreate_(root, "01 Clients");
  lists.clients.forEach(function (c) { getOrCreate_(clientsRoot, c.name); });
  const peopleRoot = getOrCreate_(root, "04 People");
  lists.people.forEach(function (p) { getOrCreate_(peopleRoot, p.name); });

  const map = scanRepositoryFolders_(root);
  writeFolders_(ss, map, true);

  LIBRARIES.forEach(function (lib) { log.push("   " + lib); });
  log.push("");
  log.push("Folder index rebuilt — " + Object.keys(map).length + " paths.");
  log.push("Done. Next: Deploy > Manage deployments > Edit > New version > Deploy.");
  Logger.log(log.join("\n"));
}


/* ==========================================================================
 *  ONE-TIME GO-LIVE RESET
 *
 *  This is intentionally separate from setupEverything. It keeps exactly the
 *  seven fixed main folders, moves every other sample item at the repository
 *  root and every item inside those main folders to Drive Trash, clears sample
 *  Sheet data, then rebuilds the folder index. It is protected against a
 *  second run.
 * ========================================================================== */

function resetForGoLive() {
  if (!SHEET_ID) throw new Error("Fill in SHEET_ID at the top of this file first.");

  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(RESET_PROPERTY)) {
    throw new Error(
      "resetForGoLive has already been completed for this version. " +
      "Do not run it again. Use setupEverything for future repairs."
    );
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const root = repoRoot_();
  let trashedFiles = 0;
  let trashedFolders = 0;

  /* Keep exactly one copy of each fixed main folder and remove any sample
     files, unexpected folders or duplicate main folders from the repository
     root itself. */
  const mainFolders = {};
  LIBRARIES.forEach(function (lib) { mainFolders[lib] = getOrCreate_(root, lib); });
  const rootCounts = trashUnexpectedRootContents_(root, mainFolders);
  trashedFiles += rootCounts.files;
  trashedFolders += rootCounts.folders;

  LIBRARIES.forEach(function (lib) {
    const counts = trashFolderContents_(mainFolders[lib]);
    trashedFiles += counts.files;
    trashedFolders += counts.folders;
  });

  clearSheetData_(ss.getSheetByName(TAB));
  clearListsData_(ss.getSheetByName(LISTS_TAB));
  clearSheetData_(ss.getSheetByName(FOLDERS_TAB));

  setupEverything();
  props.setProperty(RESET_PROPERTY, new Date().toISOString());

  Logger.log(
    "Go-live reset complete. Moved " + trashedFiles + " top-level files and " +
    trashedFolders + " top-level folders to Drive Trash; cleared sample Sheet data."
  );
}


/* ==========================================================================
 *  WEB APP — reads
 * ========================================================================== */

function doGet() {
  return json_({ ok: true, service: "Alliance Knowledge Repository" });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const d = JSON.parse(e.postData.contents);
    const key = d.accessKey;
    const admin = !!key && key === SETTINGS.getProperty("ADMIN_KEY");
    if (!admin && (!key || key !== SETTINGS.getProperty("TEAM_KEY"))) {
      throw new Error("Enter a valid repository access key.");
    }
    const ss = SpreadsheetApp.openById(SHEET_ID);
    if (d.action === "init") {
      const lists = readLists_(ss);
      return json_({ ok:true, admin:admin, keywords:keywords_(ss), next:formatId_(nextNumber_(indexTab_(ss))),
        clients:lists.clients, people:lists.people, folders:readFolders_(ss) });
    }
    if (d.action === "records") return json_({ok:true, records:readRecords_(ss)});
    if (d.action === "reserveUpload") return json_({ok:true, id:Drive.Files.generateIds({count:1, space:"drive"}).ids[0]});
    if (d.action === "editKeyword" || d.action === "keywordUsage") {
      if (!admin) throw new Error("An admin key is required to manage keywords.");
    }
    lock.waitLock(20000);
    if (d.website) return json_({ok:true, id:"AKR-0000"});
    switch (d.action) {
      case "upload": return upload_(d);
      case "editKeyword":
      case "keywordUsage": return manageKeyword_(ss, d);
      case "addClient": return addClient_(d);
      case "addPerson": return addPerson_(d);
      case "addFolder": return addFolder_(d);
      case "record": return record_(d);
      default: throw new Error("Unknown repository action.");
    }
  } catch (err) {
    return json_({ok:false, error:String(err.message || err)});
  } finally {
    if (lock.hasLock()) { try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); } }
  }
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function upload_(d) {
  const name = s_(d.name);
  if (!/^[\w-]{10,200}$/.test(d.id) || !name || name.length > 255 || /[\/\\\x00-\x1f]/.test(name))
    throw new Error("Choose a file with a valid name.");
  const parts = folderPathParts_(d.folderPath);
  if (!parts.length || LIBRARIES.indexOf(d.library) < 0) throw new Error("Select a repository subfolder.");
  const library = findChildFolder_(repoRoot_(), d.library);
  const dest = library && resolveFolderPath_(library, parts);
  if (!dest) throw new Error("The selected folder has moved. Choose it again.");
  if (!Number.isInteger(d.size) || d.size < 0 || d.size > MAX_UPLOAD_BYTES ||
      typeof d.content !== "string" || d.content.length !== Math.ceil(d.size / 3) * 4)
    throw new Error("Choose a file up to 10 MB.");
  const bytes = d.size ? Utilities.base64Decode(d.content) : [];
  if (bytes.length !== d.size) throw new Error("Incomplete file. Select the file again.");
  const blob = Utilities.newBlob(bytes, "application/octet-stream", name);
  const parent = dest.folder.getId();
  const options = {fields:"id,name,parents,appProperties,size,webViewLink,trashed", supportsAllDrives:true};
  let file;
  try {
    file = Drive.Files.create({id:d.id, name:name, parents:[parent], mimeType:d.mime || "application/octet-stream",
      appProperties:{repositoryUpload:d.id}}, blob, options);
  } catch (err) {
    // A successful upload whose response was lost can reuse its reserved Drive ID.
    try { file = Drive.Files.get(d.id, options); } catch (ignored) { throw err; }
    if (file.trashed || !file.appProperties || file.appProperties.repositoryUpload !== d.id ||
        file.name !== name || Number(file.size) !== d.size || !(file.parents || []).includes(parent)) throw err;
  }
  return json_({ok:true, id:file.id, name:file.name, url:file.webViewLink || "https://drive.google.com/open?id=" + file.id});
}

function keywordColumn_(group) {
  return group === "topic" ? 7 : group === "language" ? 11 : 16;
}

function setupKeywords_(ss) {
  const tab = ss.getSheetByName("Keywords") || ss.insertSheet("Keywords");
  if (tab.getLastRow()) return;
  const rows = [["Group","Keyword"]];
  const seen = new Set();
  function include(group, value) {
    const key = keywordColumn_(group) + "|" + value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key);
    rows.push([group, value]);
  }
  Object.keys(KEYWORD_SEED).forEach(group => KEYWORD_SEED[group].forEach(value => include(group, value)));
  readLists_(ss).topics.forEach(value => include("topic", value));
  readRecords_(ss).forEach(r => {
    splitValues_(r.tags).forEach(v => include("custom", v));
    splitValues_(r.topics).forEach(v => include("topic", v));
    splitValues_(r.language).forEach(v => include("language", v));
  });
  ensureSheetSize_(tab, rows.length, 2);
  tab.getRange(1, 1, rows.length, 2).setValues(rows);
}

function keywords_(ss) {
  const tab = ss.getSheetByName("Keywords");
  if (!tab || !tab.getLastRow()) throw new Error("Run setupEverything in this Apps Script project.");
  const catalog = {};
  Object.keys(KEYWORD_SEED).forEach(group => catalog[group] = []);
  if (tab.getLastRow() > 1) tab.getRange(2, 1, tab.getLastRow()-1, 2).getValues().forEach(([group, value]) => {
    if (Object.prototype.hasOwnProperty.call(catalog, group) && value) catalog[group].push(String(value));
  });
  return catalog;
}

function validateSelections_(catalog, d) {
  const allowedTags = Object.keys(catalog).filter(g => keywordColumn_(g) === 16).flatMap(g => catalog[g]);
  [[d.topics,catalog.topic],[d.language,catalog.language],[d.tags,allowedTags]].forEach(([raw, allowed]) => {
    if (splitValues_(raw).some(v => !allowed.includes(v)))
      throw new Error("The keyword list changed. Refresh the form and select the current keywords.");
  });
}

function updateCells_(tab, row, col, values) {
  return {updateCells:{start:{sheetId:tab.getSheetId(), rowIndex:row-1, columnIndex:col-1},
    rows:[{values:values.map(v => ({userEnteredValue:{stringValue:v}}))}], fields:"userEnteredValue"}};
}

function manageKeyword_(ss, d) {
  const tab = ss.getSheetByName("Keywords"), index = indexTab_(ss);
  const catalog = keywords_(ss);
  const group = d.group, old = s_(d.original), value = s_(d.value).replace(/\s+/g, " ");
  if (!Object.prototype.hasOwnProperty.call(catalog, group)) throw new Error("Choose a keyword group.");
  const col = keywordColumn_(group);
  if (old && !catalog[group].includes(old)) throw new Error("This keyword has changed. Reopen the manager.");
  const affected = [];
  if (old && index.getLastRow() > 1) {
    index.getRange(2, col, index.getLastRow()-1, 1).getValues().forEach(([raw], i) => {
      const items = splitValues_(raw);
      if (items.some(v => v.toLowerCase() === old.toLowerCase())) affected.push({row:i+2, items:items});
    });
  }
  if (d.action === "keywordUsage") return json_({ok:true, count:affected.length});
  if (!["add","rename","remove"].includes(d.operation) || (d.operation === "add") !== !old)
    throw new Error("Select a keyword and an action.");
  if (d.operation === "remove") {
    if (value && (value === old || !catalog[group].includes(value))) throw new Error("Choose an existing replacement.");
  } else {
    if (value.length < 1 || value.length > 80 || /[,\x00-\x1f]/.test(value)) throw new Error("Enter one keyword of up to 80 characters.");
    const taken = Object.keys(catalog).filter(g => keywordColumn_(g) === col)
      .some(g => catalog[g].some(v => v !== old && v.toLowerCase() === value.toLowerCase()));
    if (taken) throw new Error("That keyword already exists.");
  }
  if (old && d.count !== affected.length) throw new Error("Usage changed. Select the keyword again to review its current count.");
  const rows = tab.getRange(1, 1, tab.getLastRow(), 2).getValues();
  const row = old ? rows.findIndex(r => r[0] === group && r[1] === old)+1 : rows.length+1;
  ensureSheetSize_(tab, row, 2);
  const changes = [updateCells_(tab, row, 1, d.operation === "remove" ? ["",""] : [group,value])];
  affected.forEach(hit => {
    const next = hit.items.map(v => v.toLowerCase() === old.toLowerCase() ? value : v);
    changes.push(updateCells_(index, hit.row, col, [splitValues_(next.join(",")).join(", ")]));
  });
  SpreadsheetApp.flush();
  Sheets.Spreadsheets.batchUpdate({requests:changes}, SHEET_ID);
  if (old) catalog[group] = catalog[group].filter(v => v !== old);
  if (d.operation !== "remove") catalog[group].push(value);
  return json_({ok:true, keywords:catalog});
}

function record_(d) {
  const missing = ["title", "description", "driveLink", "docType", "library", "folderPath"]
    .filter(function (k) { return !d[k]; });
  if (missing.length) return json_({ ok: false, error: "Missing: " + missing.join(", ") });

  /* The browser checks this too, but the endpoint is public — never store a
     link the Retrieve tab would later turn into a clickable href. */
  if (!/^https:\/\/(drive|docs)\.google\.com\//.test(s_(d.driveLink))) {
    return json_({ ok: false, error: "Drive link must be a Google Drive or Docs URL." });
  }

  if (s_(d.tags).length > 2000) {
    return json_({ ok: false, error: "Tags & Keywords must be 2,000 characters or fewer." });
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = indexTab_(ss);
  ensureSheetSize_(sh, 2, HEADERS.length);
  if (d.uploadId && sh.getLastRow() > 1) {
    if (driveFileId_(d.driveLink) !== d.uploadId) throw new Error("The uploaded file link has changed.");
    const rows = sh.getRange(2,1,sh.getLastRow()-1,5).getValues();
    const saved = rows.find(row => driveFileId_(row[4]) === d.uploadId);
    if (saved) return json_({ok:true,id:saved[0],next:formatId_(nextNumber_(sh))});
  }
  const id = formatId_(nextNumber_(sh));
  const now = new Date();
  const topics = splitValues_(d.topics);
  const catalog = keywords_(ss);
  validateSelections_(catalog, d);
  const year = validYear_(d.year) || yearFromTitle_(d.title) || now.getFullYear();
  const fileMeta = driveMetadata_(d.driveLink);

  const row = [
    id,
    Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm"),
    s_(d.title), s_(d.description), s_(d.driveLink), s_(d.docType), topics.join(", "),
    s_(d.client), s_(d.people), s_(d.industry), s_(d.language),
    s_(d.library), s_(d.folderPath),
    year,
    s_(d.status) || "Active",
    s_(d.tags),
    fileMeta.format,
    fileMeta.size
  ];
  sh.appendRow(row.map(value => typeof value === "string" && value.startsWith("=") ? "'" + value : value));

  return json_({ ok: true, id: id, next: formatId_(nextNumber_(sh)) });
}


function addClient_(d) {
  const requested = cleanFolderName_(d.name);
  const nameError = folderNameError_(requested);
  if (nameError) return json_({ ok: false, error: nameError });

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const lists = readLists_(ss);
  const listed = lists.clients.filter(function (c) {
    return c.name.trim().toLowerCase() === requested.toLowerCase();
  })[0];

  const clientsRoot = getOrCreate_(repoRoot_(), "01 Clients");
  const existingFolder = findChildFolder_(clientsRoot, listed ? listed.name : requested);
  const folder = existingFolder || clientsRoot.createFolder(listed ? listed.name : requested);
  const actualName = folder.getName();
  const map = {};
  map["01 Clients"] = clientsRoot.getUrl();
  map["01 Clients > " + actualName] = folder.getUrl();
  writeFolders_(ss, map);

  if (!listed) {
    const ls = ss.getSheetByName(LISTS_TAB);
    const row = lastIn_(ls, 1) + 1;
    ensureSheetSize_(ls, row, 5);
    ls.getRange(row, 1, 1, 2).setValues([[actualName, s_(d.industry)]]);
  }

  return json_({
    ok: true,
    name: listed ? listed.name : actualName,
    industry: listed ? listed.industry : s_(d.industry),
    url: folder.getUrl(),
    existed: !!listed || !!existingFolder,
    folders: map
  });
}


function addPerson_(d) {
  const requested = cleanFolderName_(d.name);
  const nameError = folderNameError_(requested);
  if (nameError) return json_({ ok: false, error: nameError });

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const lists = readLists_(ss);
  const listed = lists.people.filter(function (p) {
    return p.name.trim().toLowerCase() === requested.toLowerCase();
  })[0];

  const peopleRoot = getOrCreate_(repoRoot_(), "04 People");
  const existingFolder = findChildFolder_(peopleRoot, listed ? listed.name : requested);
  const folder = existingFolder || peopleRoot.createFolder(listed ? listed.name : requested);
  const actualName = folder.getName();
  const map = {};
  map["04 People"] = peopleRoot.getUrl();
  map["04 People > " + actualName] = folder.getUrl();
  writeFolders_(ss, map);

  if (!listed) {
    const ls = ss.getSheetByName(LISTS_TAB);
    const row = lastIn_(ls, 4) + 1;
    ensureSheetSize_(ls, row, 5);
    ls.getRange(row, 4, 1, 2).setValues([[actualName, s_(d.language)]]);
  }

  return json_({
    ok: true,
    name: listed ? listed.name : actualName,
    language: listed ? listed.language : s_(d.language),
    url: folder.getUrl(),
    existed: !!listed || !!existingFolder,
    folders: map
  });
}


/** Create one folder under any existing repository folder. The path supplied
    by the browser is relative to the selected main library. */
function addFolder_(d) {
  const library = s_(d.library);
  if (LIBRARIES.indexOf(library) === -1) {
    return json_({ ok: false, error: "Unknown main folder." });
  }

  const name = cleanFolderName_(d.name);
  const nameError = folderNameError_(name);
  if (nameError) return json_({ ok: false, error: nameError });

  let parentParts;
  try {
    parentParts = folderPathParts_(d.parentPath);
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }

  if (parentParts.length >= MAX_FOLDER_DEPTH) {
    return json_({ ok: false, error: "The maximum folder depth is " + MAX_FOLDER_DEPTH + "." });
  }

  /* First-level Clients and People must go through their purpose-built forms
     so client industry and person language remain available to Record/Retrieve. */
  if (!parentParts.length && library === "01 Clients") {
    return json_({ ok: false, error: "Use ‘Create a new client folder’ for the first client level." });
  }
  if (!parentParts.length && library === "04 People") {
    return json_({ ok: false, error: "Use ‘Create a new person folder’ for the first person level." });
  }

  const ss = SpreadsheetApp.openById(SHEET_ID);
  const libraryFolder = getOrCreate_(repoRoot_(), library);
  const resolved = resolveFolderPath_(libraryFolder, parentParts);
  if (!resolved) {
    return json_({ ok: false, error: "The selected parent folder no longer exists. Go back and choose it again." });
  }

  const existing = findChildFolder_(resolved.folder, name);
  const folder = existing || resolved.folder.createFolder(name);
  const actualName = folder.getName();
  const fullParts = resolved.names.concat([actualName]);
  const fullPath = fullParts.join(" > ");
  const canonicalParent = resolved.names.join(" > ");

  const map = {};
  map[library] = libraryFolder.getUrl();
  if (canonicalParent) map[library + " > " + canonicalParent] = resolved.folder.getUrl();
  map[library + " > " + fullPath] = folder.getUrl();
  writeFolders_(ss, map);

  return json_({
    ok: true,
    library: library,
    parentPath: canonicalParent,
    path: fullPath,
    name: actualName,
    url: folder.getUrl(),
    parentUrl: resolved.folder.getUrl(),
    existed: !!existing,
    folders: map
  });
}


/* ==========================================================================
 *  helpers
 * ========================================================================== */

function indexTab_(ss) {
  const sh = ss.getSheetByName(TAB);
  if (!sh) throw new Error('No tab named "' + TAB + '". Run setupEverything first.');
  return sh;
}

function repoRoot_() {
  if (!PARENT_ID) throw new Error("Set PARENT_ID to the repository parent folder.");
  const parent = DriveApp.getFolderById(PARENT_ID);
  return getOrCreate_(parent, ROOT_NAME);
}

function ensureSheetSize_(sh, rows, cols) {
  if (!sh) return;
  const needRows = Math.max(1, Number(rows) || 1);
  const needCols = Math.max(1, Number(cols) || 1);
  const haveRows = sh.getMaxRows();
  const haveCols = sh.getMaxColumns();
  if (haveRows < needRows) sh.insertRowsAfter(haveRows, needRows - haveRows);
  if (haveCols < needCols) sh.insertColumnsAfter(haveCols, needCols - haveCols);
}

function findChildFolder_(parent, name) {
  const exact = parent.getFoldersByName(name);
  if (exact.hasNext()) return exact.next();

  const wanted = cleanFolderName_(name).toLowerCase();
  const all = parent.getFolders();
  while (all.hasNext()) {
    const folder = all.next();
    if (cleanFolderName_(folder.getName()).toLowerCase() === wanted) return folder;
  }
  return null;
}

function getOrCreate_(parent, name) {
  return findChildFolder_(parent, name) || parent.createFolder(name);
}

function cleanFolderName_(v) {
  return s_(v).replace(/\s+/g, " ");
}

function folderNameError_(name) {
  if (!name) return "No folder name given.";
  if (name.indexOf(">") !== -1) return 'Folder names cannot contain the ">" character.';
  if (name.length > 120) return "Folder names must be 120 characters or fewer.";
  return "";
}

function folderPathParts_(value) {
  const raw = s_(value);
  if (!raw) return [];
  if (raw.length > 2000) throw new Error("The folder path is too long.");

  const parts = raw.split(">").map(function (part) { return cleanFolderName_(part); });
  if (parts.some(function (part) { return !part; })) throw new Error("The folder path is invalid.");
  if (parts.length > MAX_FOLDER_DEPTH) throw new Error("The folder path is too deep.");

  parts.forEach(function (part) {
    const err = folderNameError_(part);
    if (err) throw new Error(err);
  });
  return parts;
}

function resolveFolderPath_(start, parts) {
  let folder = start;
  const names = [];
  for (let i = 0; i < parts.length; i++) {
    const child = findChildFolder_(folder, parts[i]);
    if (!child) return null;
    folder = child;
    names.push(child.getName());
  }
  return { folder: folder, names: names };
}

/** Scan every existing nested folder, regardless of whether it was created by
    the app or directly in Drive. setupEverything uses this to repair the map. */
function scanRepositoryFolders_(root) {
  const map = {};
  let count = 0;

  LIBRARIES.forEach(function (library) {
    const main = getOrCreate_(root, library);
    map[library] = main.getUrl();

    const queue = [{ folder: main, path: library, depth: 0 }];
    let cursor = 0;

    while (cursor < queue.length) {
      const node = queue[cursor++];
      const children = node.folder.getFolders();
      while (children.hasNext()) {
        const child = children.next();
        const childName = cleanFolderName_(child.getName());
        const err = folderNameError_(childName);
        if (err) {
          throw new Error('Folder "' + child.getName() + '" under "' + node.path + '" cannot be indexed: ' + err);
        }
        if (node.depth + 1 > MAX_FOLDER_DEPTH) {
          throw new Error("Folder depth exceeds " + MAX_FOLDER_DEPTH + " under " + node.path + ".");
        }

        const childPath = node.path + " > " + childName;
        map[childPath] = child.getUrl();
        queue.push({ folder: child, path: childPath, depth: node.depth + 1 });
        count += 1;
        if (count > MAX_INDEXED_FOLDERS) {
          throw new Error("The repository contains more than " + MAX_INDEXED_FOLDERS + " folders. Contact the administrator.");
        }
      }
    }
  });

  return map;
}

function trashUnexpectedRootContents_(root, mainFolders) {
  let files = 0;
  let folders = 0;
  const keep = {};

  Object.keys(mainFolders).forEach(function (library) {
    keep[mainFolders[library].getId()] = true;
  });

  const fileIt = root.getFiles();
  while (fileIt.hasNext()) {
    fileIt.next().setTrashed(true);
    files += 1;
  }

  const folderIt = root.getFolders();
  while (folderIt.hasNext()) {
    const folder = folderIt.next();
    if (!keep[folder.getId()]) {
      folder.setTrashed(true);
      folders += 1;
    }
  }

  return { files: files, folders: folders };
}

function trashFolderContents_(folder) {
  let files = 0;
  let folders = 0;

  const fileIt = folder.getFiles();
  while (fileIt.hasNext()) {
    fileIt.next().setTrashed(true);
    files += 1;
  }

  const folderIt = folder.getFolders();
  while (folderIt.hasNext()) {
    folderIt.next().setTrashed(true);
    folders += 1;
  }

  return { files: files, folders: folders };
}

function clearSheetData_(sh) {
  if (!sh) return;
  const last = sh.getLastRow();
  if (last < 2) return;
  const width = Math.max(sh.getLastColumn(), 1);
  sh.getRange(2, 1, last - 1, width).clearContent();
}

function clearListsData_(ls) {
  if (!ls) return;
  ensureSheetSize_(ls, 1, 7);
  const last = ls.getLastRow();
  if (last < 2) return;
  ls.getRange(2, 1, last - 1, 2).clearContent();
  ls.getRange(2, 4, last - 1, 2).clearContent();
  ls.getRange(2, 7, last - 1, 1).clearContent();
}

/** Last used row within a specific column (the Lists tab has two independent
    blocks side by side, so getLastRow would give the wrong answer). */
function lastIn_(sh, col) {
  const n = sh.getMaxRows();
  const vals = sh.getRange(1, col, n, 1).getValues();
  for (let i = n - 1; i >= 0; i--) if (String(vals[i][0]).trim()) return i + 1;
  return 1;
}


function splitValues_(value) {
  const out = [];
  const seen = Object.create(null);
  String(value || "").split(",").forEach(function (part) {
    const v = String(part || "").trim().replace(/\s+/g, " ");
    if (!v || seen[v.toLowerCase()]) return;
    seen[v.toLowerCase()] = true;
    out.push(v);
  });
  return out;
}

function validYear_(value) {
  const year = Number(value);
  return Number.isFinite(year) && year >= 1900 && year <= 2100 ? Math.floor(year) : 0;
}

function yearFromTitle_(title) {
  const m = String(title || "").match(/(?:^|\D)((?:19|20)\d{2})(?:\D|$)/);
  return m ? validYear_(m[1]) : 0;
}


function driveFileId_(url) {
  const value = s_(url);
  const patterns = [
    /\/d\/([A-Za-z0-9_-]+)/,
    /[?&]id=([A-Za-z0-9_-]+)/,
    /\/file\/([A-Za-z0-9_-]+)(?:\/|$)/
  ];
  for (let i = 0; i < patterns.length; i++) {
    const hit = value.match(patterns[i]);
    if (hit) return hit[1];
  }
  return "";
}

function formatFromName_(name) {
  const hit = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = hit ? hit[1] : "";
  const map = {
    pdf:"PDF", doc:"Word", docx:"Word", ppt:"PowerPoint", pptx:"PowerPoint",
    xls:"Excel", xlsx:"Excel", csv:"CSV", txt:"Text", rtf:"RTF",
    jpg:"Image", jpeg:"Image", png:"Image", gif:"Image", webp:"Image", svg:"Image",
    mp4:"Video", mov:"Video", avi:"Video", mkv:"Video", webm:"Video",
    mp3:"Audio", wav:"Audio", m4a:"Audio", zip:"ZIP", rar:"Archive", "7z":"Archive"
  };
  return map[ext] || (ext ? ext.toUpperCase() : "");
}

function formatFromMime_(mime, name) {
  const m = String(mime || "").toLowerCase();
  const exact = {
    "application/vnd.google-apps.document":"Google Doc",
    "application/vnd.google-apps.spreadsheet":"Google Sheet",
    "application/vnd.google-apps.presentation":"Google Slides",
    "application/vnd.google-apps.form":"Google Form",
    "application/vnd.google-apps.drawing":"Google Drawing",
    "application/pdf":"PDF",
    "application/msword":"Word",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":"Word",
    "application/vnd.ms-powerpoint":"PowerPoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation":"PowerPoint",
    "application/vnd.ms-excel":"Excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":"Excel",
    "text/csv":"CSV",
    "text/plain":"Text",
    "application/rtf":"RTF",
    "application/zip":"ZIP",
    "application/x-zip-compressed":"ZIP"
  };
  if (exact[m]) return exact[m];
  if (m.indexOf("image/") === 0) return "Image";
  if (m.indexOf("video/") === 0) return "Video";
  if (m.indexOf("audio/") === 0) return "Audio";
  if (m.indexOf("application/vnd.google-apps.") === 0) return "Google file";
  return formatFromName_(name) || "Other";
}

function sizeBand_(bytes, mime) {
  if (String(mime || "").toLowerCase().indexOf("application/vnd.google-apps.") === 0) {
    return "Google file";
  }
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  const mb = 1024 * 1024;
  if (n < mb) return "Under 1 MB";
  if (n < 10 * mb) return "1-10 MB";
  if (n < 50 * mb) return "10-50 MB";
  if (n < 200 * mb) return "50-200 MB";
  return "Over 200 MB";
}

function driveMetadata_(url) {
  const id = driveFileId_(url);
  if (!id) return { format:"", size:"" };
  try {
    const file = DriveApp.getFileById(id);
    const mime = String(file.getMimeType() || "");
    const name = String(file.getName() || "");
    return {
      format: formatFromMime_(mime, name),
      size: sizeBand_(file.getSize(), mime)
    };
  } catch (ignore) {
    /* A record must still be saved if Drive metadata is temporarily
       unavailable. These two optional fields will simply remain blank. */
    return { format:"", size:"" };
  }
}


function backfillFileMetadata_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return { updated:0, unresolved:0 };

  ensureSheetSize_(sh, last, HEADERS.length);
  const count = last - 1;
  const links = sh.getRange(2, 5, count, 1).getValues();
  const current = sh.getRange(2, 17, count, 2).getValues();
  let updated = 0;
  let unresolved = 0;

  for (let i = 0; i < count; i++) {
    const hasFormat = s_(current[i][0]);
    const hasSize = s_(current[i][1]);
    if (hasFormat && hasSize) continue;

    const meta = driveMetadata_(links[i][0]);
    if (!meta.format && !meta.size) {
      unresolved += 1;
      continue;
    }
    if (!hasFormat && meta.format) current[i][0] = meta.format;
    if (!hasSize && meta.size) current[i][1] = meta.size;
    updated += 1;
  }

  if (updated) sh.getRange(2, 17, count, 2).setValues(current);
  return { updated:updated, unresolved:unresolved };
}

function readLists_(ss) {
  const ls = ss.getSheetByName(LISTS_TAB);
  if (!ls) return { clients: [], people: [], topics: [] };
  ensureSheetSize_(ls, 1, 7);
  const last = ls.getLastRow();

  const urls = readFolders_(ss);
  const rows = Math.max(0, last - 1);
  const vals = rows ? ls.getRange(2, 1, rows, 7).getValues() : [];
  const clients = [], people = [], topics = [], seenC = {}, seenP = {}, seenT = {};

  vals.forEach(function (r) {
    const c = String(r[0] || "").trim();
    if (c && !seenC[c.toLowerCase()]) {
      seenC[c.toLowerCase()] = 1;
      clients.push({ name: c, industry: String(r[1] || "").trim(), url: urls["01 Clients > " + c] || "" });
    }
    const p = String(r[3] || "").trim();
    if (p && !seenP[p.toLowerCase()]) {
      seenP[p.toLowerCase()] = 1;
      people.push({ name: p, language: String(r[4] || "").trim(), url: urls["04 People > " + p] || "" });
    }
    const t = s_(r[6]);
    if (t && !seenT[t.toLowerCase()]) {
      seenT[t.toLowerCase()] = 1;
      topics.push(t);
    }
  });

  clients.sort(function (a, b) { return a.name.localeCompare(b.name); });
  people.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return { clients: clients, people: people, topics: topics };
}

function readFolders_(ss) {
  const fs = ss.getSheetByName(FOLDERS_TAB);
  if (!fs) return {};
  ensureSheetSize_(fs, 1, 2);
  const last = fs.getLastRow();
  if (last < 2) return {};
  const out = {};
  fs.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
    const k = String(r[0] || "").trim();
    if (k) out[k] = String(r[1] || "").trim();
  });
  return out;
}

function writeFolders_(ss, map, replaceExisting) {
  const fs = ss.getSheetByName(FOLDERS_TAB) || ss.insertSheet(FOLDERS_TAB);
  ensureSheetSize_(fs, 1, 2);
  fs.getRange("A1:B1").setValues([["Path", "URL"]]);
  const existing = replaceExisting ? {} : readFolders_(ss);
  Object.keys(map).forEach(function (k) { existing[k] = map[k]; });
  const keys = Object.keys(existing).sort();
  if (fs.getLastRow() > 1) fs.getRange(2, 1, fs.getLastRow() - 1, 2).clearContent();
  if (!keys.length) return;
  ensureSheetSize_(fs, keys.length + 1, 2);
  fs.getRange(2, 1, keys.length, 2)
    .setValues(keys.map(function (k) { return [k, existing[k]]; }));
}

function readRecords_(ss) {
  const sh = indexTab_(ss);
  ensureSheetSize_(sh, 1, HEADERS.length);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const vals = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  return vals.map(function (r) {
    return {
      id: String(r[0]), date: String(r[1]), title: String(r[2]), description: String(r[3]),
      driveLink: String(r[4]), docType: String(r[5]), topics: String(r[6]),
      client: String(r[7]), people: String(r[8]), industry: String(r[9]),
      language: String(r[10]), library: String(r[11]), folderPath: String(r[12]),
      year: Number(r[13]) || 0, status: String(r[14]) || "Active", tags: String(r[15] || ""),
      fileFormat: String(r[16] || ""), fileSize: String(r[17] || "")
    };
  }).filter(function (r) { return r.id; });
}

function nextNumber_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return 1;
  const v = String(sh.getRange(last, 1).getValue() || "");
  const m = v.match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) + 1 : last;
}

function formatId_(n) {
  let s = String(n);
  while (s.length < 4) s = "0" + s;
  return "AKR-" + s;
}

function s_(v) { return (v === null || v === undefined) ? "" : String(v).trim(); }

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
