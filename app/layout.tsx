import './globals.css'
import type { ReactNode } from 'react'
import { CLIENT_CONFIG } from '@/lib/client-config'
import ThemeWatcher from '@/components/ThemeWatcher'
import SettingsProvider from '@/components/SettingsProvider'

export default function RootLayout({ children }: { children: ReactNode }) {
  const key = CLIENT_CONFIG.themeStorageKey
  const primary = CLIENT_CONFIG.primaryColor
  const secondary = CLIENT_CONFIG.secondaryColor

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover" />
        <link rel="apple-touch-icon" href={CLIENT_CONFIG.icon192} />
        <link rel="icon" href={CLIENT_CONFIG.icon192} />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var stored = localStorage.getItem('${key}');
                var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (stored === 'dark' || (!stored && prefersDark)) {
                  document.documentElement.classList.add('dark');
                } else {
                  document.documentElement.classList.remove('dark');
                }
              } catch(e) {}
            `,
          }}
        />
      </head>
      <body
        style={{
          ['--brand-primary' as string]: primary,
          ['--brand-secondary' as string]: secondary,
        }}
      >
        <ThemeWatcher />
        <SettingsProvider>{children}</SettingsProvider>
      </body>
    </html>
  )
}
