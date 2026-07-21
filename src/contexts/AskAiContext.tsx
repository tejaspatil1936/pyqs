"use client"

import {
    createContext,
    useContext,
    useState,
    useMemo,
    useCallback,
    useEffect,
    ReactNode,
} from "react"

const WIDTH_KEY = "pyq.askai.width"
const DEFAULT_WIDTH = 448

/** Clamp the desktop panel width to the 35–45% band (with a small px floor). */
function clampWidth(px: number): number {
    if (typeof window === "undefined") return px
    const min = Math.max(360, Math.round(window.innerWidth * 0.35))
    const max = Math.round(window.innerWidth * 0.45)
    return Math.min(Math.max(px, min), max)
}

interface AskAiContextType {
    /** Whether the split-view AskAI panel is open. */
    isOpen: boolean
    open: () => void
    close: () => void
    toggle: () => void
    /**
     * The subject the user is currently browsing (paper-browse pages push it
     * here from the route). Null when there is no browsing context. On such
     * pages the panel binds ONLY to this — never to localStorage.
     */
    browsedSubject: string | null
    setBrowsedSubject: (subject: string | null) => void
    /** Desktop panel width in px (35–45% band), remembered across sessions. */
    panelWidth: number
    setPanelWidth: (px: number) => void
    /** True at ≥1024px — the split (and citation threads) are desktop-only. */
    isDesktop: boolean
}

const AskAiContext = createContext<AskAiContextType | undefined>(undefined)

/**
 * Holds the open/closed state of the global AskAI panel, the current browsed
 * subject, and the remembered desktop panel width. Kept separate from the panel
 * component so any surface (the floating trigger, a future header button, a deep
 * link) can open it, and so the paper-browse pages can feed the route's subject
 * to the panel without the panel reaching into routing. Mounted app-wide inside
 * ClientProvider.
 */
export function AskAiProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false)
    const [browsedSubject, setBrowsedSubjectState] = useState<string | null>(
        null
    )
    const [panelWidth, setPanelWidthState] = useState(DEFAULT_WIDTH)
    const [isDesktop, setIsDesktop] = useState(false)

    // Track the desktop breakpoint (client-only → SSR-safe, starts false).
    useEffect(() => {
        const mq = window.matchMedia("(min-width: 1024px)")
        const update = () => setIsDesktop(mq.matches)
        update()
        mq.addEventListener("change", update)
        return () => mq.removeEventListener("change", update)
    }, [])

    // Restore the remembered width on mount (client-only → SSR-safe).
    useEffect(() => {
        try {
            const saved = localStorage.getItem(WIDTH_KEY)
            const px = saved
                ? parseInt(saved, 10)
                : Math.round(window.innerWidth * 0.4)
            if (!Number.isNaN(px)) setPanelWidthState(clampWidth(px))
        } catch {
            /* ignore; keep the default */
        }
    }, [])

    const open = useCallback(() => setIsOpen(true), [])
    const close = useCallback(() => setIsOpen(false), [])
    const toggle = useCallback(() => setIsOpen((v) => !v), [])
    const setBrowsedSubject = useCallback(
        (subject: string | null) => setBrowsedSubjectState(subject),
        []
    )
    const setPanelWidth = useCallback((px: number) => {
        const w = clampWidth(px)
        setPanelWidthState(w)
        try {
            localStorage.setItem(WIDTH_KEY, String(w))
        } catch {
            /* non-fatal — width just won't persist */
        }
    }, [])

    const value = useMemo(
        () => ({
            isOpen,
            open,
            close,
            toggle,
            browsedSubject,
            setBrowsedSubject,
            panelWidth,
            setPanelWidth,
            isDesktop,
        }),
        [
            isOpen,
            open,
            close,
            toggle,
            browsedSubject,
            setBrowsedSubject,
            panelWidth,
            setPanelWidth,
            isDesktop,
        ]
    )

    return (
        <AskAiContext.Provider value={value}>{children}</AskAiContext.Provider>
    )
}

export function useAskAi() {
    const context = useContext(AskAiContext)
    if (context === undefined) {
        throw new Error("useAskAi must be used within an AskAiProvider")
    }
    return context
}
