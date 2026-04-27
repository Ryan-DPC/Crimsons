export interface Summoner {
    puuid: string;
    accountId: number;
    displayName: string;
    gameName?: string;
    profileIconId: number;
    summonerLevel: number;
}

export interface MatchStats {
    kills: number;
    deaths: number;
    assists: number;
    win: boolean;
}

export interface Match {
    gameId: string;
    gameCreation: number;
    championId: number;
    stats: MatchStats;
    gameQueueId: number;
    gameDuration: number;
}

export interface CounterSuggestion {
    name: string;
    keystoneId: number;
}

export interface RuneBuild {
    name: string;
    winrate: string;
    banrate: string;
    primaryStyleId: number;
    subStyleId: number;
    perkIds: number[];
    shards: number[];
    spells: number[];
    counters?: CounterSuggestion[];
}

export interface RadarResult {
    puuid: string;
    winrate: number | null;
    games: number;
    isTilt: boolean;
    isSmurf: boolean;
    isTroll: boolean;
    lastResults: boolean[];
}
