"use client"

import {
    createContext,
    useContext,
    useState,
    useMemo,
    useCallback,
    ReactNode,
} from "react"

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
}

const AskAiContext = createContext<AskAiContextType | undefined>(undefined)

/**
 * Holds the open/closed state of the global AskAI panel plus the current
 * browsed subject. Kept separate from the panel component so any surface (the
 * floating trigger, a future header button, a deep link) can open it, and so
 * the paper-browse pages can feed the route's subject to the panel without the
 * panel reaching into routing. Mounted app-wide inside ClientProvider.
 */
export function AskAiProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false)
    const [browsedSubject, setBrowsedSubjectState] = useState<string | null>(
        null
    )

    const open = useCallback(() => setIsOpen(true), [])
    const close = useCallback(() => setIsOpen(false), [])
    const toggle = useCallback(() => setIsOpen((v) => !v), [])
    const setBrowsedSubject = useCallback(
        (subject: string | null) => setBrowsedSubjectState(subject),
        []
    )

    const value = useMemo(
        () => ({
            isOpen,
            open,
            close,
            toggle,
            browsedSubject,
            setBrowsedSubject,
        }),
        [isOpen, open, close, toggle, browsedSubject, setBrowsedSubject]
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
