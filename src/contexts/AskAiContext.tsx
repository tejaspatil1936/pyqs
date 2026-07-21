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
}

const AskAiContext = createContext<AskAiContextType | undefined>(undefined)

/**
 * Holds the open/closed state of the global AskAI panel. Kept separate from
 * the panel component so any surface (the floating trigger, a future header
 * button, a deep link) can open it, and the trigger + panel share one source
 * of truth. Mounted app-wide inside ClientProvider.
 */
export function AskAiProvider({ children }: { children: ReactNode }) {
    const [isOpen, setIsOpen] = useState(false)

    const open = useCallback(() => setIsOpen(true), [])
    const close = useCallback(() => setIsOpen(false), [])
    const toggle = useCallback(() => setIsOpen((v) => !v), [])

    const value = useMemo(
        () => ({ isOpen, open, close, toggle }),
        [isOpen, open, close, toggle]
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
