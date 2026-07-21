"use client"

import { useEffect, useState, ReactNode } from "react"
import { usePathname } from "next/navigation"
import { ThemeProvider } from "next-themes"
import { SettingsProvider, useSettings } from "@/contexts/SettingsContext"
import { AskAiProvider, useAskAi } from "@/contexts/AskAiContext"
import GhostCursor from "./animations/GhostCursor"
import AskAiPanel from "./assistant/AskAiPanel"
import AskAiFab from "./assistant/AskAiFab"

interface ClientProviderProps {
    children: ReactNode
    fallback?: ReactNode
}

function App({ children }: { children: ReactNode }) {
    const { cursorStyle } = useSettings()
    const { isOpen, panelWidth, isDesktop } = useAskAi()
    const pathname = usePathname()
    // /assistant is the standalone assistant page — don't stack the global
    // panel on top of it.
    const showAssistant = pathname !== "/assistant"
    // Desktop: push content left by the panel's width so it splits the
    // viewport. Mobile: the panel is a bottom sheet — no push.
    const pushed = showAssistant && isOpen && isDesktop
    return (
        <>
            <div
                className="transition-[margin] duration-300 ease-out"
                style={{ marginRight: pushed ? panelWidth : 0 }}
            >
                {children}
            </div>
            {showAssistant && (
                <>
                    <AskAiPanel />
                    <AskAiFab />
                </>
            )}
            {cursorStyle === "ghost" && <GhostCursor />}
        </>
    )
}

export default function ClientProvider({
    children,
    fallback = null,
}: ClientProviderProps) {
    const [isClient, setIsClient] = useState(false)

    useEffect(() => {
        setIsClient(true)
    }, [])

    if (!isClient) {
        return <>{fallback}</>
    }

    return (
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
            <SettingsProvider>
                <AskAiProvider>
                    <App>{children}</App>
                </AskAiProvider>
            </SettingsProvider>
        </ThemeProvider>
    )
}
