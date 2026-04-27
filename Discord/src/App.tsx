import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'

import type { Summoner, Match, RuneBuild, RadarResult } from './types'

// Components
import Header from './components/common/Header'
import HomeTab from './components/home/HomeTab'
import LobbyTab from './components/lobby/LobbyTab'
import HistoryTab from './components/history/HistoryTab'

// Utils
import { getChampName } from './utils/lolDisplay'

const ROLE_TRANSLATE: Record<string, string> = {
    'top': 'Haut',
    'jungle': 'Jungle',
    'middle': 'Milieu',
    'bottom': 'Bas',
    'utility': 'Support',
    '': 'Remplissage'
};

function App() {
    const [sum, setSum] = useState<Summoner | null>(null);
    const [data, setData] = useState<any>(null);

    const [lobbyMyTeam, setLobbyMyTeam] = useState<any[]>([]);
    const [lobbyTheirTeam, setLobbyTheirTeam] = useState<any[]>([]);
    const [lobbyState, setLobbyState] = useState<any>(null);
    const [forceMockLobby, setForceMockLobby] = useState(false);
    const [radar, setRadar] = useState<RadarResult[]>([]);

    const [tab, setTab] = useState('lobby');
    const [hist, setHist] = useState<Match[]>([]);

    const [champs, setChamps] = useState<any[]>([]);
    const [runesData, setRunesData] = useState<any[]>([]);
    const [v, setV] = useState('15.5.1');
    const [myChamp, setMyChamp] = useState<number>(0);
    const [isImporting, setIsImporting] = useState<number | null>(null);
    const [currentLp, setCurrentLp] = useState<number | null>(null);
    const [searchChamp, setSearchChamp] = useState('');

    useEffect(() => {
        if (forceMockLobby) {
            setRadar([
                { puuid: 'test-1', winrate: 30, games: 10, isTilt: true, isSmurf: false, isTroll: false, lastResults: [false] },
                { puuid: 'test-2', winrate: 55, games: 10, isTilt: false, isSmurf: false, isTroll: false, lastResults: [true] },
                { puuid: 'test-4', winrate: 80, games: 10, isTilt: false, isSmurf: true, isTroll: false, lastResults: [true] },
                { puuid: 'test-5', winrate: 45, games: 10, isTilt: false, isSmurf: false, isTroll: false, lastResults: [false] }
            ]);
        } else {
            setRadar([]);
        }
    }, [forceMockLobby]);

    const lastPhase = useRef<string>('');
    const scannedLobbyId = useRef<string>('');
    const knownNames = useRef<Record<string, string>>({});

    const fetchAllyRadar = async (team: any[], currentLobbyId: string) => {
        if (scannedLobbyId.current === currentLobbyId) return;
        scannedLobbyId.current = currentLobbyId;
        
        const radarResults: RadarResult[] = [];
        
        for (const p of team) {
            if (!p.puuid || p.cellId === lobbyState?.localPlayerCellId) continue;
            try {
                const hStr = await invoke<string>('lcu_request', { method: 'GET', endpoint: `/lol-match-history/v1/products/lol/${p.puuid}/matches?begIndex=0&endIndex=20`, body: null });
                if (!hStr) continue;
                const h = JSON.parse(hStr);
                const games = h?.games?.games || (Array.isArray(h) ? h : []);
                if (games.length > 0) {
                    let wins = 0;
                    let validGames = 0;
                    let lastResults: boolean[] = [];

                    games.slice(0, 10).forEach((g: any) => {
                        const isRemake = g.gameDuration < 300 || g.gameDuration === 0 || g.endOfGameResult === 'Abort_Unexpected';
                        if (!isRemake) {
                            validGames++;
                            const isWin = g.participants?.[0]?.stats?.win ?? g.stats?.win ?? false;
                            if (isWin) wins++;
                            lastResults.push(isWin);
                        }
                    });
                    
                    const winrate = validGames > 0 ? Math.round((wins / validGames) * 100) : null;
                    const lossStreak = lastResults.indexOf(true) === -1 ? lastResults.length : lastResults.indexOf(true);
                    const winStreak = lastResults.indexOf(false) === -1 ? lastResults.length : lastResults.indexOf(false);

                    const isTrollPick = (p.assignedPosition === 'JUNGLE' && (p.championId === 350 || p.championId === 16)) ||
                                       (p.assignedPosition === 'TOP' && p.championId === 350);

                    radarResults.push({
                        puuid: p.puuid,
                        winrate,
                        games: validGames,
                        isTilt: lossStreak >= 3 || (winrate !== null && winrate < 40),
                        isSmurf: winStreak >= 5 || (winrate !== null && winrate > 70),
                        isTroll: isTrollPick,
                        lastResults
                    });
                }
            } catch { }
        }
        setRadar(radarResults);
    };

    const fetchHistory = async (accountId: number, puuid: string) => {
        let found = false;
        const endpoints = [
            `/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=10`,
            `/lol-match-history/v3/matchlist/account/${accountId}?begIndex=0&endIndex=10`,
            `/lol-match-history/v1/recent-matches`
        ];
        for (const ep of endpoints) {
            if (found) break;
            try {
                const hStr = await invoke<string>('lcu_request', { method: 'GET', endpoint: ep, body: null });
                if (!hStr) continue;
                const h = JSON.parse(hStr);
                const games = h?.games?.games || (Array.isArray(h) ? h : []);
                
                if (games.length > 0) {
                    const latestHist = games.slice(0, 10).map((g: any) => ({
                        gameId: g.gameId,
                        gameCreation: g.gameCreation,
                        championId: g.participants?.[0]?.championId || g.championId,
                        stats: g.participants?.[0]?.stats || g.stats,
                        gameQueueId: g.gameQueueId,
                        gameDuration: g.gameDuration
                    }));
                    setHist(latestHist); 
                    found = true;

                    latestHist.forEach((m: any) => {
                        invoke('insert_match', { m: {
                            game_id: m.gameId,
                            timestamp: m.gameCreation || 0,
                            champion_id: m.championId,
                            kills: m.stats?.kills || 0,
                            deaths: m.stats?.deaths || 0,
                            assists: m.stats?.assists || 0,
                            win: m.stats?.win || false,
                            queue_id: m.gameQueueId || 0,
                            game_duration: m.gameDuration || 0
                        }});
                    });

                    const d = await invoke<any>('get_app_data');
                    d.hist = latestHist;
                    await invoke('set_app_data', { data: d });
                    setData(d);
                }
            } catch {}
        }

        try {
            const allMatches = await invoke<any[]>('get_all_matches');
            if (allMatches && allMatches.length > 0) {
                setHist(allMatches.map(m => ({
                    gameId: m.game_id,
                    gameCreation: m.timestamp,
                    championId: m.champion_id,
                    stats: { kills: m.kills, deaths: m.deaths, assists: m.assists, win: m.win },
                    gameQueueId: m.queue_id,
                    gameDuration: m.game_duration
                })));
            }
        } catch {}
    };

    const fastPoll = async () => {
        try {
            const info = await invoke<any>('get_lcu_info');
            if (!info) {
                setSum(null); setLobbyState(null);
                setLobbyMyTeam([]); setLobbyTheirTeam([]); setMyChamp(0); setRadar([]);
                scannedLobbyId.current = '';
                return;
            }

            const appData = await invoke<any>('get_app_data');
            if (appData && appData.auto_accept === undefined) appData.auto_accept = true;
            setData(appData);

            if (!sum || !sum.puuid) {
                try {
                    const sStr = await invoke<string>('lcu_request', { method: 'GET', endpoint: '/lol-summoner/v1/current-summoner', body: null });
                    const s = JSON.parse(sStr);
                    if (s && s.puuid) {
                        setSum(s);
                        fetchHistory(s.accountId, s.puuid);
                    }
                } catch { }
            }

            let currentPhase = '';
            try {
                const gfStr = await invoke<string>('lcu_request', { method: 'GET', endpoint: '/lol-gameflow/v1/session', body: null });
                const gf = JSON.parse(gfStr);
                currentPhase = gf?.phase || '';

                if (currentPhase === 'ReadyCheck' && appData?.auto_accept) {
                    await invoke('lcu_request', { method: 'POST', endpoint: '/lol-matchmaking/v1/ready-check/accept', body: null });
                }
            } catch { }

            try {
                const rStr = await invoke<string>('lcu_request', { method: 'GET', endpoint: '/lol-ranked/v1/current-ranked-stats', body: null });
                const r = JSON.parse(rStr);
                const rankedData = r?.queues?.find((q: any) => q.queueType === 'RANKED_SOLO_5x5');
                if (rankedData) setCurrentLp(rankedData.leaguePoints);
            } catch { }

            if (lastPhase.current === 'InProgress' && currentPhase && currentPhase !== 'InProgress') {
                if (sum?.puuid) fetchHistory(sum.accountId, sum.puuid);
                setTimeout(async () => {
                    try {
                        const rStr = await invoke<string>('lcu_request', { method: 'GET', endpoint: '/lol-ranked/v1/current-ranked-stats', body: null });
                        const r = JSON.parse(rStr);
                        const newRanked = r?.queues?.find((q: any) => q.queueType === 'RANKED_SOLO_5x5');
                        if (newRanked && currentLp !== null) {
                            const lpDelta = newRanked.leaguePoints - currentLp;
                            const d = await invoke<any>('get_app_data');
                            d.lastLpDelta = lpDelta;
                            await invoke('set_app_data', { data: d });
                            setData(d);
                        }
                    } catch { }
                }, 5000);
            }
            lastPhase.current = currentPhase;

            if (currentPhase === 'ChampSelect') {
                try {
                    const csStr = await invoke<string>('lcu_request', { method: 'GET', endpoint: '/lol-champ-select/v1/session', body: null });
                    const cs = JSON.parse(csStr);
                    setLobbyState(cs);

                    if (cs?.actions && appData) {
                        const myActions = cs.actions.flat().filter((a: any) => a.actorCellId === cs.localPlayerCellId);
                        if (appData.autoBan) {
                            const banAction = myActions.find((a: any) => a.type === 'ban' && !a.completed && a.isInProgress);
                            if (banAction) {
                                invoke('lcu_request', { method: 'PATCH', endpoint: `/lol-champ-select/v1/session/actions/${banAction.id}`, body: JSON.stringify({ championId: appData.autoBan }) });
                                invoke('lcu_request', { method: 'POST', endpoint: `/lol-champ-select/v1/session/actions/${banAction.id}/complete`, body: null });
                            }
                        }
                        if (appData.autoPick) {
                            const pickAction = myActions.find((a: any) => a.type === 'pick' && !a.completed && a.isInProgress);
                            if (pickAction) {
                                invoke('lcu_request', { method: 'PATCH', endpoint: `/lol-champ-select/v1/session/actions/${pickAction.id}`, body: JSON.stringify({ championId: appData.autoPick }) });
                                invoke('lcu_request', { method: 'POST', endpoint: `/lol-champ-select/v1/session/actions/${pickAction.id}/complete`, body: null });
                            }
                        }
                    }

                    if (cs?.myTeam) {
                        const enrichedTeam = await Promise.all(cs.myTeam.map(async (p: any) => {
                            if (!p.summonerName && p.summonerId) {
                                if (knownNames.current[p.summonerId]) {
                                    p.summonerName = knownNames.current[p.summonerId];
                                } else {
                                    try {
                                        const sumStr = await invoke<string>('lcu_request', { method: 'GET', endpoint: `/lol-summoner/v1/summoners/${p.summonerId}`, body: null });
                                        if (sumStr) {
                                            const sumData = JSON.parse(sumStr);
                                            p.summonerName = `${sumData.gameName}#${sumData.tagLine}`;
                                            knownNames.current[p.summonerId] = p.summonerName;
                                        }
                                    } catch {}
                                }
                            }
                            return p;
                        }));

                        setLobbyMyTeam([...enrichedTeam].sort((a, b) => (a.cellId || 0) - (b.cellId || 0)));
                        setLobbyTheirTeam([...(cs.theirTeam || [])].sort((a, b) => (a.cellId || 0) - (b.cellId || 0)));
                        const me = enrichedTeam.find((p: any) => p.cellId === cs.localPlayerCellId);
                        if (me) setMyChamp(me.championId || me.championPickIntent);
                        
                        if (cs?.chatDetails?.multiUserChatId) {
                            fetchAllyRadar(enrichedTeam, cs.chatDetails.multiUserChatId);
                        }
                    }
                } catch { setLobbyMyTeam([]); setLobbyTheirTeam([]); setLobbyState(null); setMyChamp(0); setRadar([]); scannedLobbyId.current = ''; }
            } else if (lobbyState) {
                setLobbyMyTeam([]); setLobbyTheirTeam([]); setLobbyState(null); setMyChamp(0); setRadar([]); scannedLobbyId.current = '';
            }
        } catch { setSum(null); }
    };

    const loadStatic = async () => {
        try {
            const cStr = await invoke<string>('lcu_request', { method: 'GET', endpoint: '/lol-game-data/assets/v1/champion-summary.json', body: null });
            setChamps(JSON.parse(cStr));
            const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
            const versions = await res.json();
            if (versions[0]) {
                setV(versions[0]);
                const runesRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/fr_FR/runesReforged.json`);
                setRunesData(await runesRes.json());
            }
        } catch { }
    };

    useEffect(() => {
        fastPoll();
        loadStatic();
        const i = setInterval(fastPoll, 1000);
        return () => clearInterval(i);
    }, [sum]);

    const [builds, setBuilds] = useState<RuneBuild[]>([]);

    useEffect(() => {
        const cname = getChampName(forceMockLobby ? 222 : myChamp, champs);
        if (!cname || cname === 'Inconnu') {
            setBuilds([]);
            return;
        }

        const fetchRunes = async () => {
            const me = lobbyMyTeam.find(p => p.cellId === lobbyState?.localPlayerCellId);
            const role = me ? ROLE_TRANSLATE[me.assignedPosition] || 'Non Défini' : 'Non Défini';

            try {
                setBuilds([
                    { name: "Analyse des Datas...", winrate: "...", banrate: "...", primaryStyleId: 0, subStyleId: 0, perkIds: [], shards: [], spells: [] },
                    { name: "Génération Gemini...", winrate: "...", banrate: "...", primaryStyleId: 0, subStyleId: 0, perkIds: [], shards: [], spells: [] },
                ]);

                const res = await invoke<RuneBuild[]>('fetch_dynamic_runes', { championName: cname, role: role });
                if (res && res.length > 0) {
                    setBuilds(res);
                } else {
                    setBuilds([]); // Clear waiting state if no results
                }
            } catch (e) {
                console.error("Runes fetch error", e);
                setBuilds([]);
            }
        };

        if (myChamp > 0 || forceMockLobby) {
            fetchRunes();
        }
    }, [myChamp, champs, forceMockLobby, lobbyMyTeam.length > 0, lobbyState?.localPlayerCellId]);

    const toggleAutoBan = async (id: number) => {
        const d = await invoke<any>('get_app_data');
        if (!d) return;
        d.autoBan = d.autoBan === id ? null : id;
        if (d.autoBan === id && d.autoPick === id) d.autoPick = null;
        await invoke('set_app_data', { data: d });
        setData(d);
    };

    const toggleAutoPick = async (id: number) => {
        const d = await invoke<any>('get_app_data');
        if (!d) return;
        d.autoPick = d.autoPick === id ? null : id;
        if (d.autoPick === id && d.autoBan === id) d.autoBan = null;
        await invoke('set_app_data', { data: d });
        setData(d);
    };

    const handleSecondaryClick = (buildIndex: number, runeId: number, slotIndex: number) => {
        setBuilds(prev => {
            const next = JSON.parse(JSON.stringify(prev));
            const b = next[buildIndex];
            const sTree = runesData.find((t: any) => t.id === b.subStyleId);
            if (!sTree) return prev;

            let secondaryIds = [b.perkIds[4], b.perkIds[5]];
            const getRowOfId = (id: number) => {
                for (let i = 1; i < sTree.slots.length; i++) {
                    if (sTree.slots[i].runes.some((xr: any) => xr.id === id)) return i;
                }
                return -1;
            };

            const clickedRow = slotIndex + 1;
            const row1 = getRowOfId(secondaryIds[0]);
            const row2 = getRowOfId(secondaryIds[1]);

            if (secondaryIds.includes(runeId)) return prev;

            if (clickedRow === row1) secondaryIds[0] = runeId;
            else if (clickedRow === row2) secondaryIds[1] = runeId;
            else { secondaryIds[0] = secondaryIds[1]; secondaryIds[1] = runeId; }

            b.perkIds = [...b.perkIds.slice(0, 4), secondaryIds[0], secondaryIds[1]];
            return next;
        });
    };

    const handleShardClick = (buildIndex: number, rIdx: number, shardId: number) => {
        setBuilds(prev => {
            const next = JSON.parse(JSON.stringify(prev));
            next[buildIndex].shards[rIdx] = shardId;
            return next;
        });
    };

    const doImport = async (build: RuneBuild, index: number) => {
        if (!build || build.primaryStyleId === 0) return;
        setIsImporting(index);
        try {
            await invoke('lcu_request', { method: 'PATCH', endpoint: '/lol-champ-select/v1/session/my-selection', body: JSON.stringify({ spell1Id: build.spells[0], spell2Id: build.spells[1] }) });
            const pagesStr = await invoke<string>('lcu_request', { method: 'GET', endpoint: '/lol-perks/v1/pages', body: null });
            const pages = JSON.parse(pagesStr);
            
            const loaPages = pages.filter((p: any) => p.isEditable && (p.name.includes("LOA:") || p.name === ""));
            for (const lp of loaPages) {
                try {
                    await invoke('lcu_request', { method: 'DELETE', endpoint: `/lol-perks/v1/pages/${lp.id}`, body: null });
                } catch (de) { console.error("Could not delete page", lp.id); }
            }

            await invoke('lcu_request', {
                method: 'POST', endpoint: '/lol-perks/v1/pages', body: JSON.stringify({
                    name: `LOA: ${getChampName(myChamp, champs)}`,
                    primaryStyleId: build.primaryStyleId,
                    subStyleId: build.subStyleId,
                    selectedPerkIds: [...build.perkIds, ...build.shards],
                    current: true
                })
            });
            setTimeout(() => setIsImporting(null), 1500);
        } catch (e) { console.error("Import error", e); setIsImporting(null); }
    };

    return (
        <div className="h-screen w-full flex flex-col font-sans selection:bg-red-500/30 overflow-hidden bg-[#0a0a0c] text-neutral-200" style={{ backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(42,8,8,0.4) 0%, transparent 70%)' }}>
            <Header tab={tab} setTab={setTab} />
            <main className="flex-1 overflow-y-auto flex flex-col relative z-10 w-full">
                {tab === 'lobby' && (
                        <LobbyTab 
                            myChamp={myChamp} forceMockLobby={forceMockLobby} champs={champs} builds={builds} runesData={runesData}
                            lobbyMyTeam={lobbyMyTeam} lobbyTheirTeam={lobbyTheirTeam} lobbyState={lobbyState} radar={radar}
                            isImporting={isImporting} handleSecondaryClick={handleSecondaryClick} handleShardClick={handleShardClick}
                            doImport={doImport} setForceMockLobby={setForceMockLobby}
                        />
                )}
                {tab === 'home' && (
                    <HomeTab 
                        sum={sum} v={v} data={data} toggleAutoBan={toggleAutoBan} toggleAutoPick={toggleAutoPick}
                        champs={champs} searchChamp={searchChamp} setSearchChamp={setSearchChamp}
                    />
                )}
                {tab === 'hist' && <HistoryTab hist={hist} champs={champs} v={v} />}
            </main>
        </div>
    );
}

export default App;
