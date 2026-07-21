"use client"

import { useEffect, useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Sparkle, X } from "@phosphor-icons/react"

import type { SubjectRow } from "@/lib/rag/api-types"
import { useAskAi } from "@/contexts/AskAiContext"
import { usePapers } from "@/contexts/PaperContext"
import Chat from "./Chat"
import StatsFooter from "./StatsFooter"
import SubjectPicker from "./SubjectPicker"

const SUBJECT_KEY = "pyq.subject"

/**
 * The global split-view AskAI panel: a right-docked split on desktop (lg+,
 * paired with the content push applied in ClientProvider) and a full-screen
 * drawer on mobile.
 *
 * Subject binding follows the browsing context — the subject the user is
 * viewing on /papers or /browse (PaperContext.filters.subject) — reconciled
 * against the RAG corpus's own /api/subjects list, which stays authoritative
 * (subject isolation is a hard backend rule). Precedence: an explicit in-panel
 * pick this session > the current browsing subject > the last-used subject.
 * "Change subject" forces the picker regardless.
 */
export default function AskAiPanel() {
    const { isOpen, close } = useAskAi()
    const { filters } = usePapers()

    const [subjects, setSubjects] = useState<SubjectRow[] | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [override, setOverride] = useState<string | null>(null)
    const [lastPicked, setLastPicked] = useState<string | null>(null)
    const [picking, setPicking] = useState(false)
    const [chatEpoch, setChatEpoch] = useState(0)

    async function loadSubjects() {
        setLoadError(null)
        try {
            const res = await fetch("/api/subjects")
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const body = (await res.json()) as { subjects: SubjectRow[] }
            setSubjects(body.subjects)
        } catch {
            setLoadError(
                "Couldn't load the subject list. The database may be waking up."
            )
        }
    }

    // Restore the last-used subject once, on mount.
    useEffect(() => {
        const saved = localStorage.getItem(SUBJECT_KEY)
        if (saved) setLastPicked(saved)
    }, [])

    // Fetch the corpus subjects lazily, the first time the panel is opened.
    useEffect(() => {
        if (isOpen && subjects === null && !loadError) void loadSubjects()
    }, [isOpen, subjects, loadError])

    // Close on Escape.
    useEffect(() => {
        if (!isOpen) return
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") close()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [isOpen, close])

    // Lock body scroll while the full-screen drawer is up (mobile only).
    useEffect(() => {
        if (!isOpen) return
        if (window.matchMedia("(min-width: 1024px)").matches) return
        const prev = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => {
            document.body.style.overflow = prev
        }
    }, [isOpen])

    // The browsing subject, reconciled (case-insensitive) to a real corpus subject.
    const browsingMatch = useMemo(() => {
        const b = filters.subject?.trim().toLowerCase()
        if (!b || !subjects) return null
        return subjects.find((s) => s.subject.toLowerCase() === b)?.subject ?? null
    }, [filters.subject, subjects])

    const validatedLastPicked = useMemo(() => {
        if (!lastPicked || !subjects) return null
        return subjects.some((s) => s.subject === lastPicked) ? lastPicked : null
    }, [lastPicked, subjects])

    const effectiveSubject = picking
        ? null
        : override ?? browsingMatch ?? validatedLastPicked

    const questionCount =
        subjects?.find((s) => s.subject === effectiveSubject)?.question_count ?? null

    function pickSubject(s: string) {
        localStorage.setItem(SUBJECT_KEY, s)
        setLastPicked(s)
        setOverride(s)
        setPicking(false)
    }

    const chip =
        "rounded-lg border border-accent px-2.5 py-1 text-xs font-medium text-content/80 transition-colors hover:bg-accent"

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Scrim — mobile drawer only; desktop stays a live split. */}
                    <motion.div
                        key="askai-scrim"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={close}
                        className="fixed inset-0 z-[59] bg-black/50 lg:hidden"
                        aria-hidden="true"
                    />

                    <motion.aside
                        key="askai-panel"
                        initial={{ x: "100%" }}
                        animate={{ x: 0 }}
                        exit={{ x: "100%" }}
                        transition={{ type: "tween", duration: 0.3, ease: "easeOut" }}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Ask AI"
                        className="fixed right-0 top-0 z-[60] flex h-[100dvh] w-full flex-col border-l border-accent/60 bg-primary text-content shadow-2xl lg:w-[28rem]"
                    >
                        {/* Header bar (the panel owns the single top bar). */}
                        <div className="flex items-center gap-2 border-b border-accent/60 px-4 py-3">
                            <Sparkle
                                weight="fill"
                                className="h-5 w-5 shrink-0 text-brand"
                            />
                            <div className="min-w-0">
                                <span className="text-sm font-bold">Ask AI</span>
                                {effectiveSubject && questionCount != null && (
                                    <p className="truncate text-xs text-content/60">
                                        {effectiveSubject} ·{" "}
                                        {questionCount.toLocaleString()} questions
                                    </p>
                                )}
                            </div>
                            <div className="ml-auto flex shrink-0 items-center gap-1.5">
                                {effectiveSubject && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => setChatEpoch((e) => e + 1)}
                                            className={chip}
                                        >
                                            New chat
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPicking(true)}
                                            className={chip}
                                        >
                                            Change
                                        </button>
                                    </>
                                )}
                                <button
                                    type="button"
                                    onClick={close}
                                    aria-label="Close Ask AI"
                                    className="flex h-8 w-8 items-center justify-center rounded-lg text-content/70 transition-colors hover:bg-accent hover:text-content"
                                >
                                    <X weight="bold" className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="flex min-h-0 flex-1 flex-col">
                            {loadError ? (
                                <div className="px-4 py-6">
                                    <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-center text-sm text-red-600 dark:text-red-300">
                                        <p>{loadError}</p>
                                        <button
                                            type="button"
                                            onClick={() => void loadSubjects()}
                                            className="mt-3 rounded-lg bg-red-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
                                        >
                                            Retry
                                        </button>
                                    </div>
                                </div>
                            ) : !subjects ? (
                                <div
                                    className="space-y-2 px-4 py-4"
                                    aria-live="polite"
                                    aria-busy="true"
                                >
                                    <div className="h-12 animate-pulse rounded-xl bg-accent" />
                                    {[...Array(6)].map((_, i) => (
                                        <div
                                            key={i}
                                            className="h-12 animate-pulse rounded-xl bg-content/5"
                                        />
                                    ))}
                                </div>
                            ) : effectiveSubject ? (
                                <Chat
                                    key={chatEpoch}
                                    embedded
                                    subject={effectiveSubject}
                                    questionCount={questionCount}
                                    onChangeSubject={() => setPicking(true)}
                                />
                            ) : (
                                <div className="flex-1 overflow-y-auto px-4 py-4">
                                    <p className="mb-3 text-sm text-content/70">
                                        {filters.subject && !browsingMatch
                                            ? `No archived questions for “${filters.subject}” yet — pick a subject to ask about:`
                                            : "Pick a subject to ask about its previous-year papers:"}
                                    </p>
                                    <SubjectPicker
                                        subjects={subjects}
                                        onSelect={pickSubject}
                                    />
                                    <StatsFooter />
                                </div>
                            )}
                        </div>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    )
}
