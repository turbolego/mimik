import { isBlock, stepNumbers } from '@/core/guides/blocks';
import type { ElementMeta, Guide, Step } from '@/core/guides/types';

/**
 * Escape a string value for use inside a single-quoted Playwright string.
 * Handles backslashes, backticks, template interpolation, single quotes,
 * and newlines.
 */
function esc(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\${/g, '\\${')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n');
}

/**
 * Escape a string for use inside a double-quoted CSS attribute selector value.
 */
function escAttr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

/**
 * Build a Playwright locator in the style Playwright Codegen generates.
 *
 * Codegen's heuristic: prefer `page.locator()` with a CSS selector
 * as the first choice, and only fall back to getByRole/getByText when
 * the CSS selector is too generic (body, div, span, etc.) or the element
 * has strong semantic signals (role, aria-label, testid).
 */
function codegenLocator(meta: ElementMeta): string {
  const tag = meta.tag || '';

  // data-testid is the strongest signal — codegen uses it when present
  if (meta.dataTestId) {
    return `page.getByTestId('${esc(meta.dataTestId)}')`;
  }

  // aria-label maps to getByRole or getByLabel
  if (meta.ariaLabel) {
    if (meta.role && meta.role !== 'generic' && meta.role !== tag) {
      return `page.getByRole('${meta.role}', { name: '${esc(meta.ariaLabel)}' })`;
    }
    return `page.getByLabel('${esc(meta.ariaLabel)}')`;
  }

  // placeholder → getByPlaceholder
  if (meta.placeholder) {
    return `page.getByPlaceholder('${esc(meta.placeholder)}')`;
  }

  // Role + text → getByRole (codegen generates this for buttons, links, etc.)
  if (meta.role && meta.textContent) {
    const semanticRoles = new Set([
      'button',
      'link',
      'checkbox',
      'radio',
      'menuitem',
      'tab',
      'option',
      'heading',
      'listbox',
      'combobox',
      'switch',
    ]);
    if (semanticRoles.has(meta.role)) {
      return `page.getByRole('${meta.role}', { name: '${esc(meta.textContent)}' })`;
    }
  }

  // text content for simple elements → getByText
  if (
    meta.textContent &&
    ['a', 'span', 'div', 'p', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th'].includes(tag)
  ) {
    return `page.getByText('${esc(meta.textContent)}')`;
  }

  // CSS selector fallback — this is Playwright codegen's bread and butter
  const css = meta.cssSelector || tag;
  // If the selector is too generic, try to build a better one from attributes
  if (css === 'body' || css === 'div' || css === 'span' || css === tag) {
    const parts: string[] = [tag];
    if (meta.name) parts.push(`[name="${escAttr(meta.name)}"]`);
    if (meta.inputType) parts.push(`[type="${escAttr(meta.inputType)}"]`);
    if (meta.href) {
      try {
        const u = new URL(meta.href);
        parts.push(`[href="${escAttr(u.pathname + u.search)}"]`);
      } catch {
        parts.push(`[href="${escAttr(meta.href)}"]`);
      }
    }
    return `page.locator('${parts.join('')}')`;
  }

  return `page.locator('${esc(css)}')`;
}

/**
 * Generate the Playwright action line for a step.
 * Returns lines of code, or null if the step has no element metadata
 * (the caller should emit a comment instead).
 */
function codegenAction(step: Step): string | null {
  if (!step.elementMeta) {
    return null;
  }

  const meta = step.elementMeta;
  const sel = codegenLocator(meta);

  switch (step.action) {
    case 'click':
      if (meta.role === 'link' || meta.href) return `  await ${sel}.click();`;
      if (meta.role === 'checkbox' || meta.inputType === 'checkbox') return `  await ${sel}.check();`;
      if (meta.role === 'radio' || meta.inputType === 'radio') return `  await ${sel}.check();`;
      return `  await ${sel}.click();`;

    case 'auxclick':
      // Middle-click — use Playwright's button option to match the browser behavior
      if (meta.role === 'link' || meta.href) return `  await ${sel}.click({ button: 'middle' });`;
      if (meta.role === 'checkbox' || meta.inputType === 'checkbox') return `  await ${sel}.check();`;
      if (meta.role === 'radio' || meta.inputType === 'radio') return `  await ${sel}.check();`;
      return `  await ${sel}.click({ button: 'middle' });`;

    case 'input': {
      if (meta.role === 'checkbox' || meta.inputType === 'checkbox') return `  await ${sel}.check();`;
      if (meta.role === 'radio' || meta.inputType === 'radio') return `  await ${sel}.check();`;
      if (meta.tag === 'select') return `  await ${sel}.selectOption('${esc(step.inputValue ?? '')}');`;
      const value = esc(step.inputValue ?? '');
      // codegen generates locator.fill() for text inputs
      return `  await ${sel}.fill('${value}');`;
    }

    case 'paste':
      return `  await ${sel}.click();\n  await page.keyboard.press('ControlOrMeta+V');`;
    case 'copy':
      return `  await ${sel}.click();\n  await page.keyboard.press('ControlOrMeta+C');`;
    case 'cut':
      return `  await ${sel}.click();\n  await page.keyboard.press('ControlOrMeta+X');`;

    case 'drag':
      // Mimik captures the source element but not the drop target, so a
      // self-dragTo is misleading. Emit a placeholder instead.
      return `  // TODO: Drag from ${sel} — add a drop target to complete this action`;

    default:
      if (step.action.startsWith('keydown:')) {
        const key = step.action.split(':')[1];
        // Map common keys to Playwright key names
        const keyMap: Record<string, string> = {
          Enter: 'Enter',
          Escape: 'Escape',
          Tab: 'Tab',
          ArrowUp: 'ArrowUp',
          ArrowDown: 'ArrowDown',
          ArrowLeft: 'ArrowLeft',
          ArrowRight: 'ArrowRight',
          Backspace: 'Backspace',
          Delete: 'Delete',
          Home: 'Home',
          End: 'End',
          ' ': 'Space',
          Shift: 'Shift',
          Control: 'Control',
          Alt: 'Alt',
          Meta: 'Meta',
        };
        const pwKey = keyMap[key] ?? (key.length === 1 ? key : key);
        const quoted = pwKey.length === 1 ? `'${pwKey}'` : `'${pwKey}'`;
        return `  await page.keyboard.press(${quoted});`;
      }
      return `  await ${sel}.click();`;
  }
}

/**
 * Export a Mimik guide as a Playwright test file, using Playwright Codegen's
 * locator style and output format.
 *
 * The generated code follows the same patterns as `npx playwright codegen`:
 * - `page.locator('css-selector')` for CSS-based element selection
 * - `page.getByRole()`, `page.getByText()` for semantic locators
 * - `page.fill()` for text inputs
 * - `page.goto()` for navigation
 * - `page.keyboard.press()` for keyboard actions
 */
export function exportGuideAsPlaywright(guide: Guide, steps: Step[]): string {
  const numbers = stepNumbers(steps);
  const firstStep = steps.find((s) => s.url && !isBlock(s));
  // Use the full URL of the first step, not just the origin, so the
  // exported test starts on the correct page (path + query included).
  const firstUrl = firstStep?.url ?? '';

  const lines: string[] = [
    "import { test, expect } from '@playwright/test';",
    '',
    `test('${esc(guide.title || 'Untitled Guide')}', async ({ page }) => {`,
  ];

  // Start with the full URL of the first recorded step
  if (firstUrl) {
    lines.push(`  await page.goto('${esc(firstUrl)}');`);
  }

  for (const step of steps) {
    if (isBlock(step)) {
      if (step.blockType === 'heading') {
        lines.push('');
        lines.push(`  // --- ${esc(step.description)} ---`);
        lines.push('');
      } else {
        lines.push(`  // Note: ${esc(step.description)}`);
      }
      continue;
    }

    const num = numbers.get(step.id) ?? 0;
    const comment = esc(step.description || `Step ${num}`);
    const url = step.url;
    const origin = firstUrl ? new URL(firstUrl).origin : '';

    // Navigate when the URL origin changes (codegen mirrors navigation)
    if (url) {
      try {
        const stepUrl = new URL(url);
        if (stepUrl.origin !== origin) {
          lines.push(`  await page.goto('${esc(url)}');`);
          lines.push('');
          lines.push(`  // ${comment}`);
          const action = codegenAction(step);
          if (action) {
            lines.push(action);
          } else {
            lines.push(`  // No element metadata — ${comment}`);
          }
          continue;
        }
      } catch {
        // ignore invalid URLs
      }
    }

    lines.push('');
    lines.push(`  // ${comment}`);
    const action = codegenAction(step);
    if (action) {
      lines.push(action);
    } else {
      lines.push(`  // No element metadata — ${comment}`);
    }
  }

  lines.push('});');
  lines.push('');

  return lines.join('\n');
}
