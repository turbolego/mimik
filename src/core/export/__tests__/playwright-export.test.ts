// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { exportGuideAsPlaywright } from '@/core/export/playwright-export';
import type { ElementMeta, Guide, Step } from '@/core/guides/types';

function makeGuide(overrides: Partial<Guide> = {}): Guide {
  return {
    id: 'guide-1',
    title: 'Test Guide',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    stepIds: [],
    starred: false,
    deletedAt: null,
    ...overrides,
  };
}

function makeMeta(overrides: Partial<ElementMeta> = {}): ElementMeta {
  return {
    tag: 'button',
    cssSelector: 'body > div > button',
    textContent: 'Submit',
    ariaLabel: null,
    placeholder: null,
    altText: null,
    name: null,
    role: null,
    href: null,
    inputType: null,
    dataTestId: null,
    rect: { x: 0, y: 0, width: 100, height: 40 },
    devicePixelRatio: 1,
    ...overrides,
  };
}

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: 'step-1',
    guideId: 'guide-1',
    index: 0,
    description: 'Click the submit button',
    action: 'click',
    url: 'https://example.com/login',
    timestamp: Date.now(),
    elementMeta: makeMeta(),
    ...overrides,
  };
}

describe('exportGuideAsPlaywright', () => {
  it('generates a valid test file with import and test wrapper', () => {
    const guide = makeGuide({ title: 'My Guide' });
    const steps = [makeStep()];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain("import { test, expect } from '@playwright/test';");
    expect(result).toContain("test('My Guide', async ({ page }) => {");
    expect(result).toContain('});');
  });

  it('starts with page.goto of the full first step URL (not just origin)', () => {
    const guide = makeGuide();
    const steps = [makeStep({ url: 'https://example.com/settings/profile' })];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain("await page.goto('https://example.com/settings/profile');");
  });

  it('navigates to a new origin when URL changes across steps', () => {
    const guide = makeGuide();
    const steps = [
      makeStep({ url: 'https://example.com/login' }),
      makeStep({
        id: 'step-2',
        index: 1,
        url: 'https://other-site.com/dashboard',
        description: 'Go to dashboard',
      }),
    ];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain("await page.goto('https://other-site.com/dashboard');");
  });

  it('escapes single quotes in titles and descriptions', () => {
    const guide = makeGuide({ title: "User's Guide" });
    const steps = [makeStep({ description: "Don't click here" })];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain("test('User\\'s Guide'");
    expect(result).toContain("// Don\\'t click here");
  });

  it('escapes newlines in descriptions', () => {
    const guide = makeGuide();
    const steps = [makeStep({ description: 'Line one\nLine two' })];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain('// Line one\\nLine two');
  });

  it('uses getByTestId when data-testid is present', () => {
    const guide = makeGuide();
    const steps = [makeStep({ elementMeta: makeMeta({ dataTestId: 'submit-btn' }) })];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain("page.getByTestId('submit-btn')");
  });

  it('uses getByLabel when aria-label is present', () => {
    const guide = makeGuide();
    const steps = [makeStep({ elementMeta: makeMeta({ ariaLabel: 'Email address' }) })];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain("page.getByLabel('Email address')");
  });

  it('uses getByLabel when role equals tag and aria-label is present', () => {
    const guide = makeGuide();
    const steps = [makeStep({ elementMeta: makeMeta({ role: 'button', ariaLabel: 'Save changes' }) })];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain("page.getByLabel('Save changes')");
  });

  it('uses getByPlaceholder when placeholder is present', () => {
    const guide = makeGuide();
    const steps = [makeStep({ elementMeta: makeMeta({ tag: 'input', placeholder: 'Enter your name' }) })];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain("page.getByPlaceholder('Enter your name')");
  });

  it('uses getByRole with name when role + textContent are present', () => {
    const guide = makeGuide();
    const steps = [makeStep({ elementMeta: makeMeta({ role: 'button', textContent: 'Submit' }) })];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain("page.getByRole('button', { name: 'Submit' })");
  });

  it('uses getByText for text-bearing tags', () => {
    const guide = makeGuide();
    const steps = [makeStep({ elementMeta: makeMeta({ tag: 'a', textContent: 'Click here', role: null }) })];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain("page.getByText('Click here')");
  });

  it('falls back to page.locator with CSS selector', () => {
    const guide = makeGuide();
    const steps = [
      makeStep({
        elementMeta: makeMeta({
          tag: 'button',
          textContent: null,
          ariaLabel: null,
          placeholder: null,
          role: null,
          dataTestId: null,
          cssSelector: '#my-form > button.primary',
        }),
      }),
    ];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain("page.locator('#my-form > button.primary')");
  });

  it('generates page.fill() for input actions', () => {
    const guide = makeGuide();
    const steps = [
      makeStep({
        action: 'input',
        inputValue: 'user@example.com',
        elementMeta: makeMeta({ tag: 'input', inputType: 'email' }),
      }),
    ];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain(".fill('user@example.com')");
  });

  it('generates selectOption for select elements', () => {
    const guide = makeGuide();
    const steps = [
      makeStep({
        action: 'input',
        inputValue: 'option-2',
        elementMeta: makeMeta({ tag: 'select' }),
      }),
    ];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain(".selectOption('option-2')");
  });

  it('generates .check() for checkbox inputs', () => {
    const guide = makeGuide();
    const steps = [
      makeStep({
        action: 'input',
        elementMeta: makeMeta({ tag: 'input', inputType: 'checkbox' }),
      }),
    ];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain('.check()');
  });

  it('generates click({ button: middle }) for auxclick actions', () => {
    const guide = makeGuide();
    const steps = [
      makeStep({ action: 'auxclick', elementMeta: makeMeta({ role: 'link', href: 'https://example.com' }) }),
    ];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain(".click({ button: 'middle' })");
  });

  it('generates TODO comment for drag actions instead of misleading code', () => {
    const guide = makeGuide();
    const steps = [makeStep({ action: 'drag' })];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain('// TODO: Drag from');
    expect(result).not.toContain('.dragTo(');
  });

  it('generates keyboard.press for keydown actions', () => {
    const guide = makeGuide();
    const steps = [makeStep({ action: 'keydown:Enter' })];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain("await page.keyboard.press('Enter')");
  });

  it('generates keyboard shortcut for copy/paste/cut', () => {
    const guide = makeGuide();
    const steps = [
      makeStep({ id: 's1', index: 0, action: 'copy' }),
      makeStep({ id: 's2', index: 1, action: 'paste' }),
      makeStep({ id: 's3', index: 2, action: 'cut' }),
    ];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain("page.keyboard.press('ControlOrMeta+C')");
    expect(result).toContain("page.keyboard.press('ControlOrMeta+V')");
    expect(result).toContain("page.keyboard.press('ControlOrMeta+X')");
  });

  it('handles steps without elementMeta gracefully', () => {
    const guide = makeGuide();
    const steps = [makeStep({ elementMeta: undefined })];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain('No element metadata');
    expect(result).not.toContain('undefined');
  });

  it('renders heading blocks as comments', () => {
    const guide = makeGuide();
    const steps = [
      makeStep({ id: 'block-1', blockType: 'heading', description: 'Section one', url: '' }),
      makeStep({ id: 'step-1', index: 1 }),
    ];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain('// --- Section one ---');
  });

  it('renders callout blocks as notes', () => {
    const guide = makeGuide();
    const steps = [makeStep({ id: 'block-1', blockType: 'callout', description: 'Heads up', url: '' })];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).toContain('// Note: Heads up');
  });

  it('handles empty guide with no steps', () => {
    const guide = makeGuide();
    const result = exportGuideAsPlaywright(guide, []);

    expect(result).toContain("test('Test Guide'");
    expect(result).not.toContain('page.goto');
  });

  it('handles guide with no URL on the first step', () => {
    const guide = makeGuide();
    const steps = [makeStep({ url: '' })];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).not.toContain('page.goto');
    expect(result).toContain('page.locator');
  });

  it('does not emit garbage for undefined/null values', () => {
    const guide = makeGuide({ title: '' });
    const steps = [makeStep({ description: 'Step one', elementMeta: undefined })];
    const result = exportGuideAsPlaywright(guide, steps);

    expect(result).not.toContain('undefined');
    expect(result).not.toContain('null');
  });
});
