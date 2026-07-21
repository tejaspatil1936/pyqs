"use client"

import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { useAskAi } from "@/contexts/AskAiContext"

/**
 * Honest citation threads: while a cited answer is on screen, draw subtle
 * connector lines from the panel's active Source rows to the matching paper
 * cards in the left list. A thread means "this answer used this paper" — it
 * exists only when both ends are present.
 *
 * One full-viewport SVG overlay (pointer-events:none, aria-hidden, z-40 — above
 * content, below the panel/modals). Anchors recompute via rAF-batched passive
 * scroll/resize listeners + ResizeObserver (list & panel) + MutationObserver
 * (card set on filter/view/search, and the active answer changing). Desktop
 * only; hidden while any preview modal is open. Client-only → SSR-safe.
 */

interface Thread {
    file: string
    d: string
    faded: boolean // clamped to the list edge (cited card scrolled off)
}

const MAX_THREADS = 8
const SCROLL_ID = "scrollable-content"

/** Gentle horizontal S-curve from a panel row (right) to a card (left). */
function bezier(sx: number, sy: number, ex: number, ey: number): string {
    const pull = Math.max(40, Math.abs(sx - ex) * 0.4)
    return `M ${sx} ${sy} C ${sx - pull} ${sy}, ${ex + pull} ${ey}, ${ex} ${ey}`
}

export default function CitationThreads() {
    const { isOpen, isDesktop } = useAskAi()
    const [mounted, setMounted] = useState(false)
    const [threads, setThreads] = useState<Thread[]>([])
    const [hoveredFile, setHoveredFile] = useState<string | null>(null)
    const [reduced, setReduced] = useState(false)
    const rafRef = useRef<number | null>(null)

    useEffect(() => setMounted(true), [])

    useEffect(() => {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
        const u = () => setReduced(mq.matches)
        u()
        mq.addEventListener("change", u)
        return () => mq.removeEventListener("change", u)
    }, [])

    // Reflect the hovered/focused file onto its row + card (border emphasis via
    // globals.css). Kept as an effect so the DOM write stays a pure reaction.
    useEffect(() => {
        document
            .querySelectorAll("[data-thread-emph]")
            .forEach((el) => el.removeAttribute("data-thread-emph"))
        if (!hoveredFile) return
        document
            .querySelectorAll<HTMLElement>("[data-source-file],[data-paper-file]")
            .forEach((el) => {
                const f = el.dataset.sourceFile ?? el.dataset.paperFile
                if (f === hoveredFile) el.setAttribute("data-thread-emph", "1")
            })
    }, [hoveredFile])

    useEffect(() => {
        if (!mounted) return
        if (!isOpen || !isDesktop) {
            setThreads([])
            return
        }

        const compute = () => {
            rafRef.current = null
            // Any preview/overlay up → no threads poking out around it.
            if (document.querySelector("[data-pdf-modal]")) {
                setThreads([])
                return
            }
            const rows = Array.from(
                document.querySelectorAll<HTMLElement>(
                    "[data-sources-active] [data-source-file]"
                )
            )
            if (rows.length === 0) {
                setThreads([])
                return
            }

            // First card per file (duplicate uploads collapse to the first).
            const cardByFile = new Map<string, HTMLElement>()
            document
                .querySelectorAll<HTMLElement>("[data-paper-file]")
                .forEach((el) => {
                    const f = el.dataset.paperFile
                    if (f && !cardByFile.has(f)) cardByFile.set(f, el)
                })

            const scroller = document.getElementById(SCROLL_ID)
            const listRect = scroller?.getBoundingClientRect()
            const out: Thread[] = []
            const seen = new Set<string>()

            for (const row of rows) {
                if (out.length >= MAX_THREADS) break
                const file = row.dataset.sourceFile
                if (!file || seen.has(file)) continue
                const card = cardByFile.get(file)
                if (!card) continue // cited paper not in the current view → no thread
                seen.add(file)

                const r = row.getBoundingClientRect()
                const c = card.getBoundingClientRect()
                const sx = r.left
                const sy = r.top + r.height / 2
                const ex = c.right
                let ey = c.top + c.height / 2
                let faded = false
                if (listRect) {
                    const top = listRect.top + 4
                    const bot = listRect.bottom - 4
                    if (ey < top) {
                        ey = top
                        faded = true
                    } else if (ey > bot) {
                        ey = bot
                        faded = true
                    }
                }
                out.push({ file, d: bezier(sx, sy, ex, ey), faded })
            }
            setThreads(out)
        }

        const schedule = () => {
            if (rafRef.current == null)
                rafRef.current = requestAnimationFrame(compute)
        }

        schedule()

        window.addEventListener("scroll", schedule, {
            passive: true,
            capture: true,
        })
        window.addEventListener("resize", schedule, { passive: true })

        const ro = new ResizeObserver(schedule)
        const list = document.querySelector("[data-papers-list]")
        const panel = document.querySelector("[data-askai-panel]")
        const scroller = document.getElementById(SCROLL_ID)
        if (list) ro.observe(list)
        if (panel) ro.observe(panel)
        if (scroller) ro.observe(scroller)

        // Card set changes (filter/search/view toggle) + the active answer moving.
        const mo = new MutationObserver(schedule)
        if (list)
            mo.observe(list, { childList: true, subtree: true, attributes: true })
        if (panel)
            mo.observe(panel, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ["data-sources-active"],
            })
        // Modal mount/unmount lives at the body level.
        const bodyMo = new MutationObserver(schedule)
        bodyMo.observe(document.body, { childList: true })

        // Hover / keyboard-focus sync — emphasise the thread and both ends.
        const onEnter = (e: Event) => {
            const el = (e.target as HTMLElement)?.closest?.(
                "[data-source-file],[data-paper-file]"
            ) as HTMLElement | null
            if (!el) return
            setHoveredFile(el.dataset.sourceFile ?? el.dataset.paperFile ?? null)
        }
        const onLeave = (e: Event) => {
            const related = (e as PointerEvent).relatedTarget as HTMLElement | null
            if (related?.closest?.("[data-source-file],[data-paper-file]")) return
            setHoveredFile(null)
        }
        document.addEventListener("pointerover", onEnter)
        document.addEventListener("pointerout", onLeave)
        document.addEventListener("focusin", onEnter)
        document.addEventListener("focusout", onLeave)

        return () => {
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
            window.removeEventListener("scroll", schedule, {
                capture: true,
            } as EventListenerOptions)
            window.removeEventListener("resize", schedule)
            ro.disconnect()
            mo.disconnect()
            bodyMo.disconnect()
            document.removeEventListener("pointerover", onEnter)
            document.removeEventListener("pointerout", onLeave)
            document.removeEventListener("focusin", onEnter)
            document.removeEventListener("focusout", onLeave)
            setHoveredFile(null)
        }
    }, [mounted, isOpen, isDesktop])

    if (!mounted || !isOpen || !isDesktop || threads.length === 0) return null

    return (
        <svg
            className="pointer-events-none fixed inset-0 z-40 h-full w-full"
            aria-hidden="true"
            data-citation-threads=""
        >
            {threads.map((t) => {
                const emph = hoveredFile === t.file
                const opacity = emph ? 0.7 : t.faded ? 0.12 : 0.35
                const strokeWidth = emph ? 2 : 1.25
                // stroke via CSS `style` so the --brand token resolves (var()
                // does not resolve in an SVG presentation attribute).
                if (reduced) {
                    return (
                        <path
                            key={t.file}
                            d={t.d}
                            fill="none"
                            style={{ stroke: "hsl(var(--brand))" }}
                            opacity={opacity}
                            strokeWidth={strokeWidth}
                            strokeLinecap="round"
                        />
                    )
                }
                return (
                    <motion.path
                        key={t.file}
                        d={t.d}
                        fill="none"
                        style={{ stroke: "hsl(var(--brand))" }}
                        strokeWidth={strokeWidth}
                        strokeLinecap="round"
                        initial={{ pathLength: 0, opacity: 0 }}
                        animate={{ pathLength: 1, opacity }}
                        transition={{
                            pathLength: { duration: 0.5, ease: "easeOut" },
                            opacity: { duration: 0.25 },
                        }}
                    />
                )
            })}
        </svg>
    )
}
