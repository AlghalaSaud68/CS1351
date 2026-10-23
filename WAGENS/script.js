"use strict";

/* ══════════════════════════════════════════
   STORAGE (safe wrapper + memory fallback)
══════════════════════════════════════════ */
const DEFAULT_CAPACITY = 100;
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
let sessionTimer = null;
const memStore = {};

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    const val = JSON.parse(raw);
    return (val === null || val === undefined) ? fallback : val;
  } catch (e) {
    return (key in memStore) ? memStore[key] : fallback;
  }
}

function save(key, value) {
  memStore[key] = value;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

function getRole() {
  try { return localStorage.getItem("role") || sessionStorage.getItem("role"); }
  catch (e) { return memStore.role || null; }
}

function setRole(role) {
  memStore.role = role;
  try { localStorage.setItem("role", role); sessionStorage.setItem("role", role); } catch (e) {}
}

function clearRole() {
  memStore.role = null;
  try { localStorage.removeItem("role"); sessionStorage.removeItem("role"); } catch (e) {}
}

/* ══════════════════════════════════════════
   UTILITIES
══════════════════════════════════════════ */
function $(id) { return document.getElementById(id); }

function showMessage(msg, type) {
  const box = $("output");
  if (!box) return;
  box.style.display = "block";
  box.textContent = msg;
  box.classList.toggle("error", type === "error");
  clearTimeout(showMessage._t);
  showMessage._t = setTimeout(function () { box.style.display = "none"; }, 4000);
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ══════════════════════════════════════════
   LOGIN
══════════════════════════════════════════ */
let _currentRole = "admin";

function pickRole(role) {
  _currentRole = role;
  const a = $("adminBtn"), s = $("staffBtn"), u = $("username");
  if (a) a.className = "role-btn" + (role === "admin" ? " admin-on" : "");
  if (s) s.className = "role-btn" + (role === "staff" ? " staff-on" : "");
  if (u) u.value = role; // convenience only — password is still required
}

/* Dummy accounts for demo login security */
const DUMMY_ACCOUNTS = [
  { username: "admin", password: "admin123", role: "admin" },
  { username: "staff", password: "staff123", role: "staff" }
];

function doLogin() {
  const u = $("username"), p = $("password"), err = $("loginError");
  const username = (u ? u.value : "").trim().toLowerCase();
  const password = p ? p.value : "";

  if (!username || !password) {
    if (err) err.textContent = "Enter both username and password.";
    return;
  }

  const account = DUMMY_ACCOUNTS.find(function (a) {
    return a.username === username && a.password === password;
  });

  if (!account) {
    if (err) err.textContent = "Invalid username or password.";
    return;
  }

  if (err) err.textContent = "";
  if (p) p.value = "";

  setRole(account.role);
  $("loginPage").style.display = "none";
  $("dashPage").style.display = "block";
  initDash(account.role);
  resetSessionTimer();
}

function logout() {
  clearRole();
  clearTimeout(sessionTimer);
  sessionTimer = null;

  const dash = $("dashPage"), login = $("loginPage");
  if (dash) dash.style.display = "none";
  if (login) login.style.display = "flex";

  document.querySelectorAll(".section").forEach(function (s) {
    s.style.display = "none";
    s.classList.remove("active");
  });

  const p = $("password");
  if (p) p.value = "";
  const err = $("loginError");
  if (err) err.textContent = "";
  pickRole("admin");
}

/* ══════════════════════════════════════════
   DASHBOARD INIT / NAVIGATION
══════════════════════════════════════════ */
function initDash(role) {
  const av = $("topbarAvatar"), rl = $("topbarRole");
  if (av) av.textContent = role === "admin" ? "AD" : "ST";
  if (rl) rl.textContent = role === "admin" ? "Admin" : "Staff";

  // reset visibility first
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

function showSection(id, btn) {
  document.querySelectorAll(".section").forEach(function (s) {
    s.style.display = "none";
    s.classList.remove("active");
  });

  const el = $(id);
  if (el) { el.style.display = "block"; el.classList.add("active"); }

  const titles = {
    bookingSection: "Book a Train",
    passengerSection: "Passengers",
    routeSection: "Routes",
    priceSection: "Pricing",
    capacitySection: "Capacity",
    scheduleSection: "Add Train",
    reportsSection: "Reports",
    cancelSection: "Cancel Booking"
  };
  const tb = $("topbarTitle");
  if (tb) tb.textContent = titles[id] || id;

  const sr = $("statsRow");
  if (sr) sr.style.display = (id === "bookingSection") ? "flex" : "none";

  document.querySelectorAll(".nav-btn").forEach(function (b) { b.classList.remove("active"); });
  if (btn) btn.classList.add("active");

  if (id === "bookingSection") { refreshStats(); onTrainSelect(); updateTotalPrice(); }
  if (id === "passengerSection") renderPassengerTable();
  if (id === "reportsSection") updateReports();
}

/* One refresh entry point. No function below calls refreshUI(). */
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
  const name = $("pName").value.trim();
  const phone = $("pPhone").value.trim();
  const email = $("pEmail").value.trim();

  if (!name || !phone || !email) { showMessage("Fill all fields!", "error"); return; }
  if (!/^05\d{8}$/.test(phone)) { showMessage("Phone must start with 05 and be 10 digits.", "error"); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showMessage("Invalid email format.", "error"); return; }

  const passengers = load("passengers", {});
  if (passengers[name]) { showMessage("Passenger already exists!", "error"); return; }

  passengers[name] = { name: name, phone: phone, email: email, registeredAt: new Date().toLocaleString() };
  save("passengers", passengers);

  $("pName").value = "";
  $("pPhone").value = "";
  $("pEmail").value = "";

  showMessage("Passenger added successfully.");
  refreshUI();
}

function renderPassengerTable() {
  const passengers = load("passengers", {});
  const reservations = load("reservations", []);
  const trainRoutes = load("trainRoutes", {});
  const body = $("passengerTableBody");
  if (!body) return;

  body.innerHTML = "";
  const names = Object.keys(passengers);

  if (names.length === 0) {
    body.innerHTML = '<tr><td colspan="7">No passengers registered yet</td></tr>';
    return;
  }

  names.forEach(function (name) {
    const p = passengers[name];
    const userBookings = reservations.filter(function (r) { return r.name === name; });

    if (userBookings.length === 0) {
      const row = document.createElement("tr");
      row.innerHTML =
        "<td>" + name + "</td><td>" + p.phone + "</td><td>" + p.email + "</td>" +
        "<td>—</td><td>—</td><td>0</td><td>" + (p.registeredAt || "—") + "</td>";
      body.appendChild(row);
    } else {
      userBookings.forEach(function (r) {
        const route = (trainRoutes[r.train] && trainRoutes[r.train].route) || "—";
        const row = document.createElement("tr");
        row.innerHTML =
          "<td>" + name + "</td><td>" + p.phone + "</td><td>" + p.email + "</td>" +
          "<td>" + r.train + "</td><td>" + route + "</td><td>" + r.tickets + "</td>" +
          "<td>" + (r.date || p.registeredAt || "—") + "</td>";
        body.appendChild(row);
      });
    }
  });
}

/* ══════════════════════════════════════════
   TRAINS
══════════════════════════════════════════ */
function addSchedule() {
  const input = $("train");
  const train = input.value.trim();
  if (!train) { showMessage("Enter train name!", "error"); return; }

  const trains = load("trains", []);
  const capacities = load("capacities", {});

  if (trains.includes(train)) { showMessage("Train already exists!", "error"); return; }

  trains.push(train);
  capacities[train] = DEFAULT_CAPACITY;
  save("trains", trains);
  save("capacities", capacities);

  const schedules = load("schedules", []);
  schedules.push({ train: train, date: new Date().toLocaleString() });
  save("schedules", schedules);

  input.value = "";
  showMessage("Train added with a default capacity of " + DEFAULT_CAPACITY + ".");
  refreshUI();
}

function updateTrainDropdowns() {
  const trains = load("trains", []);
  const ids = ["trainName", "trainNameCap", "trainNameRoute"];

  ids.forEach(function (id) {
    const drop = $(id);
    if (!drop) return;
    const prev = drop.value;
    drop.innerHTML = "";

    if (trains.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "— No trains added —";
      drop.appendChild(opt);
      return;
    }

    trains.forEach(function (t) {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      drop.appendChild(opt);
    });
    if (trains.includes(prev)) drop.value = prev;
  });
}

function updateRoutePriceDropdown() {
  const routes = load("routes", []);
  const drop = $("routePriceSelect");
  if (!drop) return;

  const prev = drop.value;
  drop.innerHTML = "";

  if (routes.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— No routes added —";
    drop.appendChild(opt);
    return;
  }

  routes.forEach(function (r) {
    const opt = document.createElement("option");
    opt.value = r;
    opt.textContent = r;
    drop.appendChild(opt);
  });
  if (routes.includes(prev)) drop.value = prev;
}

/* ══════════════════════════════════════════
   ROUTES / PRICING / CAPACITY
══════════════════════════════════════════ */
function addRoute() {
  const train = $("trainNameRoute").value;
  const route = $("routeInput").value.trim();
  const time = $("timeInput").value.trim();

  if (!train) { showMessage("Add a train first!", "error"); return; }
  if (!route || !time) { showMessage("Fill all fields!", "error"); return; }

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
  const route = $("routePriceSelect").value;
  const raw = $("priceInput").value;

  if (!route) { showMessage("Add a route first!", "error"); return; }
  if (raw === "") { showMessage("Enter a price!", "error"); return; }

  const price = Number(raw);
  if (!Number.isFinite(price) || price < 0) {
    showMessage("Price must be 0 or a positive value.", "error");
    return;
  }

  const prices = load("prices", {});
  prices[route] = price;
  save("prices", prices);

  showMessage("Price set for route.");
  refreshUI();
  updateTotalPrice();
}

function setCapacity() {
  const train = $("trainNameCap").value;
  const cap = Number($("cap").value);

  if (!train) { showMessage("Add a train first!", "error"); return; }
  if (!Number.isInteger(cap) || cap <= 0) { showMessage("Invalid capacity!", "error"); return; }

  const bookings = load("bookings", {});
  const booked = bookings[train] || 0;
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
  const trainRoutes = load("trainRoutes", {});
  const capacities = load("capacities", {});
  const bookings = load("bookings", {});
  const info = train ? trainRoutes[train] : null;

  if (!train || !info) { pills.style.display = "none"; showStatCapacity(); return; }

  const cap = capacities[train] || 0;
  const used = bookings[train] || 0;

  $("pillRoute").textContent = info.route || "—";
  $("pillTime").textContent = info.time || "—";
  $("pillSeats").textContent = Math.max(0, cap - used);
  pills.style.display = "flex";

  showStatCapacity();
}

function updateTotalPrice() {
  const trainSel = $("trainName");
  const ticketInput = $("ticketCount");
  const box = $("totalPriceBox");
  const sub = $("priceSub");
  if (!trainSel || !ticketInput || !box) return;

  const train = trainSel.value;
  const tickets = Number(ticketInput.value);
  const trainRoutes = load("trainRoutes", {});
  const prices = load("prices", {});

  const route = (trainRoutes[train] && trainRoutes[train].route) || "";
  const price = toNumber(prices[route]);

  if (!train) {
    box.textContent = "0 SAR";
    if (sub) sub.textContent = "Add a train to start booking";
    return;
  }
  if (!route) {
    box.textContent = "0 SAR";
    if (sub) sub.textContent = "No route assigned to this train";
    return;
  }
  if (!Number.isInteger(tickets) || tickets <= 0) {
    box.textContent = "0 SAR";
    if (sub) sub.textContent = "Enter a whole number of tickets (1 or more)";
    return;
  }

  box.textContent = (tickets * price) + " SAR";
  if (sub) sub.textContent = price + " SAR per ticket × " + tickets;
}

function confirmBooking() {
  const name = $("userName").value.trim();
  const train = $("trainName").value;
  const tickets = Number($("ticketCount").value);

  if (!name) { showMessage("Enter the passenger name!", "error"); return; }
  if (!train) { showMessage("Add a train first!", "error"); return; }
  if (!Number.isInteger(tickets) || tickets <= 0) {
    showMessage("Tickets must be a whole number greater than 0.", "error");
    return;
  }

  const passengers = load("passengers", {});
  if (!passengers[name]) { showMessage("Passenger not found! Add passenger first.", "error"); return; }

  const trainRoutes = load("trainRoutes", {});
  if (!trainRoutes[train]) { showMessage("This train has no route assigned!", "error"); return; }

  const capacities = load("capacities", {});
  const bookings = load("bookings", {});
  const reservations = load("reservations", []);

  const maxSeats = capacities[train] || 0;
  const booked = bookings[train] || 0;

  if (booked + tickets > maxSeats) {
    showMessage("Not enough seats available. Only " + Math.max(0, maxSeats - booked) + " left.", "error");
    return;
  }

  bookings[train] = booked + tickets;

  const existing = reservations.find(function (r) { return r.name === name && r.train === train; });
  if (existing) {
    existing.tickets = toNumber(existing.tickets) + tickets;
    existing.date = new Date().toLocaleString();
  } else {
    reservations.push({ name: name, train: train, tickets: tickets, date: new Date().toLocaleString() });
  }

  const logs = load("bookingLogs", []);
  logs.push({ name: name, train: train, tickets: tickets, date: new Date().toISOString() });

  save("bookings", bookings);
  save("reservations", reservations);
  save("bookingLogs", logs);

  $("userName").value = "";
  $("ticketCount").value = 1;

  showMessage("Booking confirmed" + (existing ? " (added to existing reservation)." : "."));
  refreshUI();
  onTrainSelect();
  updateTotalPrice();
}

function cancelBooking() {
  const input = $("cancelTrainInput");
  const train = input.value.trim();
  const bookings = load("bookings", {});
  const reservations = load("reservations", []);
  const logs = load("bookingLogs", []);

  if (!train || !bookings[train]) { showMessage("No bookings found for this train.", "error"); return; }

  bookings[train] = Math.max(0, (bookings[train] || 0) - 1);

  const index = reservations.findIndex(function (r) { return r.train === train; });
  if (index !== -1) {
    if (toNumber(reservations[index].tickets) > 1) reservations[index].tickets -= 1;
    else reservations.splice(index, 1);
  }

  // keep logs in sync so reports/table don't over-count
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].train === train) {
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
  const logs = load("bookingLogs", []);
  const trainRoutes = load("trainRoutes", {});
  const body = $("bookingTableBody");
  if (!body) return;

  body.innerHTML = "";

  if (logs.length === 0) {
    body.innerHTML = '<tr><td colspan="4">No bookings yet</td></tr>';
    return;
  }

  logs.slice().reverse().forEach(function (b) {
    const route = (trainRoutes[b.train] && trainRoutes[b.train].route) || "—";
    let dateText = "—";
    const d = new Date(b.date);
    if (!isNaN(d.getTime())) dateText = d.toLocaleString();

    const row = document.createElement("tr");
    row.innerHTML =
      "<td>" + (b.name || "—") + "</td><td>" + (b.train || "—") + "</td>" +
      "<td>" + route + "</td><td>" + dateText + "</td>";
    body.appendChild(row);
  });
}

/* ══════════════════════════════════════════
   STATS
══════════════════════════════════════════ */
function showStatCapacity() {
  const sel = $("trainName");
  const box = $("statCapacity");
  if (!sel || !box) return;

  const train = sel.value;
  const capacities = load("capacities", {});
  const bookings = load("bookings", {});
  const cap = capacities[train] || 0;
  const used = bookings[train] || 0;

  box.textContent = Math.max(0, cap - used);

  const hint = $("statCapacityTrain");
  if (hint) hint.textContent = train ? train : "No selection";
}

function refreshStats() {
  const trains = load("trains", []);
  const bookings = load("bookings", {});
  const reservations = load("reservations", []);
  const prices = load("prices", {});
  const passengers = load("passengers", {});
  const trainRoutes = load("trainRoutes", {});

  let totalBookings = 0;
  for (const t in bookings) totalBookings += toNumber(bookings[t]);

  let totalRevenue = 0;
  reservations.forEach(function (r) {
    const route = (trainRoutes[r.train] && trainRoutes[r.train].route) || "";
    totalRevenue += toNumber(r.tickets) * toNumber(prices[route]);
  });

  if ($("statBookings")) $("statBookings").textContent = totalBookings;
  if ($("statTrains")) $("statTrains").textContent = trains.length;
  if ($("statPassengers")) $("statPassengers").textContent = Object.keys(passengers).length;
  if ($("statRevenue")) $("statRevenue").textContent = totalRevenue + " SAR";
  showStatCapacity();
}

/* ══════════════════════════════════════════
   REPORTS
══════════════════════════════════════════ */
function getTicketTotals() {
  const logs = load("bookingLogs", []);
  const now = new Date();
  const todayStr = now.toDateString();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const MS_PER_DAY = 86400000;

  let daily = 0, weekly = 0;

  logs.forEach(function (b) {
    const d = new Date(b.date);
    if (isNaN(d.getTime())) return;
    const tickets = toNumber(b.tickets) || 1;

    if (d.toDateString() === todayStr) daily += tickets;

    const bookingStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayDiff = (todayStart - bookingStart) / MS_PER_DAY;
    if (dayDiff >= 0 && dayDiff < 7) weekly += tickets;
  });

  return { daily: daily, weekly: weekly };
}

function getTrends() {
  const bookings = load("bookings", {});
  const reservations = load("reservations", []);
  const trainRoutes = load("trainRoutes", {});

  let mostTrain = "", maxBookings = 0;
  for (const train in bookings) {
    if (toNumber(bookings[train]) > maxBookings) {
      maxBookings = toNumber(bookings[train]);
      mostTrain = train;
    }
  }

  const routeCount = {};
  reservations.forEach(function (r) {
    const route = (trainRoutes[r.train] && trainRoutes[r.train].route) || "Unknown";
    routeCount[route] = (routeCount[route] || 0) + toNumber(r.tickets);
  });

  let mostRoute = "", maxRoute = 0;
  for (const r in routeCount) {
    if (routeCount[r] > maxRoute) { maxRoute = routeCount[r]; mostRoute = r; }
  }

  return { mostTrain: mostTrain, maxBookings: maxBookings, mostRoute: mostRoute, maxRoute: maxRoute };
}

function updateReports() {
  const totals = getTicketTotals();
  const trends = getTrends();

  if ($("dailyCount")) $("dailyCount").textContent = totals.daily;
  if ($("weeklyCount")) $("weeklyCount").textContent = totals.weekly;
  if ($("topTrain")) $("topTrain").textContent = trends.mostTrain ? trends.mostTrain + " (" + trends.maxBookings + ")" : "—";
  if ($("topRoute")) $("topRoute").textContent = trends.mostRoute ? trends.mostRoute + " (" + trends.maxRoute + ")" : "—";
}

function generateSummaryReport() {
  const capacities = load("capacities", {});
  const bookings = load("bookings", {});

  $("reportBox").style.display = "grid";

  let total = 0;
  for (const t in bookings) total += toNumber(bookings[t]);

  $("totalTrains").textContent = Object.keys(capacities).length;
  $("totalBookings").textContent = total;
}

function generateWagensSummary() {
  const trains = load("trains", []);
  const capacities = load("capacities", {});
  const bookings = load("bookings", {});
  const reservations = load("reservations", []);
  const prices = load("prices", {});
  const passengers = load("passengers", {});
  const trainRoutes = load("trainRoutes", {});

  let totalBookings = 0;
  for (const t in bookings) totalBookings += toNumber(bookings[t]);

  let totalRevenue = 0;
  reservations.forEach(function (r) {
    const route = (trainRoutes[r.train] && trainRoutes[r.train].route) || "";
    totalRevenue += toNumber(r.tickets) * toNumber(prices[route]);
  });

  let totalCapacity = 0, totalUsed = 0;
  trains.forEach(function (t) {
    totalCapacity += toNumber(capacities[t]);
    totalUsed += toNumber(bookings[t]);
  });

  const occupancy = totalCapacity > 0 ? ((totalUsed / totalCapacity) * 100).toFixed(1) : "0.0";

  $("wagensSummaryBox").style.display = "grid";
  $("wsTotalTrains").textContent = trains.length;
  $("wsTotalPassengers").textContent = Object.keys(passengers).length;
  $("wsTotalBookings").textContent = totalBookings;
  $("wsTotalCapacity").textContent = totalCapacity;
  $("wsOccupancy").textContent = occupancy + "%";
  $("wsRevenue").textContent = totalRevenue + " SAR";

  updateReports();
}

function recalculateReports() {
  updateReports();

  const totals = getTicketTotals();
  const trends = getTrends();
  const logs = load("bookingLogs", []);

  $("recalcBox").style.display = "grid";
  $("rcTime").textContent = new Date().toLocaleString();
  $("rcRecords").textContent = logs.length;
  $("rcDaily").textContent = totals.daily;
  $("rcWeekly").textContent = totals.weekly;
  $("rcTopTrain").textContent = trends.mostTrain ? trends.mostTrain + " (" + trends.maxBookings + ")" : "—";
  $("rcTopRoute").textContent = trends.mostRoute ? trends.mostRoute + " (" + trends.maxRoute + ")" : "—";

  showMessage("Reports recalculated successfully.");
}

/* ══════════════════════════════════════════
   RESET
══════════════════════════════════════════ */
function resetStorage() {
  if (getRole() !== "admin") { showMessage("Only admin can reset!", "error"); return; }
  if (!confirm("This will delete all trains, passengers and bookings. Continue?")) return;

  try { localStorage.clear(); } catch (e) {}
  Object.keys(memStore).forEach(function (k) { delete memStore[k]; });

  showMessage("System reset.");
  setTimeout(function () { location.reload(); }, 600);
}

/* ══════════════════════════════════════════
   SESSION TIMEOUT
══════════════════════════════════════════ */
function resetSessionTimer() {
  if (!getRole()) return;
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(function () {
    alert("Session expired. Please login again.");
    logout();
  }, SESSION_TIMEOUT);
}

["click", "keydown", "mousemove"].forEach(function (evt) {
  document.addEventListener(evt, function () {
    if (getRole()) resetSessionTimer();
  }, { passive: true });
});

/* ══════════════════════════════════════════
   BOOT
══════════════════════════════════════════ */
window.addEventListener("load", function () {
  pickRole("admin");

  ["username", "password"].forEach(function (id) {
    const el = $(id);
    if (el) el.addEventListener("keydown", function (e) {
      if (e.key === "Enter") doLogin();
    });
  });

  const saved = getRole();
  if (saved === "admin" || saved === "staff") {
    $("loginPage").style.display = "none";
    $("dashPage").style.display = "block";
    initDash(saved);
    resetSessionTimer();
  }
});

window.addEventListener("storage", function () {
  if (getRole()) refreshUI();
});
