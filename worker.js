importScripts("ti2.js");

const romPath = "/boot1.img";
const flashPath = "/flash.img";
const romSize = 512 * 1024;
const chunkSize = 0x840 * 64 * 32;
const chunkCount = 32;
const flashSize = chunkSize * chunkCount;
const chunks = Array.from({ length: chunkCount }, (_, i) => i);
const transferPath = "/transfer.tns";
const moduleReady = createTi2({
  print: (line) => console.debug(line),
  printErr: (line) => console.warn(line),
  onDocumentEntry(name, directory) {
    documentTransfer?.entries.push({ name, directory });
    renewDocumentTimeout();
  },
  onDocumentProgress(progress) {
    if (!documentTransfer) return;
    if (progress < 0) finishDocumentTransfer(new Error("The calculator rejected the file operation."));
    else if (progress === 100) finishDocumentTransfer();
    else renewDocumentTimeout();
  },
});

let emu;
let database;
let running = false;
let saving = false;
let saveAgain = false;
let pendingChunks = 0;
let unsaved = false;
let lastFrame = 0;
let lastSave = 0;
let documentTransfer;
let handlingDocuments = false;

class DocumentLinkTimeout extends Error {}

function report(type, message) {
  self.postMessage({ type, message });
}

function finishDocumentTransfer(error) {
  const transfer = documentTransfer;
  documentTransfer = undefined;
  clearTimeout(transfer.timeout);
  if (error) transfer.reject(error);
  else transfer.resolve(transfer.entries);
}

function renewDocumentTimeout(delay = 30000) {
  if (!documentTransfer) return;
  clearTimeout(documentTransfer.timeout);
  documentTransfer.timeout = setTimeout(() => {
    finishDocumentTransfer(new DocumentLinkTimeout("The calculator’s file link stopped responding."));
    emu._browser_reset_document_link();
  }, delay);
}

function transferDocument(operation, path) {
  return new Promise((resolve, reject) => {
    documentTransfer = { entries: [], resolve, reject };
    renewDocumentTimeout(8000);
    try {
      emu.ccall("browser_" + operation + "_document" + (operation === "list" ? "s" : ""),
        null, ["string"], [path]);
    } catch (error) {
      finishDocumentTransfer(error);
    }
  });
}

async function readDocumentLink(operation, path) {
  try {
    return await transferDocument(operation, path);
  } catch (error) {
    if (!(error instanceof DocumentLinkTimeout)) throw error;
    return transferDocument(operation, path);
  }
}

function hasDocumentName(entries, name) {
  return entries.some(entry => entry.name.toLowerCase() === name.toLowerCase());
}

async function importDocument(folder, target, file) {
  const entries = await readDocumentLink("list", folder);
  if (hasDocumentName(entries, file.name)) {
    throw new Error("This folder already contains a file or folder with that name.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  emu.FS.writeFile(transferPath, bytes);
  try {
    await transferDocument("import", target);
  } catch (error) {
    if (!(error instanceof DocumentLinkTimeout)) throw error;
    // A lost acknowledgement can leave a complete file on the calculator.
    const refreshed = await readDocumentLink("list", folder);
    if (!hasDocumentName(refreshed, file.name)) {
      await transferDocument("import", target);
      return;
    }
    await readDocumentLink("export", target);
    const received = emu.FS.readFile(transferPath);
    if (received.length !== bytes.length || !received.every((byte, index) => byte === bytes[index])) {
      throw new Error("The file link stopped during import. Check the copy in the destination folder.");
    }
  }
}

function validDocumentName(name) {
  return typeof name === "string" && name !== "" && name !== "." && name !== ".." &&
    !/[\\/\x00-\x1f]/u.test(name);
}

function checkDocumentPath(path) {
  if (typeof path !== "string" || !path.startsWith("/") ||
      (path !== "/" && !path.slice(1).split("/").every(validDocumentName)) ||
      new TextEncoder().encode(path).length > 251) {
    throw new Error("The calculator path is invalid or too long.");
  }
}

async function handleDocuments({ operation, path, file }) {
  if (handlingDocuments) return;
  handlingDocuments = true;
  try {
    checkDocumentPath(path);
    if (operation === "list") {
      const entries = await readDocumentLink("list", path);
      self.postMessage({ type: "documents", entries: entries.filter(entry => validDocumentName(entry.name)) });
      return;
    }
    if (operation === "import") {
      if (!file || !validDocumentName(file.name) || !/\.tns$/i.test(file.name) || !file.size) {
        throw new Error("Choose a nonempty .tns file.");
      }
      const target = (path === "/" ? "" : path) + "/" + file.name;
      checkDocumentPath(target);
      await importDocument(path, target, file);
      self.postMessage({ type: "documents", imported: file.name });
      void save();
      return;
    }
    if (operation === "export" && path !== "/") {
      await readDocumentLink("export", path);
      const bytes = emu.FS.readFile(transferPath);
      self.postMessage({ type: "documents", exported: path.split("/").at(-1), bytes }, [bytes.buffer]);
      return;
    }
    throw new Error("Choose a calculator document.");
  } catch (error) {
    self.postMessage({ type: "documents", error: error.message });
  } finally {
    if (emu.FS.analyzePath(transferPath).exists) emu.FS.unlink(transferPath);
    handlingDocuments = false;
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("firebird-cx-ii", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("images");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readImages() {
  const store = database.transaction("images").objectStore("images");
  return Promise.all(["rom", ...chunks].map((key) => new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  })));
}

function writeImages(entries) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("images", "readwrite");
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error("Storage write was interrupted."));
    const store = transaction.objectStore("images");
    try {
      for (const [key, bytes] of entries) store.put(bytes, key);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

function* flashChunks(mask) {
  const stream = emu.FS.open(flashPath, "r");
  try {
    for (const i of chunks) {
      if (!(mask & (1 << i))) continue;
      const bytes = new Uint8Array(chunkSize);
      if (emu.FS.read(stream, bytes, 0, bytes.length, i * chunkSize) !== bytes.length) {
        throw new Error("Could not read the emulated flash.");
      }
      yield [i, bytes];
    }
  } finally {
    emu.FS.close(stream);
  }
}

function updateSaveState() {
  const next = Boolean(pendingChunks || emu._browser_dirty_chunks());
  if (next !== unsaved) {
    unsaved = next;
    self.postMessage({ type: "save-state", unsaved });
  }
}

async function save(showStatus = false) {
  if (!running) return;
  if (saving) {
    saveAgain = true;
    if (showStatus) report("saving", "Saving…");
    return;
  }
  saving = true;
  updateSaveState();
  try {
    const dirty = emu._browser_dirty_chunks();
    if (dirty) {
      if (!emu._browser_flush_flash()) throw new Error("Could not write the emulated flash.");
      pendingChunks |= dirty;
    }
    if (pendingChunks) {
      await writeImages(flashChunks(pendingChunks));
      pendingChunks = 0;
      if (!emu._browser_dirty_chunks()) report("saved", "Saved on this device");
    } else if (showStatus) {
      report("saved", "Already saved on this device");
    }
  } catch (error) {
    report("error", "Save failed. " + error.message);
  } finally {
    saving = false;
    updateSaveState();
    if (saveAgain) {
      saveAgain = false;
      void save(true);
    }
  }
}

function step() {
  if (!running) return;
  try {
    const wait = emu._browser_step(9);
    const now = performance.now();
    const resumeAt = now + wait;
    if (now - lastFrame >= 33) {
      updateSaveState();
      const offset = emu._browser_frame();
      const buffer = emu.HEAPU8.slice(offset, offset + 320 * 240 * 4).buffer;
      const absolutePointer = Boolean(emu._browser_pointer_enabled());
      self.postMessage({ type: "frame", buffer, absolutePointer }, [buffer]);
      lastFrame = now;
    }
    if (now - lastSave >= 5000) {
      lastSave = now;
      void save();
    }
    setTimeout(step, Math.max(0, Math.ceil(resumeAt - performance.now())));
  } catch (error) {
    running = false;
    report("error", "ti2 stopped. " + error.message);
  }
}

function loadFiles(rom, flash) {
  emu.FS.writeFile(romPath, rom, { canOwn: true });
  emu.FS.writeFile(flashPath, flash, { canOwn: true });
}

function start() {
  if (!emu._browser_start()) throw new Error("ti2 could not open the selected images.");
  running = true;
  report("running", "Running · saves automatically");
  step();
}

async function loadLocalImages() {
  const fetchImage = async (name) => {
    const response = await fetch(new URL("./" + name, self.location.href), { cache: "no-store" });
    return response.ok ? response.blob() : null;
  };
  try {
    const rom = await fetchImage("boot1");
    if (rom?.size !== romSize) return false;
    report("loading", "Loading local calculator files…");
    let flash = await fetchImage("installed");
    if (flash?.size !== flashSize) {
      const [first, second] = await Promise.all([fetchImage("installed1"), fetchImage("installed2")]);
      if (!first?.size || !second?.size || first.size + second.size !== flashSize) return false;
      flash = new Blob([first, second]);
    }
    await install(rom, flash);
    return true;
  } catch (error) {
    console.warn("Could not load local calculator images:", error);
    return false;
  }
}

async function initialize() {
  [emu, database] = await Promise.all([moduleReady, openDatabase()]);
  const [rom, ...storedFlash] = await readImages();
  if (rom?.length !== romSize || storedFlash.some(bytes => bytes?.length !== chunkSize)) {
    if (!rom && !storedFlash.some(Boolean) && await loadLocalImages()) return;
    report("setup", "Select your Boot ROM and installed flash image once.");
    return;
  }
  try {
    const flash = new Uint8Array(flashSize);
    for (const [index, bytes] of storedFlash.entries()) flash.set(bytes, index * chunkSize);
    loadFiles(rom, flash);
    start();
  } catch (error) {
    report("setup", error.message + " Choose the images again.");
  }
}

async function install(rom, flash) {
  try {
    if (rom?.size !== romSize || flash?.size !== flashSize) {
      throw new Error("Expected a 512 KiB Boot ROM and a 132 MiB ti2 flash image.");
    }
    const [romData, flashData] = await Promise.all([rom.arrayBuffer(), flash.arrayBuffer()]);
    const romBytes = new Uint8Array(romData);
    const flashBytes = new Uint8Array(flashData);
    loadFiles(romBytes, flashBytes);
    await writeImages([["rom", romBytes], ...flashChunks(-1)]);
    start();
  } catch (error) {
    report("setup", "Could not start. " + error.message);
  }
}

function installSelectedFiles(rom, files) {
  if (files.length === 1) return install(rom, files[0]);
  if (files.length === 2) {
    const first = files.find(file => /^installed1(?:\.[^.]+)*$/i.test(file.name));
    const second = files.find(file => /^installed2(?:\.[^.]+)*$/i.test(file.name));
    if (first?.size && second?.size) return install(rom, new Blob([first, second]));
  }
  report("setup", "Select a single installed flash image or both installed1 and installed2.");
}

self.onmessage = ({ data }) => {
  if (data.type === "install") void installSelectedFiles(data.rom, data.flashFiles ?? [data.flash]);
  if (!running) return;
  if (data.type === "key") emu._browser_key(data.id, data.down);
  if (data.type === "touch") emu._browser_touch(data.x, data.y, data.contact, data.down);
  if (data.type === "pointer") emu._browser_pointer(data.event, data.x, data.y);
  if (data.type === "save") void save(data.showStatus);
  if (data.type === "documents") void handleDocuments(data);
};

function startWithStorage() {
  if (!navigator.locks) return initialize();
  return navigator.locks.request("firebird-calculator", async () => {
    await initialize();
    // The lock prevents two tabs from writing independent copies of the flash.
    await new Promise(() => {});
  });
}

startWithStorage().catch((error) => report("error", "Could not open local storage. " + error.message));
