import { expect, type Page } from '@playwright/test'

/** Problems found on the current page, empty when the layout is fine. */
function findLayoutProblems() {
  const problems: string[] = []
  const viewportWidth = document.documentElement.clientWidth
  const describe = (element: Element) => {
    const rect = element.getBoundingClientRect()
    const text = (element.getAttribute('aria-label') ?? element.textContent).trim().slice(0, 30)
    return `<${element.tagName.toLowerCase()}> "${text}" at x ${String(Math.round(rect.left))}..${String(Math.round(rect.right))}`
  }
  const isVisible = (element: Element) => {
    const rect = element.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) return false
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (node.getAttribute('aria-hidden') === 'true') return false
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      if (Number(style.opacity) === 0) return false
    }
    return true
  }
  const scrollsSideways = (element: Element) => {
    for (
      let node = element.parentElement;
      node && node !== document.body;
      node = node.parentElement
    ) {
      if (getComputedStyle(node).overflowX !== 'visible') return true
    }
    return false
  }
  const insideFixed = (element: Element) => {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const position = getComputedStyle(node).position
      if (position === 'fixed' || position === 'sticky') return true
    }
    return false
  }

  if (document.documentElement.scrollWidth > viewportWidth) {
    problems.push(
      `page scrolls sideways: scrollWidth ${String(document.documentElement.scrollWidth)} > ${String(viewportWidth)}`,
    )
  }

  for (const element of document.body.querySelectorAll('*')) {
    if (!isVisible(element) || scrollsSideways(element)) continue
    const rect = element.getBoundingClientRect()
    if (rect.left < -0.5 || rect.right > viewportWidth + 0.5) {
      problems.push(`outside the viewport: ${describe(element)}`)
    }
  }

  const dialog = document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')
  const scope = dialog ?? document.body
  const interactive = [
    ...scope.querySelectorAll(
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"]',
    ),
  ].filter(isVisible)
  for (const [index, first] of interactive.entries()) {
    for (const second of interactive.slice(index + 1)) {
      if (first.contains(second) || second.contains(first)) continue
      if (insideFixed(first) !== insideFixed(second)) continue
      const a = first.getBoundingClientRect()
      const b = second.getBoundingClientRect()
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (overlapX > 1 && overlapY > 1) {
        problems.push(`overlapping controls: ${describe(first)} and ${describe(second)}`)
      }
    }
  }
  return problems
}

/** Fails when the current page scrolls sideways, has visible content outside the viewport, or controls that overlap. */
export async function expectLayout(page: Page, screen: string) {
  const problems = await page.evaluate(findLayoutProblems)
  expect(problems, `layout of ${screen}`).toEqual([])
}
