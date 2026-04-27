export const getChampArt = (id: number, champs: any[]) => {
    if (!id || id <= 0) return '';
    const c = champs.find(x => x.id === id);
    return c ? `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${c.alias}_0.jpg` : '';
};

export const getChampIcon = (id: number, champs: any[], v: string) => {
    if (!id || id <= 0) return 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/0.jpg';
    const c = champs.find(x => x.id === id);
    return c ? `https://ddragon.leagueoflegends.com/cdn/${v}/img/champion/${c.alias}.png` : '';
};

export const getChampName = (id: number, champs: any[]) => {
    if (!id || id <= 0) return '';
    const c = champs.find(x => x.id === id);
    return c ? c.name : 'Inconnu';
};

export const getShardIcon = (id: number) => {
    const map: any = {
        5005: "statmodsadaptivespeedicon.png",
        5008: "statmodsadaptiveforceicon.png",
        5007: "statmodscdrscalingicon.png",
        5002: "statmodsarmoricon.png",
        5003: "statmodsmagicresicon.png",
        5001: "statmodshealthscalingicon.png",
        5011: "statmodshealthplusicon.png",
        5013: "statmodstenacityicon.png",
        5010: "statmodsmovementspeedicon.png"
    };
    // Use CommunityDragon for more reliable shard icons
    return map[id] ? `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/statmods/${map[id]}` : '';
};
