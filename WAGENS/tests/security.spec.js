const { test, expect } = require('@playwright/test');

// These tests run against the real, unstubbed app.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
});

async function signInAs(page, role) {
  await page.evaluate((r) => sessionStorage.setItem('role', r), role);
}

test.describe('XSS safety', () => {
  const payload = '<img src=x onerror="window.__pwned=1">';

  test('passenger table renders stored HTML as plain text', async ({ page }) => {
    await page.evaluate((p) => {
      localStorage.setItem('passengers', JSON.stringify({
        [p]: { name: p, phone: p, email: p, registeredAt: p }
      }));
      sessionStorage.setItem('role', 'admin');
      window.renderPassengerTable();
    }, payload);

    await expect(page.locator('#passengerTableBody img')).toHaveCount(0);
    await expect(page.locator('#passengerTableBody')).toContainText('<img src=x');
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test('booking table renders stored HTML as plain text', async ({ page }) => {
    await page.evaluate((p) => {
      localStorage.setItem('bookingLogs', JSON.stringify([
        { name: p, train: p, tickets: 1, date: p }
      ]));
      window.renderBookingTable();
    }, payload);

    await expect(page.locator('#bookingTableBody img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test('train dropdowns render stored HTML as plain text', async ({ page }) => {
    await page.evaluate((p) => {
      localStorage.setItem('trains', JSON.stringify([p]));
      window.updateTrainDropdowns();
    }, payload);

    await expect(page.locator('#trainName option')).toHaveText(payload);
    await expect(page.locator('#trainName img')).toHaveCount(0);
  });

  for (const [field, id] of [['passenger name', 'pName'], ['train name', 'train']]) {
    test(`${field} with angle brackets is rejected`, async ({ page }) => {
      await signInAs(page, 'admin');
      await page.evaluate(({ id }) => {
        document.getElementById(id).value = '<script>alert(1)</script>';
        if (id === 'pName') {
          document.getElementById('pPhone').value = '0500000000';
          document.getElementById('pEmail').value = 'a@example.com';
          window.addPassenger();
        } else {
          window.addSchedule();
        }
      }, { id });
      expect(await page.evaluate(() => localStorage.getItem('passengers'))).toBeNull();
      expect(await page.evaluate(() => localStorage.getItem('trains'))).toBeNull();
    });
  }
});

test.describe('Access control', () => {
  const adminActions = [
    ['setPrice', { routePriceSelect: 'R1', priceInput: '10' }, 'prices'],
    ['setCapacity', { trainNameCap: 'T1', cap: '50' }, 'capacities'],
  ];

  for (const [fn, fields, key] of adminActions) {
    test(`staff cannot call ${fn}`, async ({ page }) => {
      await signInAs(page, 'staff');
      await page.evaluate(({ fn, fields }) => {
        for (const [id, value] of Object.entries(fields)) {
          const el = document.getElementById(id);
          if (el.tagName === 'SELECT') {
            el.replaceChildren(new Option(value, value));
          }
          el.value = value;
        }
        window[fn]();
      }, { fn, fields });
      expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
      await expect(page.locator('#output')).toContainText('Only admin');
    });

    test(`signed-out visitor cannot call ${fn}`, async ({ page }) => {
      await page.evaluate(({ fn }) => window[fn](), { fn });
      expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull();
    });
  }

  test('staff cannot cancel a booking', async ({ page }) => {
    await signInAs(page, 'staff');
    await page.evaluate(() => {
      localStorage.setItem('bookings', JSON.stringify({ T1: 2 }));
      document.getElementById('cancelTrainInput').value = 'T1';
      window.cancelBooking();
    });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bookings')).T1)).toBe(2);
  });

  test('staff cannot reset the system', async ({ page }) => {
    await signInAs(page, 'staff');
    await page.evaluate(() => {
      localStorage.setItem('trains', JSON.stringify(['T1']));
      window.confirm = () => true;
      window.resetStorage();
    });
    expect(await page.evaluate(() => localStorage.getItem('trains'))).not.toBeNull();
  });

  test('staff cannot open admin-only sections', async ({ page }) => {
    await signInAs(page, 'staff');
    await page.evaluate(() => window.showSection('priceSection', null));
    await expect(page.locator('#priceSection')).toBeHidden();
  });

  test('admin reset removes only WAGENS data', async ({ page }) => {
    await signInAs(page, 'admin');
    await page.evaluate(() => {
      localStorage.setItem('trains', JSON.stringify(['T1']));
      localStorage.setItem('unrelated', 'keep-me');
      window.confirm = () => true;
      window.resetStorage();
    });
    expect(await page.evaluate(() => localStorage.getItem('trains'))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem('unrelated'))).toBe('keep-me');
  });
});

test.describe('Session and storage hardening', () => {
  test('role is kept in sessionStorage, never localStorage', async ({ page }) => {
    await page.fill('#username', 'admin');
    await page.fill('#password', 'admin123');
    await page.click('[data-click="doLogin"]');
    await expect(page.locator('#dashPage')).toBeVisible();

    expect(await page.evaluate(() => sessionStorage.getItem('role'))).toBe('admin');
    expect(await page.evaluate(() => localStorage.getItem('role'))).toBeNull();
  });

  test('a forged role value is ignored', async ({ page }) => {
    const role = await page.evaluate(() => {
      sessionStorage.setItem('role', 'superuser');
      return window.getRole();
    });
    expect(role).toBeNull();
  });

  test('passwords are not present in the page source', async ({ page }) => {
    const script = await (await page.request.get('/script.js')).text();
    expect(script).not.toMatch(/password:\s*["']admin123["']/);
    expect(script).not.toMatch(/password:\s*["']staff123["']/);
  });

  test('corrupted storage falls back to safe defaults', async ({ page }) => {
    const safe = await page.evaluate(() => {
      localStorage.setItem('passengers', '"not an object"');
      localStorage.setItem('trains', '{"oops":true}');
      localStorage.setItem('bookingLogs', 'not json at all');
      return {
        passengers: window.load('passengers', {}),
        trains: window.load('trains', []),
        logs: window.load('bookingLogs', [])
      };
    });
    expect(safe.passengers).toEqual({});
    expect(safe.trains).toEqual([]);
    expect(safe.logs).toEqual([]);
  });

  for (const key of ['__proto__', 'constructor', 'prototype']) {
    test(`reserved name "${key}" is rejected as passenger and train`, async ({ page }) => {
      await signInAs(page, 'admin');
      await page.evaluate((k) => {
        document.getElementById('pName').value = k;
        document.getElementById('pPhone').value = '0500000000';
        document.getElementById('pEmail').value = 'a@example.com';
        window.addPassenger();
        document.getElementById('train').value = k;
        window.addSchedule();
      }, key);
      expect(await page.evaluate(() => localStorage.getItem('passengers'))).toBeNull();
      expect(await page.evaluate(() => localStorage.getItem('trains'))).toBeNull();
    });
  }
});

test.describe('Page hygiene', () => {
  test('page declares a content security policy', async ({ page }) => {
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    expect(csp).toContain("script-src 'self'");
  });

  test('no inline event handlers remain in the markup', async ({ page }) => {
    const count = await page.evaluate(() =>
      document.querySelectorAll('[onclick],[onchange],[oninput],[onkeydown]').length);
    expect(count).toBe(0);
  });

  test('every form control has a label', async ({ page }) => {
    const unlabeled = await page.evaluate(() =>
      [...document.querySelectorAll('input, select')]
        .filter((el) => !document.querySelector(`label[for="${el.id}"]`))
        .map((el) => el.id));
    expect(unlabeled).toEqual([]);
  });

  test('the login button works without inline handlers', async ({ page }) => {
    await page.fill('#username', 'admin');
    await page.fill('#password', 'wrong');
    await page.click('[data-click="doLogin"]');
    await expect(page.locator('#loginError')).toContainText('Invalid username or password.');
  });
});
