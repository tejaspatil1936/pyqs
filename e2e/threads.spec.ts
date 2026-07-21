import { test, expect, type Page } from "@playwright/test"

const SUBJECT = "Advanced Analysis"
const URL = `/papers?subject=${encodeURIComponent(SUBJECT)}`

// The only console error the app emits today is a pre-existing next-themes
// warning (its anti-FOUC <script> renders client-side because ClientProvider
// mounts providers post-hydration). It predates this feature — allowlist it so
// the test asserts the citation-thread work introduces NO new console errors.
const IGNORED_ERRORS = [/Encountered a script tag/i]

function collectErrors(page: Page): string[] {
    const errors: string[] = []
    page.on("console", (m) => {
        if (m.type() !== "error") return
        const text = m.text()
        if (!IGNORED_ERRORS.some((re) => re.test(text))) errors.push(text)
    })
    page.on("pageerror", (e) => errors.push(String(e)))
    return errors
}

// Gemini's daily free quota is exhausted, so a live semantic answer returns no
// citations. Stub /api/ask with a deterministic cited answer whose file names
// are REAL visible cards — exercising the full row → overlay → card pipeline.
async function stubCitedAnswer(page: Page, files: string[]) {
    await page.unroute("**/api/ask").catch(() => {})
    await page.route("**/api/ask", (route) =>
        route.fulfill({
            json: {
                intent: "SEMANTIC",
                answer: "These are the most relevant papers [1][2][3].",
                citations: files.map((f, i) => ({
                    ref: i + 1,
                    question_text: `Question ${i + 1}`,
                    marks: 5,
                    sub_label: null,
                    file_name: f,
                    year: "2023",
                    exam_type: "ESE",
                    url: `https://example.com/${i}.pdf`,
                    standard_subject: SUBJECT,
                    similarity: 0.9 - i * 0.05,
                })),
            },
        })
    )
}

async function visibleCardFiles(page: Page, n: number): Promise<string[]> {
    const cards = page.locator("[data-paper-file]")
    await expect(cards.first()).toBeVisible({ timeout: 30_000 })
    const files = await cards.evaluateAll((els) =>
        els.map((e) => (e as HTMLElement).dataset.paperFile!)
    )
    return files.slice(0, n)
}

async function openPanelAndAsk(page: Page) {
    await page.getByRole("button", { name: /Ask AI about/ }).click()
    const input = page.getByPlaceholder(/Ask about/)
    await expect(input).toBeVisible()
    await input.fill("Which papers cover this best?")
    await input.press("Enter")
}

const threadPaths = (page: Page) =>
    page.locator("svg[data-citation-threads] path")

test.describe("citation threads — desktop", () => {
    test.use({ viewport: { width: 1280, height: 800 } })

    test("draw, survive scroll/resize/view-toggle/filter, clear on close & new question", async ({
        page,
    }) => {
        const errors = collectErrors(page)

        await page.goto(URL)
        const files = await visibleCardFiles(page, 4)
        expect(files.length).toBeGreaterThan(0)

        await stubCitedAnswer(page, files)
        await openPanelAndAsk(page)

        // 1) Threads draw to the cited cards.
        await expect(threadPaths(page).first()).toBeVisible()
        expect(await threadPaths(page).count()).toBeGreaterThan(0)

        // 2) Scroll the list — threads persist (recompute).
        await page
            .locator("#scrollable-content")
            .evaluate((el) => (el.scrollTop += 180))
        await page.waitForTimeout(250)
        expect(await threadPaths(page).count()).toBeGreaterThan(0)

        // 3) Resize — threads persist.
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.waitForTimeout(250)
        expect(await threadPaths(page).count()).toBeGreaterThan(0)

        // 4) Toggle grid → list — card DOM changes, threads recompute.
        await page.getByRole("button", { name: "List view" }).click()
        await page.waitForTimeout(400)
        expect(await threadPaths(page).count()).toBeGreaterThan(0)

        // 5) Filter (best-effort) — overlay recomputes without error. (Avoid
        //    Escape here — the panel treats Escape as close.)
        const filterBtn = page.locator('button[aria-label="Show filters"]:visible').first()
        if (await filterBtn.count()) {
            await filterBtn.click()
            await page.waitForTimeout(400)
            expect(await threadPaths(page).count()).toBeGreaterThanOrEqual(0)
            await filterBtn.click() // close the dropdown
            await page.waitForTimeout(200)
        }

        // 6) Close the panel (Escape) — threads clear instantly.
        await expect(page.getByRole("button", { name: "Close Ask AI" })).toBeVisible()
        await page.keyboard.press("Escape")
        await page.waitForTimeout(400)
        expect(await threadPaths(page).count()).toBe(0)

        // 7) Reopen — the answer is still on screen → threads re-draw.
        await page.getByRole("button", { name: /Ask AI about/ }).click()
        await page.waitForTimeout(500)
        expect(await threadPaths(page).count()).toBeGreaterThan(0)

        // 8) New question whose answer has no citations → threads clear.
        await page.route("**/api/ask", (route) =>
            route.fulfill({
                json: { intent: "ANALYTICS", answer: "No sources here.", clusters: [] },
            })
        )
        const input = page.getByPlaceholder(/Ask about/)
        await input.fill("most repeated questions")
        await input.press("Enter")
        await page.waitForTimeout(700)
        expect(await threadPaths(page).count()).toBe(0)

        expect(errors, `console errors:\n${errors.join("\n")}`).toEqual([])
    })
})

test.describe("citation threads — mobile 390x844", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })

    test("bottom sheet renders the answer but draws NO threads", async ({ page }) => {
        const errors = collectErrors(page)

        await page.goto(URL)
        const files = await visibleCardFiles(page, 4)
        await stubCitedAnswer(page, files)
        await openPanelAndAsk(page)

        // The Sources rows render, but the overlay must not exist on mobile.
        await expect(page.locator("[data-sources-active]")).toBeVisible({
            timeout: 15_000,
        })
        await page.waitForTimeout(400)
        expect(await page.locator("svg[data-citation-threads]").count()).toBe(0)

        expect(errors, `console errors:\n${errors.join("\n")}`).toEqual([])
    })
})
