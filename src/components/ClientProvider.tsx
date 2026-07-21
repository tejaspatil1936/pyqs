"use client"

import { useEffect, useState, ReactNode } from "react"
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
    const { isOpen } = useAskAi()
    return (
        <>
            {/* Desktop: content is pushed left so the AskAI panel splits the
                viewport. Mobile: the panel is a full-screen drawer, no push. */}
            <div
                className={`transition-[margin] duration-300 ease-out ${
                    isOpen ? "lg:mr-[28rem]" : ""
                }`}
            >
                {children}
            </div>
            <AskAiPanel />
            <AskAiFab />
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
