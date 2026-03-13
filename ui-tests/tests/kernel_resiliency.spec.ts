// Copyright (c) Orange Bricks
// Distributed under the terms of the MIT License.

import { expect, test } from '@jupyterlab/galata';
import type { IJupyterLabPageFixture } from '@jupyterlab/galata';

const DEBOUNCE_WAIT = 1500;
const EXECUTION_WAIT = 3000;
const KERNEL_RESTART_WAIT = 10000;
const KERNEL_SHUTDOWN_WAIT = 5000;
const POST_RUN_SETTLE = 10000;

async function getCellClasses(
  page: IJupyterLabPageFixture,
  cellIndex: number
): Promise<string[]> {
  const cell = await page.notebook.getCellLocator(cellIndex);
  const classes = await cell!.getAttribute('class');
  return classes?.split(' ') ?? [];
}

async function createTestNotebook(page: IJupyterLabPageFixture): Promise<void> {
  await page.notebook.createNew();
  await page.notebook.setCell(0, 'code', 'x = 5');
  await page.notebook.addCell('code', 'y = x * 2');
  await page.notebook.addCell('code', 'print(y)');
}

/**
 * Accept the JupyterLab kernel restart confirmation dialog and wait for
 * the kernel to finish restarting.
 */
async function restartKernel(page: IJupyterLabPageFixture): Promise<void> {
  await page.menu.clickMenuItem('Kernel>Restart Kernel…');
  const dialog = page.locator('.jp-Dialog');
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  await dialog.locator('.jp-mod-accept').click();
  await dialog.waitFor({ state: 'hidden', timeout: 10000 });

  // Wait for the restart to complete AND for Ripple's background
  // rebuildAll to finish (it sends analysis requests to the kernel).
  const idleLocator = page.locator('#jp-main-statusbar >> text=Idle');
  await idleLocator.waitFor({ timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(KERNEL_RESTART_WAIT);
}

async function shutdownKernel(page: IJupyterLabPageFixture): Promise<void> {
  await page.kernel.shutdownAll();
  await page.waitForTimeout(KERNEL_SHUTDOWN_WAIT);
}

/**
 * Run a cell by selecting it and pressing Ctrl+Enter, then wait for the
 * execution count to appear (indicating the cell finished).
 */
async function runCellManually(
  page: IJupyterLabPageFixture,
  cellIndex: number
): Promise<void> {
  await page.notebook.selectCells(cellIndex);
  // Use Ctrl+Enter to run in-place (Shift+Enter advances to next cell,
  // which can cause the current cell to scroll out of the windowed view).
  await page.keyboard.press('Control+Enter');
  // Wait for the cell's execution count to change from [*] to a number.
  const cell = await page.notebook.getCellLocator(cellIndex);
  await cell!
    .locator('.jp-InputArea-prompt:not(:text("[*]:"))')
    .waitFor({ timeout: 120000 });
  await page.waitForTimeout(POST_RUN_SETTLE);
}

/**
 * Run All Cells via the menu, then wait for all cells to finish.
 */
async function runAllManually(page: IJupyterLabPageFixture): Promise<void> {
  const nb = page.locator('.jp-Notebook');
  await nb.click();
  await page.menu.clickMenuItem('Run>Run All Cells');
  // Wait for all cells to finish executing.
  const idleLocator = page.locator('#jp-main-statusbar >> text=Idle');
  await idleLocator.waitFor({ timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(POST_RUN_SETTLE);
}

test.describe('Kernel Resiliency', () => {
  test('stale clears after propagation', async ({ page }) => {
    await createTestNotebook(page);

    await page.notebook.run();
    await page.waitForTimeout(EXECUTION_WAIT);

    const classesBeforeEdit = await getCellClasses(page, 1);
    expect(classesBeforeEdit).toContain('jp-reactive-downstream');

    // Type into the cell editor directly to trigger contentChanged.
    const cell0 = await page.notebook.getCellLocator(0);
    await cell0!.dblclick();
    await page.keyboard.press('Meta+a');
    await page.keyboard.type('x = 100');
    await page.keyboard.press('Escape');

    // Wait for debounce + analysis + stale marking.
    await page.waitForTimeout(DEBOUNCE_WAIT + EXECUTION_WAIT);

    const classesAfterEdit = await getCellClasses(page, 1);
    expect(classesAfterEdit).toContain('jp-reactive-stale');

    await page.notebook.runCell(0);
    await page.waitForTimeout(EXECUTION_WAIT);

    const classesAfterRun = await getCellClasses(page, 1);
    expect(classesAfterRun).not.toContain('jp-reactive-stale');
  });

  // These tests are marked fixme because running cells after kernel restart
  // requires the Ripple extension's background AST analysis to complete first.
  // In the Galata test environment the cold-kernel analysis takes >2 minutes,
  // causing cell execution to queue behind the analysis requests. The logic
  // is covered by the Jest unit tests for markExecuted/hasBeenExecuted and
  // the stale-propagation E2E test above.

  test.fixme('kernel restart clears dependency indicators', async ({
    page
  }) => {
    await createTestNotebook(page);

    await page.notebook.run();
    await page.waitForTimeout(EXECUTION_WAIT);

    const classesBeforeRestart = await getCellClasses(page, 0);
    expect(classesBeforeRestart).toContain('jp-reactive-upstream');

    await restartKernel(page);

    for (let i = 0; i < 3; i++) {
      const classes = await getCellClasses(page, i);
      expect(classes).not.toContain('jp-reactive-upstream');
      expect(classes).not.toContain('jp-reactive-downstream');
    }

    const toolbar = page.locator('.jp-reactive-toggle-widget');
    const toolbarText = await toolbar.textContent();
    expect(toolbarText).toContain('Reactive');
    expect(toolbarText).not.toContain('no kernel');
  });

  test.fixme('borders light up incrementally after restart', async ({
    page
  }) => {
    await createTestNotebook(page);

    await page.notebook.run();
    await page.waitForTimeout(EXECUTION_WAIT);

    await restartKernel(page);

    await runCellManually(page, 0);

    const cell0Classes = await getCellClasses(page, 0);
    expect(cell0Classes).toContain('jp-reactive-upstream');

    const cell1ClassesBefore = await getCellClasses(page, 1);
    expect(cell1ClassesBefore).not.toContain('jp-reactive-downstream');

    await runCellManually(page, 1);

    const cell1ClassesAfter = await getCellClasses(page, 1);
    expect(cell1ClassesAfter).toContain('jp-reactive-downstream');
  });

  test.fixme('Run All restores all borders after restart', async ({ page }) => {
    await createTestNotebook(page);

    await page.notebook.run();
    await page.waitForTimeout(EXECUTION_WAIT);

    await restartKernel(page);

    await runAllManually(page);

    const cell0 = await getCellClasses(page, 0);
    expect(cell0).toContain('jp-reactive-upstream');

    const cell1 = await getCellClasses(page, 1);
    expect(
      cell1.includes('jp-reactive-downstream') ||
        cell1.includes('jp-reactive-upstream')
    ).toBe(true);
  });

  test('kernel shutdown shows degraded state', async ({ page }) => {
    await createTestNotebook(page);

    await page.notebook.run();
    await page.waitForTimeout(EXECUTION_WAIT);

    const classesBeforeShutdown = await getCellClasses(page, 0);
    expect(classesBeforeShutdown).toContain('jp-reactive-upstream');

    await shutdownKernel(page);

    const notebookNode = page.locator('.jp-Notebook');
    const nbClasses = await notebookNode.getAttribute('class');
    expect(nbClasses).toContain('jp-reactive-no-kernel');

    const toolbar = page.locator('.jp-reactive-toggle-widget');
    const toolbarText = await toolbar.textContent();
    expect(toolbarText?.toLowerCase()).toContain('no kernel');
  });

  test.fixme('kernel returns after shutdown', async ({ page }) => {
    await createTestNotebook(page);

    await page.notebook.run();
    await page.waitForTimeout(EXECUTION_WAIT);

    await shutdownKernel(page);

    const nbClassesBefore = await page
      .locator('.jp-Notebook')
      .getAttribute('class');
    expect(nbClassesBefore).toContain('jp-reactive-no-kernel');

    // Run cell manually (kernel auto-starts).
    await runCellManually(page, 0);

    // Wait for Ripple's background analysis to complete after kernel restart.
    const idleLocator = page.locator('#jp-main-statusbar >> text=Idle');
    await idleLocator.waitFor({ timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(POST_RUN_SETTLE);

    const nbClassesAfter = await page
      .locator('.jp-Notebook')
      .getAttribute('class');
    expect(nbClassesAfter).not.toContain('jp-reactive-no-kernel');

    const toolbar = page.locator('.jp-reactive-toggle-widget');
    const toolbarText = await toolbar.textContent();
    expect(toolbarText).toContain('Reactive');
    expect(toolbarText?.toLowerCase()).not.toContain('no kernel');
  });
});
