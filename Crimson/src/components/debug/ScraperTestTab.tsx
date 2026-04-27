import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { RuneBuild } from '../../types'
import { useLCU } from '../../contexts/LCUContext'

const ROLES = ['top', 'jungle', 'mid', 'adc', 'support']

const RUNE_ICONS: Record<number, string> = {
    // Precision
    8000: '🎯', 8005: '⚡', 8008: '🩸', 8021: '🌊', 8010: '🦾',
    8009: '🔮', 9101: '🪚', 9111: '🔧', 8014: '⚔️', 8017: '🏇', 8299: '🦅',
    // Domination
    8100: '☠️', 8112: '🗡️', 8124: '🌑', 8128: '🩸', 9923: '☠️',
    8126: '🪤', 8139: '🌒', 8143: '🕷️', 8136: '🔱', 8120: '👁️', 8138: '📿',
    // Sorcery
    8200: '🔷', 8214: '💥', 8229: '⚡', 8230: '🌩️', 8224: '🌀', 8226: '💧',
    8275: '🌊', 8210: '🧊', 8234: '✨', 8233: '💫', 8237: '🌟', 8232: '🌸',
    // Resolve
    8400: '🛡️', 8437: '🪨', 8439: '🌿', 8465: '🌊', 8242: '⚓', 8446: '🛡️',
    8444: '🍀', 8473: '🔮', 8451: '💪', 8453: '🧸', 8463: '🔒', 8401: '💊',
    // Inspiration
    8300: '🎮', 8351: '🤖', 8360: '💡', 8369: '📚', 8306: '⏰', 8304: '🃏',
    8313: '🛒', 8321: '🎰', 8316: '💰', 8345: '🎱', 8347: '💚',
    // Shards
    5008: '💫', 5005: '⚡', 5002: '🛡️', 5003: '✨', 5001: '❤️',
}

export default function ScraperTestTab() {
    const { runesData } = useLCU();
    const [champion, setChampion] = useState('Akali')
    const [role, setRole] = useState('mid')
    const [opponent, setOpponent] = useState('')
    const [builds, setBuilds] = useState<RuneBuild[]>([])
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [log, setLog] = useState<string[]>([])

    const addLog = (msg: string) => setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])

    const runFetch = async () => {
        setLoading(true)
        setError(null)
        setBuilds([])
        setLog([])
        addLog(`🚀 Fetching builds for ${champion} [${role}]...`)

        try {
            const result = await invoke<RuneBuild[]>('fetch_dynamic_runes', {
                championName: champion,
                role: role,
                opponent: opponent || null,
            })
            addLog(`✅ Got ${result.length} build(s) back from backend`)
            const isFallback = result.some(b => b.name.includes('Secours') || b.name.includes('Fallback'))
            if (isFallback) {
                addLog('⚠️  ALERTE : Gemini a échoué, affichage des builds de secours (presets)')
            } else {
                addLog('🎉 Succès : Builds générés par l\'IA Gemini !')
            }
            setBuilds(result)
        } catch (e: any) {
            const msg = String(e)
            setError(msg)
            addLog(`❌ Error: ${msg}`)
        } finally {
            setLoading(false)
        }
    }

    const getRuneName = (id: number): string => {
        const flat = runesData.flatMap((style: any) => [
            style,
            ...(style.slots?.flatMap((s: any) => s.runes) || [])
        ])
        const found = flat.find((r: any) => r.id === id)
        return found?.name || `ID ${id}`
    }

    return (
        <div className="flex flex-col gap-6 p-6 h-full overflow-y-auto">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="w-2 h-8 bg-red-500 rounded-full" />
                <div>
                    <h2 className="text-lg font-bold text-white tracking-widest uppercase">Scraper Debug</h2>
                    <p className="text-xs text-neutral-500">Test OP.GG / U.GG build fetching in real time</p>
                </div>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap gap-3 items-end">
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-neutral-400 uppercase tracking-widest">Nom du champion</label>
                    <input
                        className="bg-neutral-900 border border-white/10 rounded-lg px-4 py-2 text-sm text-white w-48 focus:outline-none focus:border-red-500/60 transition-colors"
                        value={champion}
                        onChange={e => setChampion(e.target.value)}
                        placeholder="ex: Akali, Ezreal..."
                    />
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-neutral-400 uppercase tracking-widest">Rôle</label>
                    <select
                        className="bg-neutral-900 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-red-500/60 transition-colors"
                        value={role}
                        onChange={e => setRole(e.target.value)}
                    >
                        {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                    </select>
                </div>
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-neutral-400 uppercase tracking-widest">Opposant (Optionnel)</label>
                    <input
                        className="bg-neutral-900 border border-white/10 rounded-lg px-4 py-2 text-sm text-white w-40 focus:outline-none focus:border-red-500/60 transition-colors"
                        value={opponent}
                        onChange={e => setOpponent(e.target.value)}
                        placeholder="ex: Zed, Kassadin..."
                    />
                </div>
                <button
                    onClick={runFetch}
                    disabled={loading || !champion}
                    className="flex items-center gap-2 px-6 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm font-semibold uppercase tracking-widest transition-all active:scale-95"
                >
                    {loading ? (
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                    ) : '⚡'}
                    {loading ? 'Fetching...' : 'Tester'}
                </button>
            </div>

            {/* Log & Results in 2-col layout */}
            <div className="flex gap-4 flex-1 min-h-0">
                {/* Log panel */}
                <div className="w-72 shrink-0 flex flex-col gap-2">
                    <div className="text-xs text-neutral-500 uppercase tracking-widest font-semibold">Console</div>
                    <div className="flex-1 bg-black/40 border border-white/5 rounded-xl p-3 font-mono text-xs text-neutral-400 overflow-y-auto min-h-[200px] space-y-1">
                        {log.length === 0 && <span className="text-neutral-600">Appuie sur Tester pour lancer...</span>}
                        {log.map((l, i) => (
                            <div key={i} className={
                                l.includes('❌') ? 'text-red-400' :
                                l.includes('✅') || l.includes('🎉') ? 'text-green-400' :
                                l.includes('⚠️') ? 'text-amber-400' :
                                'text-neutral-400'
                            }>{l}</div>
                        ))}
                    </div>
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-xs text-red-300">
                            {error}
                        </div>
                    )}
                </div>

                {/* Builds display */}
                <div className="flex-1 overflow-y-auto">
                    {builds.length === 0 && !loading && (
                        <div className="flex flex-col items-center justify-center h-40 text-neutral-600 text-sm">
                            <span className="text-4xl mb-3">🎯</span>
                            <span>Aucun build à afficher</span>
                        </div>
                    )}
                    <div className="grid grid-cols-1 gap-4">
                        {builds.map((build, i) => (
                            <BuildCard key={i} build={build} index={i} getRuneName={getRuneName} />
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}

function BuildCard({ build, index, getRuneName }: { build: RuneBuild; index: number; getRuneName: (id: number) => string }) {
    const isFallback = build.name.includes('Secours')
    return (
        <div className={`border rounded-xl p-4 ${isFallback ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/8 bg-white/3'}`}>
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-neutral-500">#{index + 1}</span>
                    <span className="text-sm font-bold text-white">{build.name}</span>
                    {isFallback && <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">⚠ Fallback</span>}
                </div>
                <div className="flex items-center gap-3 text-xs text-neutral-500">
                    {build.winrate !== 'N/A' && <span className="text-green-400">{build.winrate}</span>}
                    <span>Style: <span className="text-white/60">{build.primaryStyleId}</span></span>
                    <span>Sub: <span className="text-white/60">{build.subStyleId}</span></span>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                    <div className="text-neutral-600 uppercase tracking-widest mb-2 text-[10px]">Runes ({build.perkIds.length})</div>
                    <div className="flex flex-wrap gap-2">
                        {build.perkIds.map((id, j) => (
                            <div key={j} title={getRuneName(id)} className="flex items-center gap-1 bg-white/5 rounded-lg px-2 py-1">
                                <span>{RUNE_ICONS[id] || '⬛'}</span>
                                <span className="text-neutral-400">{id}</span>
                                <span className="text-neutral-600 text-[10px] max-w-[60px] truncate">{getRuneName(id)}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="space-y-3">
                    <div>
                        <div className="text-neutral-600 uppercase tracking-widest mb-2 text-[10px]">Shards ({build.shards.length})</div>
                        <div className="flex gap-2">
                            {build.shards.map((id, j) => (
                                <div key={j} className="bg-white/5 rounded-lg px-2 py-1 text-neutral-400">{RUNE_ICONS[id] || '⬛'} {id}</div>
                            ))}
                        </div>
                    </div>
                    <div>
                        <div className="text-neutral-600 uppercase tracking-widest mb-2 text-[10px]">Sorts</div>
                        <div className="flex gap-2">
                            {build.spells.map((id, j) => (
                                <div key={j} className="bg-red-500/10 border border-red-500/20 rounded-lg px-2 py-1 text-red-300">{id}</div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
