"use strict";

/* ══════════════════════════════════════════
   CONFIG
══════════════════════════════════════════ */
const DEMO_MODE = true;               // set false to hide the demo credentials hint
const DEFAULT_CAPACITY = 100;
const MAX_CAPACITY = 10000;
const MAX_TICKETS_PER_BOOKING = 50;
const MAX_PRICE = 100000;
const SESSION_TIMEOUT = 5 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 30 * 1000;

const ROLES = ["admin", "staff"];
const ADMIN_SECTIONS = ["priceSection", "capacitySection", "reportsSection", "cancelSection"];
const ALLOWED_ACTIONS = new Set([
  "pickRole", "doLogin", "logout", "showSection", "resetStorage",
  "addPassenger", "addRoute", "setPrice", "setCapacity", "addSchedule",
  "confirmBooking", "cancelBooking", "onTrainSelect", "updateTotalPrice",
  "showStatCapacity", "generateSummaryReport", "generateWagensSummary",
  "recalculateReports"
]);
const DATA_KEYS = [
  "passengers", "trains", "capacities", "schedules", "trainRoutes",
  "routes", "prices", "bookings", "reservations", "bookingLogs"
];

/*
 * DEMO ONLY. Credentials checked in the browser can always be read or bypassed
 * by anyone with dev tools. Real authentication must be verified on a server.
 * Passwords are stored as salted SHA-256 hashes so they are not plain text.
 */
const DEMO_ACCOUNTS = [
  { username: "admin", role: "admin", salt: "wagens-admin-v1",
    hash: "020608c4adf3692314684ed1d04c905318f791cb11802a99b665f0b428bf8dea" },
  { username: "staff", role: "staff", salt: "wagens-staff-v1",
    hash: "aa91060bc6956959f9438a0539d34a98c9cc435c08ce79f06f89ad46d16c1bf9" }
];

const NAME_RE = /^[\p{L}\p{N} .'_-]{1,60}$/u;
const TRAIN_RE = /^[\p{L}\p{N} ._/-]{1,40}$/u;
const TEXT_RE = /^[^\u0000-\u001f<>]{1,80}$/u;
const PHONE_RE = /^05\d{8}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

let sessionTimer = null;
let lastActivity = 0;
let currentRole = "admin";   // role highlighted on the login screen
const memStore = {};         // fallback when browser storage is unavailable

/* ══════════════════════════════════════════
   SMALL HELPERS
══════════════════════════════════════════ */
function $(id) { return document.getElementById(id); }

function own(obj, key, fallback) {
  return Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : fallback;
}

function has(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isSafeKey(key) {
  return typeof key === "string" && key.length > 0 && !UNSAFE_KEYS.has(key);
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(n) {
  return Number(toNumber(n).toFixed(2)) + " SAR";
}

function fmtDate(value) {
  const d = new Date(value);
  return isNaN(d.getTime()) ? (value ? String(value) : "—") : d.toLocaleString();
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function showMessage(msg, type) {
  const box = $("output");
  if (!box) return;
  box.style.display = "block";
  box.textContent = msg;
  box.classList.toggle("error", type === "error");
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(function () { box.style.display = "none"; }, 4000);
}

/* Build table rows with textContent so stored data can never inject HTML. */
function appendRow(body, values) {
  const tr = document.createElement("tr");
  values.forEach(function (v) {
    const td = document.createElement("td");
    td.textContent = v === null || v === undefined || v === "" ? "—" : String(v);
    tr.appendChild(td);
  });
  body.appendChild(tr);
}

function appendEmptyRow(body, colspan, text) {
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.colSpan = colspan;
  td.textContent = text;
  tr.appendChild(td);
  body.appendChild(tr);
}

function fillSelect(id, items, emptyText) {
  const drop = $(id);
  if (!drop) return;
  const prev = drop.value;
  drop.replaceChildren();

  if (items.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = emptyText;
    drop.appendChild(opt);
    return;
  }
  items.forEach(function (item) {
    const opt = document.createElement("option");
    opt.value = item;
    opt.textContent = item;
    drop.appendChild(opt);
  });
  if (items.includes(prev)) drop.value = prev;
}

/* ══════════════════════════════════════════
   STORAGE
══════════════════════════════════════════ */
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/* Returns stored data only if it has the same shape as the fallback. */
function load(key, fallback) {
  let value;
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return has(memStore, key) ? memStore[key] : fallback;
    value = JSON.parse(raw);
  } catch (e) {
    return has(memStore, key) ? memStore[key] : fallback;
  }
  if (Array.isArray(fallback)) return Array.isArray(value) ? value : fallback;
  if (isPlainObject(fallback)) return isPlainObject(value) ? value : fallback;
  return value === null || value === undefined ? fallback : value;
}

function save(key, value) {
  memStore[key] = value;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    showMessage("Storage is full or unavailable. Changes may not persist.", "error");
    return false;
  }
}

/* The role lives in sessionStorage only: it ends with the tab. */
function getRole() {
  let role = null;
  try { role = sessionStorage.getItem("role"); } catch (e) { role = memStore.role || null; }
  return ROLES.includes(role) ? role : null;
}

function setRole(role) {
  memStore.role = role;
  try { sessionStorage.setItem("role", role); } catch (e) { /* memory fallback */ }
}

function clearRole() {
  delete memStore.role;
  try { sessionStorage.removeItem("role"); } catch (e) { /* ignore */ }
}

/* ══════════════════════════════════════════
   ACCESS CONTROL
══════════════════════════════════════════ */
function requireLogin() {
  if (getRole()) return true;
  showMessage("Please log in first.", "error");
  return false;
}

function requireAdmin() {
  if (!requireLogin()) return false;
  if (getRole() === "admin") return true;
  showMessage("Only admin can do this.", "error");
  return false;
}

/* ══════════════════════════════════════════
   LOGIN
══════════════════════════════════════════ */
function pickRole(role) {
  if (!ROLES.includes(role)) return;
  currentRole = role;
  const a = $("adminBtn"), s = $("staffBtn"), u = $("username");
  if (a) { a.className = "role-btn" + (role === "admin" ? " admin-on" : ""); a.setAttribute("aria-pressed", role === "admin"); }
  if (s) { s.className = "role-btn" + (role === "staff" ? " staff-on" : ""); s.setAttribute("aria-pressed", role === "staff"); }
  if (u) u.value = role;   // convenience only; the password is still required
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map(function (b) { return b.toString(16).padStart(2, "0"); })
    .join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readLockState() {
  try {
    return {
      fails: toNumber(sessionStorage.getItem("loginFails")),
      until: toNumber(sessionStorage.getItem("loginLockUntil"))
    };
  } catch (e) {
    return { fails: toNumber(memStore.loginFails), until: toNumber(memStore.loginLockUntil) };
  }
}

function writeLockState(fails, until) {
  memStore.loginFails = fails;
  memStore.loginLockUntil = until;
  try {
    sessionStorage.setItem("loginFails", String(fails));
    sessionStorage.setItem("loginLockUntil", String(until));
  } catch (e) { /* memory fallback */ }
}

async function doLogin() {
  const err = $("loginError");
  const btn = document.querySelector('[data-click="doLogin"]');
  const fail = function (msg) { if (err) err.textContent = msg; };

  const lock = readLockState();
  if (lock.until > Date.now()) {
    fail("Too many attempts. Try again in " + Math.ceil((lock.until - Date.now()) / 1000) + "s.");
    return;
  }

  const username = ($("username") ? $("username").value : "").trim().toLowerCase();
  const password = $("password") ? $("password").value : "";

  if (!username || !password) { fail("Enter both username and password."); return; }
  if (!(window.crypto && crypto.subtle)) {
    fail("Login needs a secure context (https:// or localhost).");
    return;
  }

  if (btn) btn.disabled = true;
  try {
    const account = DEMO_ACCOUNTS.find(function (a) { return a.username === username; });
    // Always hash, even for unknown users, so timing does not reveal valid usernames.
    const hash = await sha256Hex((account ? account.salt : "unknown") + ":" + password);
    const ok = Boolean(account) && safeEqual(hash, account.hash);

    if (!ok) {
      const fails = lock.fails + 1;
      if (fails >= MAX_LOGIN_ATTEMPTS) {
        writeLockState(0, Date.now() + LOGIN_LOCK_MS);
        fail("Too many attempts. Try again in " + LOGIN_LOCK_MS / 1000 + "s.");
      } else {
        writeLockState(fails, 0);
        fail("Invalid username or password.");
      }
      return;
    }

    writeLockState(0, 0);
    fail("");
    if ($("password")) $("password").value = "";

    setRole(account.role);
    $("loginPage").style.display = "none";
    $("dashPage").style.display = "block";
    initDash(account.role);
    resetSessionTimer();
  } finally {
    if (btn) btn.disabled = false;
  }
}

function logout(reason) {
  clearRole();
  clearTimeout(sessionTimer);
  sessionTimer = null;

  if ($("dashPage")) $("dashPage").style.display = "none";
  if ($("loginPage")) $("loginPage").style.display = "flex";

  document.querySelectorAll(".section").forEach(function (s) {
    s.style.display = "none";
    s.classList.remove("active");
  });

  if ($("password")) $("password").value = "";
  setText("loginError", typeof reason === "string" ? reason : "");
  pickRole("admin");
}

/* ══════════════════════════════════════════
   DASHBOARD INIT / NAVIGATION
══════════════════════════════════════════ */
function initDash(role) {
  setText("topbarAvatar", role === "admin" ? "AD" : "ST");
  setText("topbarRole", role === "admin" ? "Admin" : "Staff");

  document.querySelectorAll(".nav-btn, #adminDivider").forEach(function (el) {
    el.style.display = "";
  });

  if (role === "staff") {
    ["capacityBtn", "priceBtn", "reportsBtn", "resetBtn", "reallocationBtn", "adminDivider"]
      .forEach(function (id) { const el = $(id); if (el) el.style.display = "none"; });
  }

  refreshUI();
  showSection("bookingSection", $("bookingBtn"));
}

const SECTION_TITLES = {
  bookingSection: "Book a Train",
  passengerSection: "Passengers",
  routeSection: "Routes",
  priceSection: "Pricing",
  capacitySection: "Capacity",
  scheduleSection: "Add Train",
  reportsSection: "Reports",
  cancelSection: "Cancel Booking"
};

function showSection(id, btn) {
  if (!has(SECTION_TITLES, id)) return;
  if (ADMIN_SECTIONS.includes(id) && !requireAdmin()) return;
  if (!requireLogin()) return;

  document.querySelectorAll(".section").forEach(function (s) {
    s.style.display = "none";
    s.classList.remove("active");
  });

  const el = $(id);
  if (el) { el.style.display = "block"; el.classList.add("active"); }

  setText("topbarTitle", SECTION_TITLES[id]);

  const sr = $("statsRow");
  if (sr) sr.style.display = id === "bookingSection" ? "flex" : "none";

  document.querySelectorAll(".nav-btn").forEach(function (b) { b.classList.remove("active"); });
  if (btn && btn.classList) btn.classList.add("active");

  if (id === "bookingSection") { refreshStats(); onTrainSelect(); updateTotalPrice(); }
  if (id === "passengerSection") renderPassengerTable();
  if (id === "reportsSection") updateReports();
}

/* Single refresh entry point. No render function below calls refreshUI(). */
function refreshUI() {
  updateTrainDropdowns();
  updateRoutePriceDropdown();
  renderPassengerTable();
  renderBookingTable();
  refreshStats();
  updateReports();
}

/* ══════════════════════════════════════════
   PASSENGERS
══════════════════════════════════════════ */
function addPassenger() {
  if (!requireLogin()) return;

  const name = $("pName").value.trim();
  const phone = $("pPhone").value.trim();
  const email = $("pEmail").value.trim();

  if (!name || !phone || !email) { showMessage("Fill all fields!", "error"); return; }
  if (!NAME_RE.test(name) || !isSafeKey(name)) {
    showMessage("Name may only contain letters, numbers, spaces and . ' _ -", "error");
    return;
  }
  if (!PHONE_RE.test(phone)) { showMessage("Phone must start with 05 and be 10 digits.", "error"); return; }
  if (email.length > 254 || email.includes("..") || !EMAIL_RE.test(email)) {
    showMessage("Invalid email format.", "error");
    return;
  }

  const passengers = load("passengers", {});
  if (has(passengers, name)) { showMessage("Passenger already exists!", "error"); return; }

  passengers[name] = { name: name, phone: phone, email: email, registeredAt: new Date().toISOString() };
  save("passengers", passengers);

  $("pName").value = "";
  $("pPhone").value = "";
  $("pEmail").value = "";

  showMessage("Passenger added successfully.");
  refreshUI();
}

function renderPassengerTable() {
  const body = $("passengerTableBody");
  if (!body) return;

  const passengers = load("passengers", {});
  const reservations = load("reservations", []);
  const trainRoutes = load("trainRoutes", {});

  body.replaceChildren();
  const names = Object.keys(passengers);

  if (names.length === 0) {
    appendEmptyRow(body, 7, "No passengers registered yet");
    return;
  }

  names.forEach(function (name) {
    const p = passengers[name] || {};
    const mine = reservations.filter(function (r) { return r && r.name === name; });

    if (mine.length === 0) {
      appendRow(body, [name, p.phone, p.email, "—", "—", 0, fmtDate(p.registeredAt)]);
      return;
    }
    mine.forEach(function (r) {
      const info = own(trainRoutes, r.train, null);
      appendRow(body, [name, p.phone, p.email, r.train, info && info.route, r.tickets, fmtDate(r.date || p.registeredAt)]);
    });
  });
}

/* ══════════════════════════════════════════
   TRAINS
══════════════════════════════════════════ */
function addSchedule() {
  if (!requireLogin()) return;

  const input = $("train");
  const train = input.value.trim();
  if (!train) { showMessage("Enter train name!", "error"); return; }
  if (!TRAIN_RE.test(train) || !isSafeKey(train)) {
    showMessage("Train name may only contain letters, numbers, spaces and . _ / -", "error");
    return;
  }

  const trains = load("trains", []);
  const capacities = load("capacities", {});
  if (trains.includes(train)) { showMessage("Train already exists!", "error"); return; }

  trains.push(train);
  capacities[train] = DEFAULT_CAPACITY;
  save("trains", trains);
  save("capacities", capacities);

  const schedules = load("schedules", []);
  schedules.push({ train: train, date: new Date().toISOString() });
  save("schedules", schedules);

  input.value = "";
  showMessage("Train added with a default capacity of " + DEFAULT_CAPACITY + ".");
  refreshUI();
}

function updateTrainDropdowns() {
  const trains = load("trains", []);
  ["trainName", "trainNameCap", "trainNameRoute"].forEach(function (id) {
    fillSelect(id, trains, "— No trains added —");
  });
}

function updateRoutePriceDropdown() {
  fillSelect("routePriceSelect", load("routes", []), "— No routes added —");
}

/* ══════════════════════════════════════════
   ROUTES / PRICING / CAPACITY
══════════════════════════════════════════ */
function addRoute() {
  if (!requireLogin()) return;

  const train = $("trainNameRoute").value;
  const route = $("routeInput").value.trim();
  const time = $("timeInput").value.trim();

  if (!train || !isSafeKey(train)) { showMessage("Add a train first!", "error"); return; }
  if (!route || !time) { showMessage("Fill all fields!", "error"); return; }
  if (!TEXT_RE.test(route)) { showMessage("Route contains invalid characters.", "error"); return; }
  if (!TIME_RE.test(time)) { showMessage("Time must look like 08:30.", "error"); return; }

  const trainRoutes = load("trainRoutes", {});
  trainRoutes[train] = { route: route, time: time };
  save("trainRoutes", trainRoutes);

  const routes = load("routes", []);
  if (!routes.includes(route)) routes.push(route);
  save("routes", routes);

  $("routeInput").value = "";
  showMessage("Route assigned to train.");
  refreshUI();
}

function setPrice() {
  if (!requireAdmin()) return;

  const route = $("routePriceSelect").value;
  const raw = $("priceInput").value.trim();

  if (!route || !isSafeKey(route)) { showMessage("Add a route first!", "error"); return; }
  if (raw === "") { showMessage("Enter a price!", "error"); return; }

  const price = Number(raw);
  if (!Number.isFinite(price) || price <= 0 || price > MAX_PRICE) {
    showMessage("Price must be greater than 0 and at most " + MAX_PRICE + ".", "error");
    return;
  }

  const prices = load("prices", {});
  prices[route] = Number(price.toFixed(2));
  save("prices", prices);

  showMessage("Price set for route.");
  refreshUI();
  updateTotalPrice();
}

function setCapacity() {
  if (!requireAdmin()) return;

  const train = $("trainNameCap").value;
  const cap = Number($("cap").value);

  if (!train || !isSafeKey(train)) { showMessage("Add a train first!", "error"); return; }
  if (!Number.isInteger(cap) || cap <= 0 || cap > MAX_CAPACITY) {
    showMessage("Capacity must be a whole number from 1 to " + MAX_CAPACITY + ".", "error");
    return;
  }

  const booked = own(load("bookings", {}), train, 0);
  if (cap < booked) {
    showMessage("Capacity cannot be less than booked seats (" + booked + ").", "error");
    return;
  }

  const capacities = load("capacities", {});
  capacities[train] = cap;
  save("capacities", capacities);

  showMessage("Capacity updated.");
  refreshUI();
  onTrainSelect();
}

/* ══════════════════════════════════════════
   BOOKING
══════════════════════════════════════════ */
function onTrainSelect() {
  const sel = $("trainName");
  const pills = $("trainInfoPills");
  if (!sel || !pills) return;

  const train = sel.value;
  const info = train ? own(load("trainRoutes", {}), train, null) : null;

  if (!train || !info) {
    pills.style.display = "none";
    showStatCapacity();
    return;
  }

  const cap = own(load("capacities", {}), train, 0);
  const used = own(load("bookings", {}), train, 0);

  setText("pillRoute", info.route || "—");
  setText("pillTime", info.time || "—");
  setText("pillSeats", Math.max(0, cap - used));
  pills.style.display = "flex";

  showStatCapacity();
}

function updateTotalPrice() {
  const trainSel = $("trainName");
  const ticketInput = $("ticketCount");
  const box = $("totalPriceBox");
  if (!trainSel || !ticketInput || !box) return;

  const train = trainSel.value;
  const tickets = Number(ticketInput.value);
  const info = train ? own(load("trainRoutes", {}), train, null) : null;
  const route = info && info.route ? info.route : "";
  const price = toNumber(own(load("prices", {}), route, 0));

  const zero = function (hint) { box.textContent = "0 SAR"; setText("priceSub", hint); };

  if (!train) return zero("Add a train to start booking");
  if (!route) return zero("No route assigned to this train");
  if (!Number.isInteger(tickets) || tickets <= 0) return zero("Enter a whole number of tickets (1 or more)");

  box.textContent = formatMoney(tickets * price);
  setText("priceSub", price + " SAR per ticket × " + tickets);
}

function confirmBooking() {
  if (!requireLogin()) return;

  const name = $("userName").value.trim();
  const train = $("trainName").value;
  const tickets = Number($("ticketCount").value);

  if (!name) { showMessage("Enter the passenger name!", "error"); return; }
  if (!train || !isSafeKey(train)) { showMessage("Add a train first!", "error"); return; }
  if (!Number.isInteger(tickets) || tickets <= 0 || tickets > MAX_TICKETS_PER_BOOKING) {
    showMessage("Tickets must be a whole number from 1 to " + MAX_TICKETS_PER_BOOKING + ".", "error");
    return;
  }

  const passengers = load("passengers", {});
  if (!has(passengers, name)) { showMessage("Passenger not found! Add passenger first.", "error"); return; }

  const trainRoutes = load("trainRoutes", {});
  if (!has(trainRoutes, train)) { showMessage("This train has no route assigned!", "error"); return; }

  const reservations = load("reservations", []);
  if (reservations.some(function (r) { return r && r.name === name && r.train === train; })) {
    showMessage("This passenger already has a reservation on this train.", "error");
    return;
  }

  const capacities = load("capacities", {});
  const bookings = load("bookings", {});
  const maxSeats = own(capacities, train, 0);
  const booked = own(bookings, train, 0);

  if (booked + tickets > maxSeats) {
    showMessage("Not enough seats available. Only " + Math.max(0, maxSeats - booked) + " left.", "error");
    return;
  }

  const now = new Date().toISOString();
  bookings[train] = booked + tickets;
  reservations.push({ name: name, train: train, tickets: tickets, date: now });

  const logs = load("bookingLogs", []);
  logs.push({ name: name, train: train, tickets: tickets, date: now });

  save("bookings", bookings);
  save("reservations", reservations);
  save("bookingLogs", logs);

  $("userName").value = "";
  $("ticketCount").value = 1;

  showMessage("Booking confirmed.");
  refreshUI();
  onTrainSelect();
  updateTotalPrice();
}

/* Cancels one seat from the most recent reservation on the given train. */
function cancelBooking() {
  if (!requireAdmin()) return;

  const input = $("cancelTrainInput");
  const train = input.value.trim();
  const bookings = load("bookings", {});

  if (!isSafeKey(train) || !own(bookings, train, 0)) {
    showMessage("No bookings found for this train.", "error");
    return;
  }

  const reservations = load("reservations", []);
  const logs = load("bookingLogs", []);

  bookings[train] = Math.max(0, bookings[train] - 1);

  let ri = -1;
  for (let i = reservations.length - 1; i >= 0; i--) {
    if (reservations[i] && reservations[i].train === train) { ri = i; break; }
  }
  const owner = ri === -1 ? null : reservations[ri].name;

  if (ri !== -1) {
    if (toNumber(reservations[ri].tickets) > 1) reservations[ri].tickets -= 1;
    else reservations.splice(ri, 1);
  }

  // keep the log in sync so reports and the table do not over-count
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i] && logs[i].train === train && (owner === null || logs[i].name === owner)) {
      if (toNumber(logs[i].tickets) > 1) logs[i].tickets -= 1;
      else logs.splice(i, 1);
      break;
    }
  }

  save("bookings", bookings);
  save("reservations", reservations);
  save("bookingLogs", logs);

  input.value = "";
  showMessage("One seat cancelled.");
  refreshUI();
  onTrainSelect();
}

function renderBookingTable() {
  const body = $("bookingTableBody");
  if (!body) return;

  const logs = load("bookingLogs", []);
  const trainRoutes = load("trainRoutes", {});
  body.replaceChildren();

  if (logs.length === 0) {
    appendEmptyRow(body, 4, "No bookings yet");
    return;
  }

  logs.slice().reverse().forEach(function (b) {
    if (!b) return;
    const info = own(trainRoutes, b.train, null);
    appendRow(body, [b.name, b.train, info && info.route, fmtDate(b.date)]);
  });
}

/* ══════════════════════════════════════════
   STATS
══════════════════════════════════════════ */
function sumValues(obj) {
  return Object.keys(obj).reduce(function (sum, k) { return sum + toNumber(obj[k]); }, 0);
}

function calcRevenue() {
  const prices = load("prices", {});
  const trainRoutes = load("trainRoutes", {});
  return load("reservations", []).reduce(function (sum, r) {
    if (!r) return sum;
    const info = own(trainRoutes, r.train, null);
    const route = info && info.route ? info.route : "";
    return sum + toNumber(r.tickets) * toNumber(own(prices, route, 0));
  }, 0);
}

function showStatCapacity() {
  const sel = $("trainName");
  if (!sel || !$("statCapacity")) return;

  const train = sel.value;
  const cap = own(load("capacities", {}), train, 0);
  const used = own(load("bookings", {}), train, 0);

  setText("statCapacity", Math.max(0, cap - used));
  setText("statCapacityTrain", train ? train : "No selection");
}

function refreshStats() {
  setText("statBookings", sumValues(load("bookings", {})));
  setText("statTrains", load("trains", []).length);
  setText("statPassengers", Object.keys(load("passengers", {})).length);
  setText("statRevenue", formatMoney(calcRevenue()));
  showStatCapacity();
}

/* ══════════════════════════════════════════
   REPORTS
══════════════════════════════════════════ */
function getTicketTotals() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86400000;
  let daily = 0, weekly = 0;

  load("bookingLogs", []).forEach(function (b) {
    if (!b) return;
    const d = new Date(b.date);
    if (isNaN(d.getTime())) return;
    const tickets = toNumber(b.tickets) || 1;
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const age = Math.round((todayStart - start) / DAY);

    if (age === 0) daily += tickets;
    if (age >= 0 && age < 7) weekly += tickets;
  });

  return { daily: daily, weekly: weekly };
}

function getTrends() {
  const bookings = load("bookings", {});
  const trainRoutes = load("trainRoutes", {});

  let mostTrain = "", maxBookings = 0;
  Object.keys(bookings).forEach(function (t) {
    if (toNumber(bookings[t]) > maxBookings) { maxBookings = toNumber(bookings[t]); mostTrain = t; }
  });

  const routeCount = {};
  load("reservations", []).forEach(function (r) {
    if (!r) return;
    const info = own(trainRoutes, r.train, null);
    const route = info && info.route ? info.route : "Unknown";
    routeCount[route] = toNumber(own(routeCount, route, 0)) + toNumber(r.tickets);
  });

  let mostRoute = "", maxRoute = 0;
  Object.keys(routeCount).forEach(function (r) {
    if (routeCount[r] > maxRoute) { maxRoute = routeCount[r]; mostRoute = r; }
  });

  return { mostTrain: mostTrain, maxBookings: maxBookings, mostRoute: mostRoute, maxRoute: maxRoute };
}

function labelWithCount(name, count) {
  return name ? name + " (" + count + ")" : "—";
}

function updateReports() {
  const totals = getTicketTotals();
  const trends = getTrends();

  setText("dailyCount", totals.daily);
  setText("weeklyCount", totals.weekly);
  setText("topTrain", labelWithCount(trends.mostTrain, trends.maxBookings));
  setText("topRoute", labelWithCount(trends.mostRoute, trends.maxRoute));
}

function generateSummaryReport() {
  if (!requireAdmin()) return;

  $("reportBox").style.display = "grid";
  setText("totalTrains", Object.keys(load("capacities", {})).length);
  setText("totalBookings", sumValues(load("bookings", {})));
}

function generateWagensSummary() {
  if (!requireAdmin()) return;

  const trains = load("trains", []);
  const capacities = load("capacities", {});
  const bookings = load("bookings", {});

  let totalCapacity = 0, totalUsed = 0;
  trains.forEach(function (t) {
    totalCapacity += toNumber(own(capacities, t, 0));
    totalUsed += toNumber(own(bookings, t, 0));
  });
  const occupancy = totalCapacity > 0 ? ((totalUsed / totalCapacity) * 100).toFixed(1) : "0.0";

  $("wagensSummaryBox").style.display = "grid";
  setText("wsTotalTrains", trains.length);
  setText("wsTotalPassengers", Object.keys(load("passengers", {})).length);
  setText("wsTotalBookings", sumValues(bookings));
  setText("wsTotalCapacity", totalCapacity);
  setText("wsOccupancy", occupancy + "%");
  setText("wsRevenue", formatMoney(calcRevenue()));

  updateReports();
}

function recalculateReports() {
  if (!requireAdmin()) return;

  updateReports();
  const totals = getTicketTotals();
  const trends = getTrends();

  $("recalcBox").style.display = "grid";
  setText("rcTime", new Date().toLocaleString());
  setText("rcRecords", load("bookingLogs", []).length);
  setText("rcDaily", totals.daily);
  setText("rcWeekly", totals.weekly);
  setText("rcTopTrain", labelWithCount(trends.mostTrain, trends.maxBookings));
  setText("rcTopRoute", labelWithCount(trends.mostRoute, trends.maxRoute));

  showMessage("Reports recalculated successfully.");
}

/* ══════════════════════════════════════════
   RESET
══════════════════════════════════════════ */
function resetStorage() {
  if (!requireAdmin()) return;
  if (!confirm("This will delete all trains, passengers and bookings. Continue?")) return;

  // Remove only WAGENS data, never the whole origin's storage.
  DATA_KEYS.forEach(function (k) {
    delete memStore[k];
    try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
  });

  showMessage("System reset.");
  refreshUI();
}

/* ══════════════════════════════════════════
   SESSION TIMEOUT
══════════════════════════════════════════ */
function resetSessionTimer() {
  if (!getRole()) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(function () {
    logout("Session expired. Please log in again.");
  }, SESSION_TIMEOUT);
}

function onActivity() {
  const now = Date.now();
  if (now - lastActivity < 1000) return;   // throttle: at most once per second
  lastActivity = now;
  if (getRole()) resetSessionTimer();
}

/* ══════════════════════════════════════════
   EVENTS + BOOT
══════════════════════════════════════════ */
function runAction(name, arg, el) {
  if (!ALLOWED_ACTIONS.has(name) || typeof window[name] !== "function") return;
  const result = window[name](arg, el);
  if (result && typeof result.catch === "function") {
    result.catch(function () { showMessage("Something went wrong. Please try again.", "error"); });
  }
}

function bindEvents() {
  document.addEventListener("click", function (e) {
    const el = e.target.closest("[data-click]");
    if (el) runAction(el.dataset.click, el.dataset.arg, el);
  });

  document.addEventListener("change", function (e) {
    const el = e.target.closest("[data-change]");
    if (el) el.dataset.change.split(/\s+/).forEach(function (n) { runAction(n); });
  });

  document.addEventListener("input", function (e) {
    const el = e.target.closest("[data-input]");
    if (el) el.dataset.input.split(/\s+/).forEach(function (n) { runAction(n); });
  });

  ["username", "password"].forEach(function (id) {
    const el = $(id);
    if (el) el.addEventListener("keydown", function (e) {
      if (e.key === "Enter") runAction("doLogin");
    });
  });

  ["click", "keydown", "mousemove"].forEach(function (evt) {
    document.addEventListener(evt, onActivity, { passive: true });
  });

  window.addEventListener("storage", function (e) {
    if (getRole() && (e.key === null || DATA_KEYS.includes(e.key))) refreshUI();
  });
}

function init() {
  bindEvents();
  pickRole("admin");

  const hint = $("demoHint");
  if (hint && DEMO_MODE) {
    hint.textContent = "Demo accounts — admin / admin123 · staff / staff123";
    hint.hidden = false;
  }

  const saved = getRole();
  if (saved) {
    $("loginPage").style.display = "none";
    $("dashPage").style.display = "block";
    initDash(saved);
    resetSessionTimer();
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
