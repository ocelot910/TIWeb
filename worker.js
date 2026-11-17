importScripts("ti2.js");

const romPath = "/boot1.img";
const flashPath = "/flash.img";
const romSize = 512 * 1024;
const chunkSize = 0x840 * 64 * 32;
const chunkCount = 32;
const flashSize = chunkSize * chunkCount;
const chunks = Array.from({ length: chunkCount }, (_, i) => i);
const moduleReady = createTi2({
  print: (line) => console.debug(line),
  printErr: (line) => console.warn(line),
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

function report(type, message) {
  self.postMessage({ type, message });
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
  try {
    const rom = await fetch(new URL("./boot1", self.location.href), { cache: "no-store" });
    if (!rom.ok) return false;
    const romFile = await rom.blob();
    if (romFile.size !== romSize) return false;
    report("loading", "Loading local calculator files…");
    const flash = await fetch(new URL("./installed", self.location.href), { cache: "no-store" });
    if (!flash.ok) return false;
    await install(romFile, await flash.blob());
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
    if (rom.size !== romSize || flash.size !== flashSize) {
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

self.onmessage = ({ data }) => {
  if (data.type === "install") void install(data.rom, data.flash);
  if (!running) return;
  if (data.type === "key") emu._browser_key(data.id, data.down);
  if (data.type === "touch") emu._browser_touch(data.x, data.y, data.contact, data.down);
  if (data.type === "pointer") emu._browser_pointer(data.event, data.x, data.y);
  if (data.type === "save") void save(data.showStatus);
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
