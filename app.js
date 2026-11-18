const worker = new Worker(new URL("./worker.js", import.meta.url));
const status = document.querySelector("#status");
const setup = document.querySelector("#setup");
const save = document.querySelector("#save");
const toolbar = document.querySelector("#toolbar");
const documents = document.querySelector("#documents");
const documentsTitle = document.querySelector("#documents-title");
const documentsStatus = document.querySelector("#documents-status");
const documentsPath = document.querySelector("#documents-path");
const documentsUp = document.querySelector("#documents-up");
const documentsClose = document.querySelector("#documents-close");
const documentList = document.querySelector("#document-list");
const documentImport = document.querySelector("#document-import");
const importHere = document.querySelector("#import-here");
const lcd = document.querySelector("#lcd").getContext("2d");
const screen = lcd.canvas;
const touchpad = document.querySelector("#touchpad");
const contact = document.querySelector("#contact");
const keypad = document.querySelector("#keypad");
const pressed = new Map();
const keyboard = new Map();
const tapDuration = 75;
let running = false;
let absolutePointer = false;
let unsaved = false;
let savePending = false;

// Hit areas use the original SVG's 252 × 386 coordinate system.
const keys = [
  ["Esc", 73, [11.02, 43.92, 46, 28], "Escape"],
  ["Home", 9, [195.02, 43.92, 46, 28], "Home"],
  ["Scratchpad", 65, [11.02, 71.92, 46, 28], "End"],
  ["Doc", 69, [195.02, 71.92, 46, 28], "PageUp"],
  ["Tab", 75, [11.02, 99.92, 46, 28], "Tab"],
  ["Menu", 71, [195.02, 99.92, 46, 28], "PageDown"],
  ["Ctrl", 86, [11.02, 138.7, 46, 28], "Control"],
  ["Shift", 85, [57.02, 138.7, 46, 28], "Shift"],
  ["var", 56, [149.02, 138.71, 46, 28], "Insert"],
  ["Del", 64, [195.02, 138.71, 46, 28], "Backspace", "Delete"],
  ["=", 51, [11.02, 166.7, 23, 28], "="],
  ["trig", 20, [33.99, 166.7, 23, 28]],
  ["7", 40, [57.02, 166.7, 46, 28], "7"],
  ["8", 72, [103.02, 166.7, 46, 28], "8"],
  ["9", 36, [149.02, 166.7, 46, 28], "9"],
  ["□/□", 63, [195.02, 166.7, 22.98, 28]],
  ["catalog", 62, [218.02, 166.7, 23, 28]],
  ["^", 53, [11.02, 194.7, 23, 28.12], "^"],
  ["x²", 31, [34.02, 194.7, 23, 28.12]],
  ["4", 29, [57.02, 194.7, 46, 28.12], "4"],
  ["5", 61, [103.02, 194.7, 46, 28.12], "5"],
  ["6", 25, [149.02, 194.7, 46, 28.12], "6"],
  ["×", 52, [195.02, 194.7, 23, 28.12], "*"],
  ["÷", 41, [218, 194.7, 23.02, 28.12], "/"],
  ["eˣ", 42, [11.02, 222.82, 23, 27.77]],
  ["10ˣ", 21, [34.02, 222.82, 23, 27.77]],
  ["1", 18, [57.02, 222.82, 46, 27.77], "1"],
  ["2", 70, [103.02, 222.82, 46, 27.77], "2"],
  ["3", 14, [149.02, 222.82, 46, 27.77], "3"],
  ["+", 68, [195.02, 222.82, 23, 27.77], "+"],
  ["−", 57, [218.02, 222.82, 23, 27.77], "-"],
  ["(", 60, [11.02, 250.59, 23, 28.81], "("],
  [")", 58, [34.02, 250.59, 23, 28.81], ")"],
  ["0", 7, [57.02, 250.59, 46, 28.81], "0"],
  [".", 59, [103.02, 250.59, 46, 28.81], "."],
  ["(−)", 3, [149.02, 250.59, 46, 28.81]],
  ["Enter", 1, [195.02, 250.59, 46, 28.81], "Enter"],
  ["EE", 30, [10.98, 290.68, 25.77, 20.04]],
  ["A", 50, [36.75, 290.68, 25.5, 20.04]],
  ["B", 49, [62.25, 290.68, 25.5, 20.04]],
  ["C", 48, [87.75, 290.68, 25.5, 20.04]],
  ["D", 46, [113.25, 290.68, 25.5, 20.04]],
  ["E", 45, [138.75, 290.68, 25.5, 20.04]],
  ["F", 44, [164.25, 290.68, 25.5, 20.04]],
  ["G", 39, [189.75, 290.68, 25.5, 20.04]],
  ["?!", 8, [215.25, 290.68, 25.5, 20.04]],
  ["π", 19, [10.98, 310.72, 25.77, 20.04]],
  ["H", 38, [36.75, 310.72, 25.5, 20.04]],
  ["I", 37, [62.25, 310.72, 25.5, 20.04]],
  ["J", 35, [87.75, 310.72, 25.5, 20.04]],
  ["K", 34, [113.25, 310.72, 25.5, 20.04]],
  ["L", 33, [138.75, 310.72, 25.5, 20.04]],
  ["M", 28, [164.25, 310.72, 25.5, 20.04]],
  ["N", 27, [189.75, 310.72, 25.5, 20.04]],
  ["flag", 66, [215.25, 310.72, 25.5, 20.04]],
  [",", 87, [10.98, 330.77, 25.77, 20.04], ","],
  ["O", 26, [36.75, 330.77, 25.5, 20.04]],
  ["P", 24, [62.25, 330.77, 25.5, 20.04]],
  ["Q", 23, [87.75, 330.77, 25.5, 20.04]],
  ["R", 22, [113.25, 330.77, 25.5, 20.04]],
  ["S", 17, [138.75, 330.77, 25.5, 20.04]],
  ["T", 16, [164.25, 330.77, 25.5, 20.04]],
  ["U", 15, [189.75, 330.77, 25.5, 20.04]],
  ["↵", 0, [215.25, 330.77, 25.5, 20.04]],
  ["V", 13, [36.75, 350.81, 25.5, 20.04]],
  ["W", 12, [62.25, 350.81, 25.5, 20.04]],
  ["X", 11, [87.75, 350.81, 25.5, 20.04]],
  ["Y", 6, [113.25, 350.81, 25.5, 20.04]],
  ["Z", 5, [138.75, 350.81, 25.5, 20.04]],
  ["space", 4, [164.25, 350.81, 51, 20.04], " "],
];

function setKey(id, source, down) {
  if (!running) return;
  let sources = pressed.get(id);
  if (down) {
    if (!sources) {
      sources = new Set();
      pressed.set(id, sources);
      worker.postMessage({ type: "key", id, down: true });
    }
    sources.add(source);
  } else if (sources?.delete(source) && !sources.size) {
    pressed.delete(id);
    worker.postMessage({ type: "key", id, down: false });
  }
  document.querySelector('[data-key="' + id + '"]').toggleAttribute("data-pressed", pressed.has(id));
}

for (const [label, id, [x, y, width, height], ...shortcuts] of keys) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.dataset.key = id;
  button.style.left = x / 252 * 100 + "%";
  button.style.top = y / 386 * 100 + "%";
  button.style.width = width / 252 * 100 + "%";
  button.style.height = height / 386 * 100 + "%";
  keypad.append(button);
  for (const key of shortcuts) keyboard.set(key, id);
  if (/^[A-Z]$/.test(label)) keyboard.set(label.toLowerCase(), id);
  const pointers = new Map();
  button.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    const press = { at: performance.now() };
    pointers.set(event.pointerId, press);
    setKey(id, press, true);
  });
  for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
    button.addEventListener(eventName, (event) => {
      const press = pointers.get(event.pointerId);
      if (!press) return;
      pointers.delete(event.pointerId);
      // A very short browser tap still needs to span a guest keypad scan.
      const remaining = event.type === "pointerup" ? tapDuration - (performance.now() - press.at) : 0;
      if (remaining > 0) setTimeout(() => setKey(id, press, false), remaining);
      else setKey(id, press, false);
    });
  }
  button.addEventListener("click", (event) => {
    if (event.detail !== 0 || event.pointerType) return; // Keyboard and assistive-technology activation.
    setKey(id, button, true);
    setTimeout(() => setKey(id, button, false), tapDuration);
  });
}

function setTouch(x, y, touching, down) {
  if (!running) return;
  worker.postMessage({ type: "touch", x, y, contact: touching, down });
  contact.hidden = !touching;
  contact.style.left = x * 100 + "%";
  contact.style.top = y * 100 + "%";
  contact.toggleAttribute("data-down", down);
}

let gesture;
let tapRelease;
let activeArrow;
const directions = new Map([
  ["ArrowUp", [.5, 0]], ["ArrowLeft", [0, .5]],
  ["ArrowDown", [.5, 1]], ["ArrowRight", [1, .5]],
]);

function position(event) {
  const rect = touchpad.getBoundingClientRect();
  return [
    Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  ];
}

touchpad.addEventListener("pointerdown", (event) => {
  if (!running || gesture || event.button !== 0) return;
  event.preventDefault();
  clearTimeout(tapRelease);
  activeArrow = null;
  touchpad.setPointerCapture(event.pointerId);
  const start = {
    id: event.pointerId, originX: event.clientX, originY: event.clientY,
    position: position(event), moved: false, down: false,
  };
  gesture = start;
  setTouch(...start.position, true, false);
  start.hold = setTimeout(() => {
    start.down = true;
    setTouch(...start.position, true, true);
  }, 200);
});

touchpad.addEventListener("pointermove", (event) => {
  if (event.pointerId !== gesture?.id) return;
  gesture.position = position(event);
  if (Math.hypot(event.clientX - gesture.originX, event.clientY - gesture.originY) > 5) {
    gesture.moved = true;
    clearTimeout(gesture.hold);
  }
  setTouch(...gesture.position, true, gesture.down);
});

function finishGesture(event) {
  if (event.pointerId !== gesture?.id) return;
  const { hold, moved, down, position: point } = gesture;
  gesture = null;
  clearTimeout(hold);
  if (event.type === "pointerup" && !moved && !down) {
    setTouch(...point, true, true);
    tapRelease = setTimeout(() => setTouch(...point, false, false), tapDuration);
  } else {
    setTouch(...point, false, false);
  }
}
for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
  touchpad.addEventListener(eventName, finishGesture);
}

const hostKeys = new Map();

function screenPoint(event, clamp = false) {
  const rect = screen.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) * screen.width / rect.width);
  const y = Math.floor((event.clientY - rect.top) * screen.height / rect.height);
  if (clamp) return [
    Math.max(0, Math.min(screen.width - 1, x)),
    Math.max(0, Math.min(screen.height - 1, y)),
  ];
  if (x >= 0 && x < screen.width && y >= 0 && y < screen.height) return [x, y];
}

const pointerEvent = { move: 1, down: 2, up: 4, grabDown: 6, grabUp: 8, rightClick: 10 };
function sendPointer(event, [x, y]) {
  worker.postMessage({ type: "pointer", event, x, y });
}

let screenTap;
screen.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (!absolutePointer || screenTap) return;
  const point = screenPoint(event);
  if (point) sendPointer(pointerEvent.rightClick, point);
});
screen.addEventListener("pointerdown", (event) => {
  if (!absolutePointer || !event.isPrimary || event.button !== 0 || screenTap) return;
  const point = screenPoint(event);
  if (!point) return;
  screenTap = { id: event.pointerId, start: point, point };
  screen.setPointerCapture(event.pointerId);
  sendPointer(pointerEvent.move, point);
});
screen.addEventListener("pointermove", (event) => {
  if (!absolutePointer || !event.isPrimary || (screenTap && screenTap.id !== event.pointerId)) return;
  const active = screenTap?.id === event.pointerId;
  const point = screenPoint(event, active);
  if (active && point) {
    screenTap.point = point;
    const [x, y] = screenTap.start;
    if (!screenTap.moved && Math.hypot(point[0] - x, point[1] - y) >= 4) {
      screenTap.moved = true;
      sendPointer(pointerEvent.grabDown, screenTap.start);
    }
  }
  if (point && (active || event.pointerType !== "touch"))
    sendPointer(pointerEvent.move, point);
});

for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
  screen.addEventListener(type, (event) => {
    if (screenTap?.id !== event.pointerId) return;
    const { moved, point, start } = screenTap;
    screenTap = undefined;
    const end = type === "pointerup" ? screenPoint(event, true) : point;
    if (moved) {
      sendPointer(pointerEvent.move, end);
      sendPointer(pointerEvent.grabUp, end);
    } else if (type === "pointerup") {
      sendPointer(pointerEvent.down, start);
      sendPointer(pointerEvent.up, end);
    }
  });
}

window.addEventListener("keydown", (event) => {
  if (!running || documents.open || event.metaKey || event.altKey ||
      (event.ctrlKey && ["r", "l", "w", "t"].includes(event.key.toLowerCase()))) return;
  if (event.target.closest?.("button, input") && ["Enter", " ", "Tab"].includes(event.key)) return;
  const direction = directions.get(event.key);
  const id = keyboard.get(event.key.toLowerCase()) ?? keyboard.get(event.key);
  if (!direction && id === undefined) return;
  event.preventDefault();
  if (event.repeat) return;
  if (direction) {
    if (!gesture) {
      clearTimeout(tapRelease);
      activeArrow = event.code;
      setTouch(...direction, true, true);
    }
  } else {
    hostKeys.set(event.code, id);
    setKey(id, event.code, true);
  }
});

window.addEventListener("keyup", (event) => {
  if (event.code === activeArrow) {
    activeArrow = null;
    setTouch(.5, .5, false, false);
  }
  if (!hostKeys.has(event.code)) return;
  setKey(hostKeys.get(event.code), event.code, false);
  hostKeys.delete(event.code);
});

window.addEventListener("blur", () => {
  if (screenTap?.moved) sendPointer(pointerEvent.grabUp, screenTap.point);
  screenTap = undefined;
  for (const [id, sources] of pressed) {
    for (const source of sources) setKey(id, source, false);
  }
  hostKeys.clear();
  clearTimeout(gesture?.hold);
  clearTimeout(tapRelease);
  gesture = activeArrow = null;
  setTouch(.5, .5, false, false);
});

setup.addEventListener("submit", (event) => {
  event.preventDefault();
  setup.querySelector("button").disabled = true;
  status.textContent = "Saving images on this device…";
  worker.postMessage({
    type: "install", rom: setup.elements.rom.files[0], flashFiles: [...setup.elements.flash.files],
  });
});

save.addEventListener("click", () => {
  savePending = true;
  updateSaveButton();
  status.textContent = "Saving…";
  worker.postMessage({ type: "save", showStatus: true });
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && running) worker.postMessage({ type: "save" });
});

function warnBeforeLeaving(event) {
  event.preventDefault();
  event.returnValue = true;
}

function updateSaveButton() {
  save.textContent = savePending ? "Saving…" : unsaved ? "Save now" : "Saved";
  save.disabled = savePending || !unsaved;
}

let documentMode;
let currentFolder;
let requestedFolder;
let documentBusy = false;

function setDocumentBusy(busy) {
  documentBusy = busy;
  documentsClose.disabled = busy;
  documentsUp.disabled = busy || !currentFolder || currentFolder === "/";
  importHere.disabled = busy || !currentFolder;
  documentList.querySelectorAll("button").forEach(button => { button.disabled = busy; });
}

function requestDocuments(operation, path, message, file) {
  setDocumentBusy(true);
  documentsStatus.textContent = message;
  worker.postMessage({ type: "documents", operation, path, file });
}

function openFolder(path) {
  requestedFolder = path;
  requestDocuments("list", path, "Reading calculator folders…");
}

for (const mode of ["import", "export"]) {
  document.querySelector("#" + mode).addEventListener("click", () => {
    documentMode = mode;
    currentFolder = undefined;
    documentsTitle.textContent = mode === "import" ? "Import to calculator" : "Export from calculator";
    documentsPath.textContent = "/";
    documentList.replaceChildren();
    documentImport.reset();
    documentImport.hidden = mode !== "import";
    documents.showModal();
    openFolder("/");
  });
}

documents.addEventListener("cancel", event => {
  if (documentBusy) event.preventDefault();
});
documentsUp.addEventListener("click", () => {
  openFolder(currentFolder.slice(0, currentFolder.lastIndexOf("/")) || "/");
});
documentImport.addEventListener("submit", event => {
  event.preventDefault();
  const file = documentImport.querySelector("input").files[0];
  if (file && /\.tns$/i.test(file.name)) {
    requestDocuments("import", currentFolder, "Importing " + file.name + "…", file);
  } else {
    documentsStatus.textContent = "Choose a .tns file.";
  }
});

function displayDocuments(data) {
  if (data.entries) {
    currentFolder = requestedFolder;
    documentsPath.textContent = currentFolder;
    documentList.replaceChildren();
    const entries = data.entries.filter(entry => entry.directory || documentMode === "export");
    entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = entry.name + (entry.directory ? "/" : "");
      button.addEventListener("click", () => {
        const path = (currentFolder === "/" ? "" : currentFolder) + "/" + entry.name;
        if (entry.directory) openFolder(path);
        else requestDocuments("export", path, "Exporting " + entry.name + "…");
      });
      item.append(button);
      documentList.append(item);
    }
    documentsStatus.textContent = entries.length ? "" : documentMode === "import" ?
      "No subfolders here." : "This folder is empty.";
  } else if (data.imported) {
    documentImport.reset();
    documentsStatus.textContent = "Imported " + data.imported + ".";
  } else if (data.exported) {
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([data.bytes], { type: "application/octet-stream" }));
    link.href = url;
    link.download = data.exported;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    documentsStatus.textContent = "Exported " + data.exported + ".";
  } else {
    documentsStatus.textContent = data.error;
  }
  setDocumentBusy(false);
}

worker.addEventListener("message", ({ data }) => {
  if (data.type === "documents") {
    displayDocuments(data);
    return;
  }
  if (data.type === "save-state") {
    unsaved = data.unsaved;
    if (!unsaved) savePending = false;
    updateSaveButton();
    if (unsaved) window.addEventListener("beforeunload", warnBeforeLeaving);
    else window.removeEventListener("beforeunload", warnBeforeLeaving);
    return;
  }
  if (data.type === "frame") {
    absolutePointer = data.absolutePointer;
    const frame = new Uint8ClampedArray(data.buffer);
    lcd.putImageData(new ImageData(frame, screen.width, screen.height), 0, 0);
    return;
  }
  if (data.type === "error" || data.type === "saved") {
    savePending = false;
    updateSaveButton();
  }
  status.textContent = data.message;
  if (data.type === "setup") {
    setup.hidden = false;
    setup.querySelector("button").disabled = false;
  } else if (data.type === "running") {
    running = true;
    setup.hidden = true;
    toolbar.hidden = false;
  }
});
worker.addEventListener("error", () => {
  status.textContent = "ti2 could not load. Check that the WebAssembly build is present.";
});
