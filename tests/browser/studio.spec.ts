import { test, expect } from '@playwright/test';
test('temporary failure produces a real timeline and one receipt', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Run this scenario' }).click();
  await expect(
    page.getByRole('region', { name: 'Run timeline' }).getByText('Delivered', { exact: true }),
  ).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Attempt 3 started', { exact: true })).toBeVisible();
  await expect(page.getByText('One operation, one receipt')).toBeVisible();
  await page.getByRole('button', { name: 'Replay safely' }).click();
  await expect(page.getByText('Recovered without a duplicate', { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByRole('button', { name: 'See the previous run' })).toBeVisible();
});
test('outage can be restored and replayed without rewriting the first run', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: /The receiver is away/ }).click();
  await page.getByRole('button', { name: 'Run this scenario' }).click();
  await expect(page.getByText('The retry budget is spent.')).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Restore receiver & replay' }).click();
  await expect(page.getByText('Delivery confirmed', { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole('button', { name: 'See the previous run' }).click();
  await expect(page.getByText('The retry budget is spent.')).toBeVisible();
});
test('mobile viewport fits and scenarios support keyboard navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const first = page.getByRole('radio', { name: /A little turbulence/ });
  await first.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: /The receiver is away/ })).toBeChecked();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Run this scenario' }).click();
  await expect(page.getByText('Recovered without a duplicate', { exact: true })).toBeVisible({
    timeout: 10000,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByRole('button', { name: 'Behind the scenes' }).click();
  await expect(page.getByRole('heading', { name: 'A receipt prevents duplicates.' })).toBeVisible();
});

test('connection loss stops motion and recovery refreshes real state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Run this scenario' }).click();
  await expect(
    page.getByRole('region', { name: 'Run timeline' }).getByText('Original run', { exact: false }),
  ).toBeVisible();
  await page.route('**/api/state', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Store unavailable.' }),
    }),
  );
  await expect(page.getByText(/Store unavailable.*last known state/)).toBeVisible();
  await expect(page.locator('.flow')).not.toHaveClass(/moving/);
  await page.unroute('**/api/state');
  await expect(
    page.getByRole('region', { name: 'Run timeline' }).getByText('Delivered', { exact: true }),
  ).toBeVisible({ timeout: 20000 });
});
