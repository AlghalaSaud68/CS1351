const { test, expect } = require('@playwright/test');

const BASE_URL = 'http://127.0.0.1:4173';

async function invoke(page, functionName, fields = {}, storage = {}) {
  return page.evaluate(({ functionName, fields, storage }) => {
    for (const [key, value] of Object.entries(storage)) {
      localStorage.setItem(key, JSON.stringify(value));
    }

    for (const [id, value] of Object.entries(fields)) {
      const element = document.getElementById(id);
      if (!element) throw new Error(`Required WAGENS element #${id} was not found`);

      if (element.tagName === 'SELECT') {
        element.innerHTML = '';
        const values = Array.isArray(value) ? value : [value];
        for (const item of values) {
          if (item === null || item === undefined) continue;
          const option = document.createElement('option');
          option.value = String(item);
          option.textContent = String(item);
          element.appendChild(option);
        }
        element.value = String(Array.isArray(value) ? (value[0] ?? '') : (value ?? ''));
      } else {
        element.value = String(value ?? '');
      }
    }

    const fn = window[functionName];
    if (typeof fn !== 'function') {
      throw new Error(`WAGENS function "${functionName}" was not found on window`);
    }
    fn();

    const state = {};
    for (const key of [
      'passengers', 'trains', 'capacities', 'schedules', 'trainRoutes',
      'routes', 'prices', 'bookings', 'reservations', 'bookingLogs'
    ]) {
      const raw = localStorage.getItem(key);
      if (raw !== null) state[key] = JSON.parse(raw);
    }

    return {
      state,
      output: document.getElementById('output')?.innerText || '',
      loginError: document.getElementById('loginError')?.innerText || '',
      username: document.getElementById('username')?.value || '',
      role: localStorage.getItem('role')
    };
  }, { functionName, fields, storage });
}

async function stateOf(page, key) {
  return page.evaluate((name) => {
    const raw = localStorage.getItem(name);
    return raw === null ? null : JSON.parse(raw);
  }, key);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(BASE_URL);

  // Keep each case focused on the behavior being tested, not unrelated rendering.
  // UI smoke tests below still verify that the page and key elements load.
  await page.evaluate(() => {
    window.refreshUI = () => {};
    window.refreshAll = () => {};
    window.updateReports = () => {};
    window.renderPassengerTable = () => {};
    window.renderBookingTable = () => {};
    window.updateTrainDropdowns = () => {};
    window.updateRoutePriceDropdown = () => {};
    window.refreshStats = () => {};
    window.getTrends = () => ({ mostTrain: '—', maxBookings: 0, mostRoute: '—', maxRoute: 0 });
    window.updateAvailableSeats = () => {};
    window.updateTotalPrice = () => {};
    window.resetSessionTimer = () => {};
    window.initDash = () => {};
  });
});

// 10 smoke tests: check the real page, key UI anchors, and available app functions.
const smokeChecks = [
  ['document body is visible', async ({ page }) => await expect(page.locator('body')).toBeVisible()],
  ['page has a non-empty body', async ({ page }) => await expect(page.locator('body')).not.toBeEmpty()],
  ['page URL is the local WAGENS server', async ({ page }) => expect(page.url()).toContain('127.0.0.1:4173')],
  ['login username field exists', async ({ page }) => await expect(page.locator('#username')).toHaveCount(1)],
  ['login error area exists', async ({ page }) => await expect(page.locator('#loginError')).toHaveCount(1)],
  ['login page container exists', async ({ page }) => await expect(page.locator('#loginPage')).toHaveCount(1)],
  ['dashboard container exists', async ({ page }) => await expect(page.locator('#dashPage')).toHaveCount(1)],
  ['booking section exists', async ({ page }) => await expect(page.locator('#bookingSection')).toHaveCount(1)],
  ['passenger section exists', async ({ page }) => await expect(page.locator('#passengerSection')).toHaveCount(1)],
  ['feedback output area exists', async ({ page }) => await expect(page.locator('#output')).toHaveCount(1)],
];
for (const [name, run] of smokeChecks) {
  test(`Smoke: ${name}`, run);
}

// 20 login / role tests.
const invalidUsernames = [
  'guest', 'manager', 'root', 'user', 'ADMINISTRATOR',
  'staff1', 'admin1', 'unknown', '12345', 'invalid user'
];
for (const username of invalidUsernames) {
  test(`Login rejects unsupported username: ${username}`, async ({ page }) => {
    const result = await invoke(page, 'doLogin', { username });
    expect(result.loginError).toContain("Use 'admin' or 'staff'.");
    expect(result.role).toBeNull();
  });
}
const validLoginValues = ['admin', 'staff', 'ADMIN', 'STAFF', ' admin '];
for (const username of validLoginValues) {
  test(`Login accepts supported role input: ${JSON.stringify(username)}`, async ({ page }) => {
    const result = await invoke(page, 'doLogin', { username });
    expect(['admin', 'staff']).toContain(result.role);
  });
}
const roleSelections = [
  ['admin', 'admin'], ['staff', 'staff'], ['admin', 'admin'],
  ['staff', 'staff'], ['admin', 'admin']
];
for (const [selected, expected] of roleSelections) {
  test(`Role selector sets ${selected} in the username field (${expected})`, async ({ page }) => {
    const picked = await page.evaluate((role) => {
      window.pickRole(role);
      return {
        username: document.getElementById('username').value,
        adminClass: document.getElementById('adminBtn').className,
        staffClass: document.getElementById('staffBtn').className
      };
    }, selected);
    expect(picked.username).toBe(expected);
    expect(picked[`${selected}Class`]).toContain(selected === 'admin' ? 'admin-on' : 'staff-on');
  });
}
// 30 passenger tests: 10 valid, 10 invalid phone values, 10 invalid email values.
const validPassengers = [
  ['Passenger01', '0500000001', 'p01@example.com'],
  ['Passenger02', '0500000002', 'p02@example.com'],
  ['Passenger03', '0500000003', 'p03@example.com'],
  ['Passenger04', '0500000004', 'p04@example.com'],
  ['Passenger05', '0500000005', 'p05@example.com'],
  ['Passenger06', '0500000006', 'p06@example.com'],
  ['Passenger07', '0500000007', 'p07@example.com'],
  ['Passenger08', '0500000008', 'p08@example.com'],
  ['Passenger09', '0500000009', 'p09@example.com'],
  ['Passenger10', '0500000010', 'p10@example.com'],
];
for (const [name, phone, email] of validPassengers) {
  test(`Passenger registration accepts valid record ${name}`, async ({ page }) => {
    const result = await invoke(page, 'addPassenger', { pName: name, pPhone: phone, pEmail: email });
    const passengers = await stateOf(page, 'passengers');
    expect(passengers[name]).toBeTruthy();
    expect(passengers[name].phone).toBe(phone);
    expect(passengers[name].email).toBe(email);
    expect(result.output.toLowerCase()).toContain('success');
  });
}
const invalidPhones = ['', '1234567890', '051234567', '0612345678', '05012345678',
  '05abcdefgh', '05 1234567', '+966501234567', '0412345678', '050-123-4567'];
for (let i = 0; i < invalidPhones.length; i++) {
  const phone = invalidPhones[i];
  test(`Passenger registration rejects invalid phone case ${i + 1}`, async ({ page }) => {
    await invoke(page, 'addPassenger', {
      pName: `InvalidPhone${i + 1}`, pPhone: phone, pEmail: `phone${i + 1}@example.com`
    });
    const passengers = await stateOf(page, 'passengers');
    expect(passengers || {}).not.toHaveProperty(`InvalidPhone${i + 1}`);
  });
}
const invalidEmails = ['', 'plain-text', 'missing-at.example.com', 'name@', '@example.com',
  'name@example', 'two@@example.com', 'name with space@example.com',
  'name@example..com', 'name@.com'];
for (let i = 0; i < invalidEmails.length; i++) {
  const email = invalidEmails[i];
  test(`Passenger registration rejects invalid email case ${i + 1}`, async ({ page }) => {
    await invoke(page, 'addPassenger', {
      pName: `InvalidEmail${i + 1}`, pPhone: `05000001${String(i).padStart(2, '0')}`, pEmail: email
    });
    const passengers = await stateOf(page, 'passengers');
    expect(passengers || {}).not.toHaveProperty(`InvalidEmail${i + 1}`);
  });
}

// 25 schedule/train tests: 20 distinct valid train names and 5 empty/blank names.
for (let i = 1; i <= 20; i++) {
  const train = `TestTrain${String(i).padStart(2, '0')}`;
  test(`Schedule creation stores new train ${train}`, async ({ page }) => {
    await invoke(page, 'addSchedule', { train });
    const trains = await stateOf(page, 'trains');
    const capacities = await stateOf(page, 'capacities');
    const schedules = await stateOf(page, 'schedules');
    expect(trains).toContain(train);
    expect(capacities[train]).toBe(100);
    expect(schedules.some(item => item.train === train)).toBeTruthy();
  });
}
for (const [index, train] of ['', ' ', '   ', '\t', '\n'].entries()) {
  test(`Schedule creation rejects blank train name case ${index + 1}`, async ({ page }) => {
    await invoke(page, 'addSchedule', { train });
    expect(await stateOf(page, 'trains') || []).toHaveLength(0);
    expect(await stateOf(page, 'schedules') || []).toHaveLength(0);
  });
}

// 20 route assignment tests: 15 valid route/time pairs and 5 missing fields.
for (let i = 1; i <= 15; i++) {
  const train = `RouteTrain${i}`;
  const route = `City${i} to City${i + 1}`;
  const time = `${String(6 + (i % 12)).padStart(2, '0')}:30`;
  test(`Route assignment stores route ${i}`, async ({ page }) => {
    await invoke(page, 'addRoute', {
      trainNameRoute: train, routeInput: route, timeInput: time
    }, { trains: [train] });
    const trainRoutes = await stateOf(page, 'trainRoutes');
    const routes = await stateOf(page, 'routes');
    expect(trainRoutes[train]).toEqual({ route, time });
    expect(routes).toContain(route);
  });
}
const invalidRouteFields = [
  ['', '08:00'], [' ', '09:00'], ['Riyadh to Jeddah', ''],
  ['Makkah to Madinah', ' '], ['', '']
];
for (const [index, [route, time]] of invalidRouteFields.entries()) {
  test(`Route assignment rejects missing route/time case ${index + 1}`, async ({ page }) => {
    const train = `InvalidRouteTrain${index + 1}`;
    await invoke(page, 'addRoute', {
      trainNameRoute: train, routeInput: route, timeInput: time
    }, { trains: [train] });
    expect(await stateOf(page, 'trainRoutes') || {}).not.toHaveProperty(train);
  });
}

// 25 capacity tests: 15 valid capacities, 5 invalid values, 5 capacities below booked seats.
for (const capacity of [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200]) {
  test(`Capacity accepts positive integer ${capacity}`, async ({ page }) => {
    const train = `CapacityTrain${capacity}`;
    await invoke(page, 'setCapacity', { trainNameCap: train, cap: String(capacity) }, {
      capacities: {}, bookings: {}, trains: [train]
    });
    expect(await stateOf(page, 'capacities')).toHaveProperty(train, capacity);
  });
}
for (const [index, capacity] of ['0', '-1', '1.5', 'abc', ''].entries()) {
  test(`Capacity rejects invalid value case ${index + 1}`, async ({ page }) => {
    const train = `InvalidCapacityTrain${index + 1}`;
    await invoke(page, 'setCapacity', { trainNameCap: train, cap: capacity }, {
      capacities: {}, bookings: {}, trains: [train]
    });
    expect(await stateOf(page, 'capacities') || {}).not.toHaveProperty(train);
  });
}
for (const [index, booked] of [2, 5, 10, 20, 99].entries()) {
  test(`Capacity cannot be lower than booked seats (${booked})`, async ({ page }) => {
    const train = `OverbookedCapacityTrain${index + 1}`;
    await invoke(page, 'setCapacity', { trainNameCap: train, cap: String(booked - 1) }, {
      capacities: { [train]: booked }, bookings: { [train]: booked }, trains: [train]
    });
    expect(await stateOf(page, 'capacities')[train]).toBe(booked);
  });
}

// 20 pricing tests: 10 positive prices, 5 zero/blank, 5 negative prices.
for (const price of [1, 5, 10, 15, 20, 25, 50, 75, 100, 250]) {
  const route = `PriceRoute${price}`;
  test(`Pricing stores positive fare ${price} SAR`, async ({ page }) => {
    await invoke(page, 'setPrice', { routePriceSelect: route, priceInput: String(price) }, {
      routes: [route], prices: {}
    });
    expect(await stateOf(page, 'prices')).toHaveProperty(route, price);
  });
}
for (const [index, price] of ['', '0', '   ', '0.0', '00'].entries()) {
  test(`Pricing does not store zero/blank fare case ${index + 1}`, async ({ page }) => {
    const route = `ZeroPriceRoute${index + 1}`;
    await invoke(page, 'setPrice', { routePriceSelect: route, priceInput: price }, {
      routes: [route], prices: {}
    });
    expect(await stateOf(page, 'prices') || {}).not.toHaveProperty(route);
  });
}
for (const [index, price] of ['-1', '-5', '-10', '-0.5', '-100'].entries()) {
  test(`Pricing rejects negative fare case ${index + 1}`, async ({ page }) => {
    const route = `NegativePriceRoute${index + 1}`;
    await invoke(page, 'setPrice', { routePriceSelect: route, priceInput: price }, {
      routes: [route], prices: {}
    });
    expect(await stateOf(page, 'prices') || {}).not.toHaveProperty(route);
  });
}

// 35 booking tests: 10 successful, 10 unknown passengers, 5 missing routes,
// 5 insufficient-capacity cases, and 5 duplicate-booking cases.
for (let i = 1; i <= 10; i++) {
  const name = `BookingPassenger${i}`;
  const train = `BookingTrain${i}`;
  const tickets = (i % 4) + 1;
  test(`Booking succeeds for ${name} (${tickets} ticket(s))`, async ({ page }) => {
    await invoke(page, 'confirmBooking', {
      userName: name, trainName: train, ticketCount: String(tickets)
    }, {
      passengers: { [name]: { name, phone: '0500000000', email: `${name}@example.com` } },
      trains: [train], capacities: { [train]: 20 }, bookings: { [train]: 0 },
      reservations: [], trainRoutes: { [train]: { route: `Route ${i}`, time: '08:00' } },
      prices: { [`Route ${i}`]: 10 }, bookingLogs: []
    });
    const bookings = await stateOf(page, 'bookings');
    const reservations = await stateOf(page, 'reservations');
    expect(bookings[train]).toBe(tickets);
    expect(reservations).toHaveLength(1);
    expect(reservations[0].name).toBe(name);
    expect(reservations[0].tickets).toBe(tickets);
  });
}
for (let i = 1; i <= 10; i++) {
  const name = `MissingPassenger${i}`;
  const train = `MissingPassengerTrain${i}`;
  test(`Booking rejects unregistered passenger case ${i}`, async ({ page }) => {
    await invoke(page, 'confirmBooking', {
      userName: name, trainName: train, ticketCount: '1'
    }, {
      passengers: {}, capacities: { [train]: 10 }, bookings: { [train]: 0 },
      reservations: [], trainRoutes: { [train]: { route: 'Route A', time: '08:00' } }
    });
    expect(await stateOf(page, 'reservations') || []).toHaveLength(0);
    expect(await stateOf(page, 'bookings')[train]).toBe(0);
  });
}
for (let i = 1; i <= 5; i++) {
  const name = `NoRoutePassenger${i}`;
  const train = `NoRouteTrain${i}`;
  test(`Booking rejects train without route case ${i}`, async ({ page }) => {
    await invoke(page, 'confirmBooking', { userName: name, trainName: train, ticketCount: '1' }, {
      passengers: { [name]: { name } }, capacities: { [train]: 10 }, bookings: { [train]: 0 },
      reservations: [], trainRoutes: {}
    });
    expect(await stateOf(page, 'reservations') || []).toHaveLength(0);
  });
}
for (let i = 1; i <= 5; i++) {
  const name = `CapacityPassenger${i}`;
  const train = `FullTrain${i}`;
  const capacity = i;
  test(`Booking rejects request beyond available seats case ${i}`, async ({ page }) => {
    await invoke(page, 'confirmBooking', { userName: name, trainName: train, ticketCount: String(i + 1) }, {
      passengers: { [name]: { name } }, capacities: { [train]: capacity }, bookings: { [train]: capacity },
      reservations: [], trainRoutes: { [train]: { route: 'Route Full', time: '09:00' } }
    });
    expect(await stateOf(page, 'reservations') || []).toHaveLength(0);
    expect(await stateOf(page, 'bookings')[train]).toBe(capacity);
  });
}
for (let i = 1; i <= 5; i++) {
  const name = `DuplicatePassenger${i}`;
  const train = `DuplicateTrain${i}`;
  test(`Booking prevents duplicate passenger/train reservation case ${i}`, async ({ page }) => {
    const existing = { name, train, tickets: 1, date: '2026-01-01' };
    await invoke(page, 'confirmBooking', { userName: name, trainName: train, ticketCount: '1' }, {
      passengers: { [name]: { name } }, capacities: { [train]: 10 }, bookings: { [train]: 1 },
      reservations: [existing], trainRoutes: { [train]: { route: 'Route Dup', time: '10:00' } }
    });
    expect(await stateOf(page, 'reservations')).toHaveLength(1);
    expect(await stateOf(page, 'bookings')[train]).toBe(1);
  });
}

// 15 cancellation tests: 10 successful seat cancellations and 5 no-booking cases.
for (let i = 1; i <= 10; i++) {
  const train = `CancelTrain${i}`;
  const tickets = (i % 5) + 1;
  test(`Cancellation removes one seat from ${train}`, async ({ page }) => {
    await invoke(page, 'cancelBooking', { cancelTrainInput: train }, {
      bookings: { [train]: tickets }, reservations: [{ name: `CancelP${i}`, train, tickets, date: '2026-01-01' }]
    });
    expect(await stateOf(page, 'bookings')[train]).toBe(tickets - 1);
    const reservations = await stateOf(page, 'reservations');
    if (tickets === 1) expect(reservations).toHaveLength(0);
    else expect(reservations[0].tickets).toBe(tickets - 1);
  });
}
for (const [index, train] of ['', 'UnknownTrain', 'NoBookingsTrain', '  ', 'TrainWithoutCount'].entries()) {
  test(`Cancellation safely rejects missing bookings case ${index + 1}`, async ({ page }) => {
    await invoke(page, 'cancelBooking', { cancelTrainInput: train }, {
      bookings: train === 'TrainWithoutCount' ? { [train]: 0 } : {}, reservations: []
    });
    expect(await stateOf(page, 'reservations') || []).toHaveLength(0);
  });
}
