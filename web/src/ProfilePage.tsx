import { useState, useEffect } from 'react'
import type { FreeAppStore, User } from '@freeappstore/sdk'
import { Card } from '@freeappstore/sdk/ui'
import { storageGet } from './safe-storage'

interface KeyInfo {
  provider: string
  label: string | null
  createdAt: number
  lastUsedAt: number | null
}

const AI_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', desc: 'Powers the translation layer (Claude Haiku)' },
  { id: 'openai', name: 'OpenAI', desc: 'Alternative AI provider' },
  { id: 'google', name: 'Google AI', desc: 'Gemini models' },
]

function formatDate(ts: number | null): string {
  if (!ts) return 'Never'
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function ApiKeysSection({ app, keys, loadingKeys }: { app: FreeAppStore; keys: KeyInfo[]; loadingKeys: boolean }) {
  const hasKey = (provider: string) => keys.some((k) => k.provider === provider)

  return (
    <div>
      <h2 className="text-sm font-semibold text-[var(--ink)] mb-3">API Keys</h2>
      <p className="text-xs text-[var(--muted)] mb-3">
        Your keys are encrypted and stored on the FreeAppStore platform. They're injected server-side — the app never sees your raw key.
      </p>
      <div className="space-y-2">
        {AI_PROVIDERS.map((p) => {
          const configured = hasKey(p.id)
          const keyInfo = keys.find((k) => k.provider === p.id)
          return (
            <Card key={p.id}>
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${configured ? 'bg-emerald-500' : 'bg-[var(--muted)] opacity-40'}`} />
                    <span className="text-sm font-medium text-[var(--ink)]">{p.name}</span>
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-0.5 ml-4">{p.desc}</p>
                  {keyInfo && (
                    <p className="text-[10px] text-[var(--muted)] mt-1 ml-4">
                      Added {formatDate(keyInfo.createdAt)} · Last used {formatDate(keyInfo.lastUsedAt)}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => app.keys.manage(p.id)}
                  className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--bg)] transition-colors"
                >
                  {configured ? 'Manage' : 'Add key'}
                </button>
              </div>
            </Card>
          )
        })}
        {loadingKeys && (
          <p className="text-xs text-[var(--muted)] text-center py-2">Loading keys...</p>
        )}
      </div>
    </div>
  )
}

function PreferencesSection({ prefs, onSavePrefs }: {
  prefs: { autoTranslate: boolean; translateDebounce: number }
  onSavePrefs: (update: Partial<{ autoTranslate: boolean; translateDebounce: number }>) => void
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold text-[var(--ink)] mb-3">Preferences</h2>
      <div className="space-y-2">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-[var(--ink)]">Auto-translate</div>
              <p className="text-xs text-[var(--muted)]">Automatically summarize new terminal output</p>
            </div>
            <button
              onClick={() => onSavePrefs({ autoTranslate: !prefs.autoTranslate })}
              className={`relative w-10 h-5 rounded-full transition-colors ${prefs.autoTranslate ? 'bg-emerald-500' : 'bg-[var(--muted)] opacity-40'}`}
            >
              <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${prefs.autoTranslate ? 'translate-x-5' : ''}`} />
            </button>
          </div>
        </Card>

        <Card>
          <div>
            <div className="text-sm text-[var(--ink)] mb-2">Translation delay</div>
            <p className="text-xs text-[var(--muted)] mb-2">Seconds to wait after new output before translating</p>
            <div className="flex items-center gap-3">
              {[1, 3, 5, 10].map((s) => (
                <button
                  key={s}
                  onClick={() => onSavePrefs({ translateDebounce: s })}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                    prefs.translateDebounce === s
                      ? 'bg-[var(--accent)] text-white'
                      : 'border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--bg)]'
                  }`}
                >
                  {s}s
                </button>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

interface ProfilePageProps {
  app: FreeAppStore
  user: User
  onBack: () => void
}

export function ProfilePage({ app, user, onBack }: ProfilePageProps) {
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const [loadingKeys, setLoadingKeys] = useState(true)
  const [prefs, setPrefs] = useState({ autoTranslate: true, translateDebounce: 3 })

  useEffect(() => {
    app.keys.status()
      .then((k) => setKeys(k))
      .catch(console.error)
      .finally(() => setLoadingKeys(false))
  }, [app])

  useEffect(() => {
    app.kv.get<typeof prefs>('prefs').then((p) => {
      if (p) setPrefs(p)
    }).catch(console.error)
  }, [app])

  const savePrefs = (update: Partial<typeof prefs>) => {
    const next = { ...prefs, ...update }
    setPrefs(next)
    app.kv.set('prefs', next).catch(console.error)
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2 sticky top-0 z-50">
        <button
          onClick={onBack}
          className="rounded px-2 py-0.5 text-sm text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--bg)] transition-colors"
        >
          ← Back
        </button>
        <span className="text-sm font-semibold text-[var(--ink)]">Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto p-4 space-y-6">
          <Card>
            <div className="flex items-center gap-4">
              {user.avatarUrl && (
                <img src={user.avatarUrl} alt={user.login} className="w-14 h-14 rounded-full" />
              )}
              <div>
                <div className="text-lg font-semibold text-[var(--ink)]">{user.login}</div>
                <div className="text-sm text-[var(--muted)]">Signed in via GitHub</div>
              </div>
            </div>
          </Card>

          <ApiKeysSection app={app} keys={keys} loadingKeys={loadingKeys} />
          <PreferencesSection prefs={prefs} onSavePrefs={savePrefs} />

          <div>
            <h2 className="text-sm font-semibold text-[var(--ink)] mb-3">Session</h2>
            <Card>
              <div>
                <div className="text-sm text-[var(--ink)]">Current session ID</div>
                <p className="text-sm font-mono text-[var(--muted)] mt-1">
                  {storageGet('ac:session') || 'Not connected'}
                </p>
              </div>
            </Card>
          </div>

          <button
            onClick={() => app.auth.signOut()}
            className="w-full rounded-lg border border-red-200 dark:border-red-900 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
          >
            Sign out
          </button>

          <div className="h-8" />
        </div>
      </div>
    </div>
  )
}
