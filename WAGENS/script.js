"use strict";

/* ══════════════════════════════════════════
   CONSTANTS
══════════════════════════════════════════ */
const DEFAULT_CAPACITY = 100;
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
const MS_PER_DAY = 86400000;
const EMPTY = "—";
const TRAIN_SELECTS = ["trainName", "trainNameCap", "trainNameRoute"];

/* Demo only: a front-end-only app cannot truly secure credentials or roles. */
const DUMMY_ACCOUNTS = [
  { username: "admin", password: "admin123", role: "admin" },
  { username: "staff", password: "staff123", role: "staff" }
];
const ROLES = {
  admin: { label: "Admin", initials: "AD" },
  staff: { label: "Staff", initials: "ST" }
};

let currentRole = null;
let sessionTimer = null;
let messageTimer = null;

/* ══════════════════════════════════════════
   STORAGE (localStorage with in-memory fallback)
══════════════════════════════════════════ */
const memStore = {};

function load(key, fallback) {
  let raw = null;
  try { raw = localStorage.getItem(key); } catch (e) { /* storage unavailable */ }
  if (raw !== null) {
    try {
      const val = JSON.parse(raw);
      if (val !== null && val !== undefined) return val;
    } catch (e) { /* corrupt value: fall through */ }
  }
  return (key in memStore) ? JSON.parse(JSON.stringify(memStore[key])) : fallback;
}

function save(key, value) {
  memStore[key] = value;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* memory copy still works */ }
}

function remove(key) {
  delete memStore[key];
  try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
}

/* Every collection the app uses, read once per operation. */
function getData() {
  return {
    trains: load("trains", []),
    capacities: load("capacities", {}),
    reservations: load("reservations", []),
    logs: load("bookingLogs", []),
    prices: load("prices", {}),
    passengers: load("passengers", {}),
    trainRoutes: load("trainRoutes", {}),
    routes: load("routes", [])
  };
}

/* ══════════════════════════════════════════
   DERIVED VALUES (single source of truth: reservations)
══════════════════════════════════════════ */
function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function isPositiveInt(n) { return Number.isInteger(n) && n > 0; }

function routeOf(d, train) {
  return (d.trainRoutes[train] && d.trainRoutes[train].route) || "";
}

function bookedSeats(d, train) {
  return d.reservations.reduce(function (sum, r) {
    return r.train === train ? sum + toNumber(r.tickets) : sum;
  }, 0);
}

function seatsLeft(d, train) {
  return Math.max(0, toNumber(d.capacities[train]) - bookedSeats(d, train));
}

function totalTickets(d) {
  return d.reservations.reduce(function (sum, r) { return sum + toNumber(r.tickets); }, 0);
}

function totalRevenue(d) {
  return d.reservations.reduce(function (sum, r) {
    return sum + toNumber(r.tickets) * toNumber(d.prices[routeOf(d, r.train)]);
  }, 0);
}

/* Sum of tickets grouped by keyFn(reservation). */
function tallyTickets(d, keyFn) {
  const counts = {};
  d.reservations.forEach(function (r) {
    const key = keyFn(r);
    counts[key] = (counts[key] || 0) + toNumber(r.tickets);
  });
  return counts;
}

function topEntry(counts) {
  let best = null, max = 0;
  for (const key in counts) {
    if (counts[key] > max) { max = counts[key]; best = key; }
  }
  return best === null ? EMPTY : best + " (" + max + ")";
}

function ticketTotals(logs) {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let daily = 0, weekly = 0;

  logs.forEach(function (b) {
    const d = new Date(b.date);
    if (isNaN(d.getTime())) return;
    const tickets = toNumber(b.tickets) || 1;
    const dayDiff = Math.round((todayStart - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / MS_PER_DAY);
    if (dayDiff === 0) daily += tickets;
    if (dayDiff >= 0 && dayDiff < 7) weekly += tickets;
  });
  return { daily: daily, weekly: weekly };
}

/* Every value shown in the stats row and the report cards (keyed by data-field). */
function reportValues(d) {
  const capacity = d.trains.reduce(function (s, t) { return s + toNumber(d.capacities[t]); }, 0);
  const used = d.trains.reduce(function (s, t) { return s + bookedSeats(d, t); }, 0);
  const totals = ticketTotals(d.logs);

  return {
    totalTrains: d.trains.length,
    totalPassengers: Object.keys(d.passengers).length,
    totalBookings: totalTickets(d),
    totalCapacity: capacity,
    occupancy: (capacity > 0 ? (used / capacity) * 100 : 0).toFixed(1) + "%",
    totalRevenue: totalRevenue(d) + " SAR",
    dailyTickets: totals.daily,
    weeklyTickets: totals.weekly,
    topTrain: topEntry(tallyTickets(d, function (r) { return r.train; })),
    topRoute: topEntry(tallyTickets(d, function (r) { return routeOf(d, r.train) || "Unknown"; })),
    recordsScanned: d.logs.length
  };
}

/* ══════════════════════════════════════════
   DOM HELPERS
══════════════════════════════════════════ */
function $(id) { return document.getElementById(id); }

function showMessage(msg, type) {
  const box = $("output");
  box.hidden = false;
  box.textContent = msg;
  box.classList.toggle("error", type === "error");
  clearTimeout(messageTimer);
  messageTimer = setTimeout(function () { box.hidden = true; }, 4000);
}

/* Shows an error message and returns false, so validators can `return fail(...)`. */
function fail(msg) { showMessage(msg, "error"); return false; }

function clearInputs(ids) {
  ids.forEach(function (id) { $(id).value = ""; });
}

function fillFields(values) {
  document.querySelectorAll("[data-field]").forEach(function (el) {
    if (el.dataset.field in values) el.textContent = values[el.dataset.field];
  });
}

function fillSelect(id, items, emptyLabel) {
  const sel = $(id);
  const prev = sel.value;
  sel.replaceChildren();
  if (items.length === 0) {
    sel.add(new Option(emptyLabel, ""));
    return;
  }
  items.forEach(function (item) { sel.add(new Option(item, item)); });
  if (items.includes(prev)) sel.value = prev;
}

/* Builds rows with textContent, so user-entered text is never parsed as HTML. */
function renderTable(bodyId, colCount, emptyText, rows) {
  const body = $(bodyId);
  body.replaceChildren();

  const list = rows.length ? rows : [null];
  list.forEach(function (cells) {
    const tr = document.createElement("tr");
    if (cells === null) {
      const td = document.createElement("td");
      td.colSpan = colCount;
      td.textContent = emptyText;
      tr.appendChild(td);
    } else {
      cells.forEach(function (text) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      });
    }
    body.appendChild(tr);
  });
}

function formatDate(value) {
  const d = new Date(value);
  return isNaN(d.getTime()) ? EMPTY : d.toLocaleString();
}

/* ══════════════════════════════════════════
   AUTH / SESSION
══════════════════════════════════════════ */
function pickRole(role) {
  document.querySelectorAll(".role-btn").forEach(function (btn) {
    btn.classList.toggle(btn.dataset.role + "-on", btn.dataset.role === role);
  });
  $("username").value = role; // convenience only — the password is still required
}

function doLogin() {
  const username = $("username").value.trim().toLowerCase();
  const password = $("password").value;
  const err = $("loginError");

  if (!username || !password) { err.textContent = "Enter both username and password."; return; }

  const account = DUMMY_ACCOUNTS.find(function (a) {
    return a.username === username && a.password === password;
  });
  if (!account) { err.textContent = "Invalid username or password."; return; }

  err.textContent = "";
  $("password").value = "";
  save("role", account.role);
  enterDashboard(account.role);
}

function logout() {
  currentRole = null;
  remove("role");
  clearTimeout(sessionTimer);

  $("dashPage").hidden = true;
  $("loginPage").hidden = false;
  document.querySelectorAll(".section").forEach(function (s) { s.classList.remove("active"); });

  $("password").value = "";
  $("loginError").textContent = "";
  pickRole("admin");
}

function resetSessionTimer() {
  if (!currentRole) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(function () {
    alert("Session expired. Please login again.");
    logout();
  }, SESSION_TIMEOUT);
}

function resetStorage() {
  if (currentRole !== "admin") return showMessage("Only admin can reset!", "error");
  if (!confirm("This will delete all trains, passengers and bookings. Continue?")) return;

  try { localStorage.clear(); } catch (e) { /* ignore */ }
  Object.keys(memStore).forEach(function (k) { delete memStore[k]; });

  showMessage("System reset.");
  setTimeout(function () { location.reload(); }, 600);
}

/* ══════════════════════════════════════════
   DASHBOARD / NAVIGATION
══════════════════════════════════════════ */
function enterDashboard(role) {
  currentRole = role;
  $("loginPage").hidden = true;
  $("dashPage").hidden = false;
  $("topbarAvatar").textContent = ROLES[role].initials;
  $("topbarRole").textContent = ROLES[role].label;

  document.querySelectorAll("[data-admin-only]").forEach(function (el) {
    el.hidden = role !== "admin";
  });

  refreshUI();
  showSection("bookingSection");
  resetSessionTimer();
}

function showSection(id) {
  const btn = document.querySelector('.nav-btn[data-section="' + id + '"]');
  if (!btn) return;
  if (btn.hasAttribute("data-admin-only") && currentRole !== "admin") return;

  document.querySelectorAll(".section").forEach(function (s) {
    s.classList.toggle("active", s.id === id);
  });
  document.querySelectorAll(".nav-btn[data-section]").forEach(function (b) {
    b.classList.toggle("active", b === btn);
  });
  $("topbarTitle").textContent = btn.dataset.title;
  $("statsRow").hidden = id !== "bookingSection";
}

/* The one place that re-renders everything from stored data. */
function refreshUI() {
  const d = getData();

  TRAIN_SELECTS.forEach(function (id) { fillSelect(id, d.trains, "— No trains added —"); });
  fillSelect("routePriceSelect", d.routes, "— No routes added —");
  fillSelect("cancelTrain", d.trains.filter(function (t) { return bookedSeats(d, t) > 0; }), "— No bookings —");

  renderPassengerTable(d);
  renderBookingTable(d);
  fillFields(reportValues(d));
  refreshBookingPanel(d);
}

/* Train info pills, seats-left stat and the live price for the booking form. */
function refreshBookingPanel(d) {
  d = d || getData();
  const train = $("trainName").value;
  const info = d.trainRoutes[train];

  const pills = $("trainInfoPills");
  pills.hidden = !(train && info);
  if (!pills.hidden) {
    $("pillRoute").textContent = info.route || EMPTY;
    $("pillTime").textContent = info.time || EMPTY;
    $("pillSeats").textContent = seatsLeft(d, train);
  }

  fillFields({ seatsLeft: seatsLeft(d, train), selectedTrain: train || "No selection" });
  updateTotalPrice(d);
}

function updateTotalPrice(d) {
  d = d || getData();
  const train = $("trainName").value;
  const tickets = Number($("ticketCount").value);
  const route = routeOf(d, train);

  let total = 0, note;
  if (!train) note = "Add a train to start booking";
  else if (!route) note = "No route assigned to this train";
  else if (!isPositiveInt(tickets)) note = "Enter a whole number of tickets (1 or more)";
  else {
    const price = toNumber(d.prices[route]);
    total = tickets * price;
    note = price + " SAR per ticket × " + tickets;
  }

  $("totalPriceBox").textContent = total + " SAR";
  $("priceSub").textContent = note;
}

/* ══════════════════════════════════════════
   PASSENGERS
══════════════════════════════════════════ */
function addPassenger() {
  const name = $("pName").value.trim();
  const phone = $("pPhone").value.trim();
  const email = $("pEmail").value.trim();

  if (!name || !phone || !email) return fail("Fill all fields!");
  if (!/^05\d{8}$/.test(phone)) return fail("Phone must start with 05 and be 10 digits.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Invalid email format.");

  const passengers = load("passengers", {});
  if (Object.hasOwn(passengers, name)) return fail("Passenger already exists!");

  passengers[name] = { name: name, phone: phone, email: email, registeredAt: new Date().toLocaleString() };
  save("passengers", passengers);

  clearInputs(["pName", "pPhone", "pEmail"]);
  showMessage("Passenger added successfully.");
  refreshUI();
}

function renderPassengerTable(d) {
  const rows = [];
  Object.keys(d.passengers).forEach(function (name) {
    const p = d.passengers[name];
    const bookings = d.reservations.filter(function (r) { return r.name === name; });

    if (bookings.length === 0) {
      rows.push([name, p.phone, p.email, EMPTY, EMPTY, 0, p.registeredAt || EMPTY]);
      return;
    }
    bookings.forEach(function (r) {
      rows.push([name, p.phone, p.email, r.train, routeOf(d, r.train) || EMPTY, r.tickets, r.date || p.registeredAt || EMPTY]);
    });
  });
  renderTable("passengerTableBody", 7, "No passengers registered yet", rows);
}

/* ══════════════════════════════════════════
   TRAINS / ROUTES / PRICING / CAPACITY
══════════════════════════════════════════ */
function addTrain() {
  const train = $("train").value.trim();
  if (!train) return fail("Enter train name!");

  const trains = load("trains", []);
  if (trains.includes(train)) return fail("Train already exists!");

  const capacities = load("capacities", {});
  trains.push(train);
  capacities[train] = DEFAULT_CAPACITY;
  save("trains", trains);
  save("capacities", capacities);

  clearInputs(["train"]);
  showMessage("Train added with a default capacity of " + DEFAULT_CAPACITY + ".");
  refreshUI();
}

function addRoute() {
  const train = $("trainNameRoute").value;
  const route = $("routeInput").value.trim();
  const time = $("timeInput").value.trim();

  if (!train) return fail("Add a train first!");
  if (!route || !time) return fail("Fill all fields!");

  const trainRoutes = load("trainRoutes", {});
  trainRoutes[train] = { route: route, time: time };
  save("trainRoutes", trainRoutes);

  const routes = load("routes", []);
  if (!routes.includes(route)) {
    routes.push(route);
    save("routes", routes);
  }

  clearInputs(["routeInput"]);
  showMessage("Route assigned to train.");
  refreshUI();
}

function setPrice() {
  const route = $("routePriceSelect").value;
  const raw = $("priceInput").value;

  if (!route) return fail("Add a route first!");
  if (raw === "") return fail("Enter a price!");

  const price = Number(raw);
  if (!Number.isFinite(price) || price < 0) return fail("Price must be 0 or a positive value.");

  const prices = load("prices", {});
  prices[route] = price;
  save("prices", prices);

  showMessage("Price set for route.");
  refreshUI();
}

function setCapacity() {
  const train = $("trainNameCap").value;
  const cap = Number($("cap").value);

  if (!train) return fail("Add a train first!");
  if (!isPositiveInt(cap)) return fail("Invalid capacity!");

  const booked = bookedSeats(getData(), train);
  if (cap < booked) return fail("Capacity cannot be less than booked seats (" + booked + ").");

  const capacities = load("capacities", {});
  capacities[train] = cap;
  save("capacities", capacities);

  showMessage("Capacity updated.");
  refreshUI();
}

/* ══════════════════════════════════════════
   BOOKING
══════════════════════════════════════════ */
function confirmBooking() {
  const d = getData();
  const name = $("userName").value.trim();
  const train = $("trainName").value;
  const tickets = Number($("ticketCount").value);

  if (!name) return fail("Enter the passenger name!");
  if (!train) return fail("Add a train first!");
  if (!isPositiveInt(tickets)) return fail("Tickets must be a whole number greater than 0.");
  if (!Object.hasOwn(d.passengers, name)) return fail("Passenger not found! Add passenger first.");
  if (!d.trainRoutes[train]) return fail("This train has no route assigned!");

  const left = seatsLeft(d, train);
  if (tickets > left) return fail("Not enough seats available. Only " + left + " left.");

  const now = new Date();
  const existing = d.reservations.find(function (r) { return r.name === name && r.train === train; });
  if (existing) {
    existing.tickets = toNumber(existing.tickets) + tickets;
    existing.date = now.toLocaleString();
  } else {
    d.reservations.push({ name: name, train: train, tickets: tickets, date: now.toLocaleString() });
  }
  d.logs.push({ name: name, train: train, tickets: tickets, date: now.toISOString() });

  save("reservations", d.reservations);
  save("bookingLogs", d.logs);

  clearInputs(["userName"]);
  $("ticketCount").value = 1;
  showMessage("Booking confirmed" + (existing ? " (added to existing reservation)." : "."));
  refreshUI();
}

/* Removes one ticket from list[index]; drops the entry when none are left. */
function removeOneTicket(list, index) {
  if (toNumber(list[index].tickets) > 1) list[index].tickets = toNumber(list[index].tickets) - 1;
  else list.splice(index, 1);
}

function cancelBooking() {
  const train = $("cancelTrain").value;
  const d = getData();

  const resIndex = d.reservations.findIndex(function (r) { return r.train === train; });
  if (!train || resIndex === -1) return fail("No bookings found for this train.");

  const name = d.reservations[resIndex].name;
  removeOneTicket(d.reservations, resIndex);

  // keep the history log in sync (same passenger, most recent entry)
  const logIndex = d.logs.findLastIndex(function (l) { return l.train === train && l.name === name; });
  if (logIndex !== -1) removeOneTicket(d.logs, logIndex);

  save("reservations", d.reservations);
  save("bookingLogs", d.logs);

  showMessage("One seat cancelled.");
  refreshUI();
}

function renderBookingTable(d) {
  const rows = d.logs.slice().reverse().map(function (b) {
    return [b.name || EMPTY, b.train || EMPTY, routeOf(d, b.train) || EMPTY, formatDate(b.date)];
  });
  renderTable("bookingTableBody", 4, "No bookings yet", rows);
}

/* ══════════════════════════════════════════
   REPORTS (values are already kept fresh by refreshUI)
══════════════════════════════════════════ */
function showReport(boxId) {
  $(boxId).hidden = false;
  refreshUI();
}

function recalculateReports() {
  $("recalcBox").hidden = false;
  refreshUI();
  fillFields({ lastRecalculated: new Date().toLocaleString() });
  showMessage("Reports recalculated successfully.");
}

/* ══════════════════════════════════════════
   EVENT WIRING (no inline handlers in the HTML)
══════════════════════════════════════════ */
const ACTIONS = {
  pickRole: function (el) { pickRole(el.dataset.role); },
  login: doLogin,
  logout: logout,
  reset: resetStorage,
  addPassenger: addPassenger,
  addTrain: addTrain,
  addRoute: addRoute,
  setPrice: setPrice,
  setCapacity: setCapacity,
  confirmBooking: confirmBooking,
  cancelBooking: cancelBooking,
  showReport: function (el) { showReport(el.dataset.target); },
  recalculate: recalculateReports
};

document.addEventListener("click", function (e) {
  const el = e.target.closest("[data-section], [data-action]");
  if (!el) return;
  if (el.dataset.section) showSection(el.dataset.section);
  else if (ACTIONS[el.dataset.action]) ACTIONS[el.dataset.action](el);
});

["click", "keydown", "mousemove"].forEach(function (evt) {
  document.addEventListener(evt, resetSessionTimer, { passive: true });
});

window.addEventListener("storage", function () {
  if (currentRole) refreshUI();
});

window.addEventListener("DOMContentLoaded", function () {
  pickRole("admin");

  ["username", "password"].forEach(function (id) {
    $(id).addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
  });

  $("ticketCount").addEventListener("input", function () { updateTotalPrice(); });
  $("trainName").addEventListener("change", function () { refreshBookingPanel(); });

  const saved = load("role", null);
  if (ROLES[saved]) enterDashboard(saved);
});
