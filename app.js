"use strict";

const byId = id => document.getElementById(id);
const score = byId("score");
const audio = byId("audio");
const play = byId("play");
const seek = byId("seek");
const follow = byId("follow");
const sectionSelect = byId("section");
const syncGuide = byId("sync-guide");
const {pages, events, measures} = performanceData;
const svgNS = "http://www.w3.org/2000/svg";
const positions = new Map();
const starts = new Map();
const noteElements = new Map();
let activeBar = null;
let activeNotes = [];
let lastIndex = -2;
let sectionIndex = -1;
let displayedHarmony = "";
let manualGuide = false;
let frame;

function findLast(items, test) {
  let low = 0, high = items.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (test(items[mid])) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

function svgElement(name, attrs) {
  const element = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

function showError(message) {
  byId("message").textContent = message;
  byId("message").hidden = false;
}

function startPlayback() {
  audio.play().catch(error => {
    if (error.name !== "AbortError") showError("音频无法播放。请确认原始 MP3 与 index.html 在同一个文件夹。");
  });
}

function jump(time) {
  audio.currentTime = time;
  lastIndex = -2;
  render();
  startPlayback();
}

score.innerHTML = pages.join("");

score.querySelectorAll(".note[id]").forEach(note => noteElements.set(note.id, note));
events.forEach(([time, , bar]) => {
  if (!starts.has(bar)) starts.set(bar, time);
});
for (const [bar, id] of measures) {
  const element = byId(id);
  const staffs = [...element.querySelectorAll(":scope > .staff")];
  const lines = staffs.flatMap(staff => [...staff.querySelectorAll(":scope > path")]);
  const staffBoxes = (lines.length ? lines : staffs).map(line => line.getBBox());
  if (!staffBoxes.length) continue;
  const x = Math.min(...staffBoxes.map(box => box.x));
  const right = Math.max(...staffBoxes.map(box => box.x + box.width));
  const top = Math.min(...staffBoxes.map(box => box.y));
  const bottom = Math.max(...staffBoxes.map(box => box.y + box.height));
  const hit = svgElement("rect", {class: "hit", x, y: top - 80, width: right - x,
    height: bottom - top + 160, tabindex: "0", role: "button",
    "aria-label": bar ? `从第 ${bar} 小节播放` : "从弱起播放"});
  const title = svgElement("title", {});
  title.textContent = hit.getAttribute("aria-label");
  hit.append(title);
  hit.addEventListener("click", () => jump(starts.get(bar)));
  hit.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      jump(starts.get(bar));
    }
  });
  const cursor = svgElement("line", {class: "playhead", x1: x, x2: x, y1: top - 36,
    y2: bottom + 36, stroke: "#aa5431", "stroke-width": "13", opacity: ".65"});
  element.append(hit, cursor);
  positions.set(bar, {element, hit, cursor, x});
}

sections.forEach(([, title], index) => sectionSelect.add(new Option(title, index)));

function showSection(index) {
  if (index === sectionIndex) return;
  sectionIndex = index;
  sectionSelect.value = index;
  byId("listen").textContent = sections[index][2];
  byId("detail").textContent = sections[index][3];
}

sectionSelect.addEventListener("change", () => {
  manualGuide = true;
  syncGuide.hidden = false;
  showSection(Number(sectionSelect.value));
});
syncGuide.addEventListener("click", () => {
  manualGuide = false;
  syncGuide.hidden = true;
  lastIndex = -2;
  render();
});

function scrollToBar() {
  if (!activeBar) return;
  const rect = activeBar.hit.getBoundingClientRect();
  const mobile = matchMedia("(max-width: 620px)").matches;
  const upper = document.querySelector(".transport").getBoundingClientRect().bottom + 12;
  const lower = mobile ? document.querySelector("aside").getBoundingClientRect().top : innerHeight;
  if (rect.top < upper || rect.bottom > lower - 12) {
    window.scrollBy({top: rect.top - upper - 12, behavior: "instant"});
  }
  const cursor = activeBar.cursor.getBoundingClientRect();
  const viewport = score.getBoundingClientRect();
  if (cursor.left < viewport.left + 8 || cursor.right > viewport.right - 8) {
    score.scrollLeft += cursor.left - viewport.left - viewport.width * 0.3;
  }
}

function showEvent(index) {
  const [, ids, bar, beat] = index < 0 ? [0, [], 0, 0] : events[index];
  const position = positions.get(bar);
  activeNotes.forEach(note => note.classList.remove("sounding"));
  activeNotes = ids.map(id => noteElements.get(id)).filter(Boolean);
  activeNotes.forEach(note => note.classList.add("sounding"));
  if (position) {
    const anchors = activeNotes.map(note => note.querySelector(".notehead use") ?? note);
    const reference = anchors.find(note => position.element.contains(note));
    let x = position.x;
    if (reference) {
      const box = reference.getBBox();
      const matrix = position.element.getCTM().inverse().multiply(reference.getCTM());
      x = new DOMPoint(box.x + box.width / 2, box.y).matrixTransform(matrix).x;
    }
    position.cursor.setAttribute("x1", x);
    position.cursor.setAttribute("x2", x);
  }
  const barChanged = activeBar !== position;
  if (barChanged) {
    activeBar?.element.classList.remove("active");
    activeBar = position;
    activeBar?.element.classList.add("active");
    
  }
  if (follow.checked && index >= 0) scrollToBar();
  const list = harmonies[bar];
  const harmonyIndex = Math.max(0, findLast(list, entry => entry[0] <= beat + 0.0001));
  const key = list[harmonyIndex][1];
  byId("where").textContent = bar ? `第 ${bar} 小节` : "弱起";
  if (displayedHarmony !== key) {
    displayedHarmony = key;
    ["chord", "roman", "notes", "function"].forEach((id, field) => {
      byId(id).textContent = chords[key][field];
    });
  }
  if (!manualGuide) showSection(findLast(sections, section => section[0] <= bar));
}

function timeLabel(time) {
  const seconds = Math.floor(time);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function render() {
  const time = audio.currentTime;
  seek.value = time;
  byId("clock").value = timeLabel(time);
  const index = findLast(events, event => event[0] <= time);
  if (index !== lastIndex) {
    showEvent(index);
    lastIndex = index;
  }
}

function animate() {
  render();
  if (!audio.paused && !audio.ended) frame = requestAnimationFrame(animate);
}

function reflectPlayback() {
  const playing = !audio.paused && !audio.ended;
  play.textContent = playing ? "Ⅱ" : "▶";
  play.setAttribute("aria-label", playing ? "暂停" : "播放");
  cancelAnimationFrame(frame);
  if (playing) animate();
  else {
    render();
    if (follow.checked && audio.currentTime > 0) scrollToBar();
  }
}

function togglePlayback() {
  if (audio.paused) startPlayback();
  else audio.pause();
}

function setDuration() {
  if (!Number.isFinite(audio.duration)) return;
  seek.max = audio.duration;
  seek.disabled = false;
  byId("duration").value = timeLabel(audio.duration);
}
play.addEventListener("click", togglePlayback);
audio.addEventListener("loadedmetadata", setDuration);
audio.addEventListener("error", () => showError("未能读取本地录音。请确认原始 MP3 仍在项目文件夹中。"));
["play", "pause", "ended"].forEach(type => audio.addEventListener(type, reflectPlayback));
["seeking", "timeupdate"].forEach(type => audio.addEventListener(type, render));
audio.addEventListener("seeked", () => {
  render();
  if (follow.checked) requestAnimationFrame(scrollToBar);
});
seek.addEventListener("input", () => { audio.currentTime = Number(seek.value); render(); });
follow.addEventListener("change", () => { if (follow.checked) scrollToBar(); });
document.addEventListener("keydown", event => {
  if (event.code === "Space" && !event.repeat && !event.defaultPrevented &&
      !event.target.closest("button,input,select,summary,a,[role=button]")) {
    event.preventDefault();
    togglePlayback();
  }
});
if (matchMedia("(max-width: 620px)").matches) document.querySelector(".key").open = false;
setDuration();
render();




