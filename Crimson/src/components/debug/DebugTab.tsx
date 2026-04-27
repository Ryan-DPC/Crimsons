import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import ScraperTestTab from './ScraperTestTab';

const DebugTab = () => {
    const [diagOutput, setDiagOutput] = useState<string>('');
    const [loading, setLoading] = useState(false);

    const runDiag = async () => {
        setLoading(true);
        try {
            const result = await invoke<string>('debug_lcu');
            setDiagOutput(result);
        } catch (e) {
            setDiagOutput(`Error: ${e}`);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* LCU Diagnostics */}
            <div className="bg-[#111115] border border-white/5 p-6 rounded-2xl">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-black text-white uppercase tracking-widest">🔍 LCU Diagnostics</h3>
                    <button
                        onClick={runDiag}
                        disabled={loading}
                        className="px-4 py-2 text-[10px] font-black uppercase tracking-widest bg-red-600/20 hover:bg-red-600/40 border border-red-500/30 text-red-400 rounded-lg transition-all"
                    >
                        {loading ? 'Running...' : 'Run Diagnostic'}
                    </button>
                </div>
                {diagOutput && (
                    <pre className="text-[10px] font-mono text-white/60 bg-black/40 p-4 rounded-xl overflow-auto max-h-64 whitespace-pre-wrap leading-relaxed">
                        {diagOutput}
                    </pre>
                )}
                {!diagOutput && (
                    <p className="text-white/20 text-[10px] uppercase tracking-widest">Cliquez sur "Run Diagnostic" pour voir pourquoi le LCU n'est pas détecté.</p>
                )}
            </div>

            {/* Scraper Tests */}
            <ScraperTestTab />
        </div>
    );
};

export default DebugTab;
