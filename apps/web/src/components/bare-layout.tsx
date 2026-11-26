import type { ReactNode } from 'react'
import { Brand } from './icon.tsx'

export function BareLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <main className="bare">
        <div className="bare-in">
          <div className="bare-brand">
            <Brand />
          </div>
          {children}
        </div>
      </main>
    </div>
  )
}
