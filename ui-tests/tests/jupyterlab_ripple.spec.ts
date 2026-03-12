import { expect, test } from '@jupyterlab/galata';

/**
 * Don't load JupyterLab webpage before running the tests.
 * This is required to ensure we capture all log messages.
 */
test.use({ autoGoto: false });

test('should emit activation console messages for both plugins', async ({
  page
}) => {
  const logs: string[] = [];

  page.on('console', message => {
    logs.push(message.text());
  });

  await page.goto();

  expect(
    logs.filter(s => s === 'Ripple: Activated reactive cell executor.')
  ).toHaveLength(1);

  expect(
    logs.filter(s => s === 'Ripple: UI plugin activated.')
  ).toHaveLength(1);
});
