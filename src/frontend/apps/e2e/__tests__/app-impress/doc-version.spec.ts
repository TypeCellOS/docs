import { Page, expect, test } from '@playwright/test';

import {
  createDoc,
  goToGridDoc,
  mockedDocument,
  verifyDocName,
} from './utils-common';
import { openSuggestionMenu, writeInEditor } from './utils-editor';

const COLLABORATION_VERSION_GRANULARITY_MS = 2000;

async function openHistory(page: Page) {
  await page.getByLabel('Open the document options').click();
  await page.getByRole('menuitem', { name: 'History', exact: true }).click();
  const panel = page.getByRole('complementary', {
    name: 'Version history side panel',
  });
  await expect(panel).toBeVisible();
  // Production grouping has a five-minute minimum. Exercise the real debug
  // control instead of overriding a setting which the editor deliberately clamps.
  await panel.locator('summary').click();
  await panel
    .getByRole('combobox', { name: 'Grouping time unit' })
    .selectOption('1000');
  await panel.getByLabel('Group by', { exact: true }).fill('2');
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(
    panel.getByText('Grouping updated.', { exact: true }),
  ).toBeVisible();
  const versions = panel.getByRole('list', { name: 'Versions', exact: true });
  await expect(versions.getByRole('listitem').first()).toBeVisible();
  await expect(panel.getByRole('alert')).toBeHidden();
  return { panel, versions };
}

async function captureLatestVersion(page: Page) {
  const { panel, versions } = await openHistory(page);
  const id = await versions.getByRole('listitem').first().getAttribute('id');
  expect(id).toContain('-snapshot-');
  const snapshotId = id!.split('-snapshot-')[1];
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  return snapshotId;
}

test.describe('Doc Version', () => {
  test('it displays the doc versions', async ({ page, browserName }) => {
    await page.goto('/');

    await createDoc(page, 'doc-version', browserName, 1);

    const editor = await writeInEditor({ page, text: 'Hello World' });
    const firstVersion = await captureLatestVersion(page);

    await page.waitForTimeout(COLLABORATION_VERSION_GRANULARITY_MS + 10);

    // Write more
    await writeInEditor({ page, text: 'It will create a version' });

    const { suggestionMenu } = await openSuggestionMenu({ page });
    await suggestionMenu.getByText('Add a callout block').click();

    const calloutBlock = page
      .locator('div[data-content-type="callout"]')
      .first();

    await expect(calloutBlock).toBeVisible();
    const secondVersion = await captureLatestVersion(page);

    await page.waitForTimeout(COLLABORATION_VERSION_GRANULARITY_MS + 10);

    // Write more
    await writeInEditor({ page, text: 'It will create a second version' });

    await page.waitForTimeout(COLLABORATION_VERSION_GRANULARITY_MS + 10);

    const { versions } = await openHistory(page);
    const items = versions.getByRole('listitem');
    // The start of the document is pinned separately from its first edit.
    await items.last().click();
    await expect(editor.getByText('Hello World')).toBeHidden();
    await versions.locator(`[id$="-snapshot-${firstVersion}"]`).click();

    await expect(editor.getByText('Hello World')).toBeVisible();
    await expect(editor.getByText('It will create a version')).toBeHidden();
    await expect(
      editor.locator('div[data-content-type="callout"]').first(),
    ).toBeHidden();

    await versions.locator(`[id$="-snapshot-${secondVersion}"]`).click();

    await expect(editor.getByText('Hello World')).toBeVisible();
    await expect(editor.getByText('It will create a version')).toBeVisible();
    await expect(
      editor.locator('div[data-content-type="callout"]').first(),
    ).toBeVisible();
    await expect(
      editor.getByText('It will create a second version'),
    ).toBeHidden();

    await items.nth(0).click();

    await expect(editor.getByText('Hello World')).toBeVisible();
    await expect(editor.getByText('It will create a version')).toBeVisible();
    await expect(
      editor.locator('div[data-content-type="callout"]').first(),
    ).toBeVisible();
    await expect(
      editor.getByText('It will create a second version'),
    ).toBeVisible();
  });

  test('it does not display the doc versions if not allowed', async ({
    page,
  }) => {
    await page.goto('/');

    await mockedDocument(page, {
      abilities: {
        versions_list: false,
        partial_update: true,
      },
    });

    await goToGridDoc(page);

    await verifyDocName(page, 'Mocked document');

    await page.getByLabel('Open the document options').click();
    await expect(page.getByRole('menuitem', { name: 'History' })).toBeHidden();
  });

  test('it restores the doc version', async ({ page, browserName }) => {
    await page.goto('/');

    await createDoc(page, 'doc-version', browserName, 1);

    const editor = await writeInEditor({ page, text: 'Hello' });

    // Add a comment
    await editor.getByText('Hello').selectText();
    await page.getByRole('button', { name: 'Add comment' }).click();

    const thread = page.locator('.bn-thread');
    await thread.getByRole('paragraph').first().fill('This is a comment');
    await thread.locator('[data-test="save"]').click();
    await expect(thread).toBeHidden();
    const firstVersion = await captureLatestVersion(page);

    await page.waitForTimeout(COLLABORATION_VERSION_GRANULARITY_MS + 10);

    await writeInEditor({ page, text: 'World' });

    await page.waitForTimeout(COLLABORATION_VERSION_GRANULARITY_MS + 10);

    await editor.getByText('Hello').click();
    await thread.getByText('This is a comment').first().hover();
    await thread.locator('[data-test="resolve"]').click();
    await expect(thread).toBeHidden();

    const { panel, versions } = await openHistory(page);
    const version = versions.locator(`[id$="-snapshot-${firstVersion}"]`);
    await version.click();
    await expect(editor.getByText('World')).toBeHidden();

    await version
      .getByRole('button', { name: 'More actions', exact: true })
      .click();
    await page.getByRole('menuitem', { name: 'Restore', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Restore version' });
    await expect(confirmation).toBeVisible();
    await confirmation
      .getByRole('button', { name: 'Restore', exact: true })
      .click();
    await expect(confirmation).toBeHidden();
    await expect(panel).toBeHidden();

    const mainEditor = page.getByLabel('Document editor');

    await expect(mainEditor.getByText('Hello')).toBeVisible();
    await expect(mainEditor.getByText('World')).toBeHidden();

    // The old comment is not restored
    await expect(mainEditor.getByText('Hello')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );

    // We can add a new comment
    await mainEditor.getByText('Hello').selectText();
    await page.getByRole('button', { name: 'Add comment' }).click();

    await thread.getByRole('paragraph').first().fill('This is a comment');
    await thread.locator('[data-test="save"]').click();
    await expect(mainEditor.getByText('Hello')).toHaveClass('bn-thread-mark');
  });
});
