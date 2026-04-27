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
        5005: "StatMods/StatModsAttackSpeedIcon.png",
        5008: "StatMods/StatModsAdaptiveForceIcon.png",
        5007: "StatMods/StatModsCDRScalingIcon.png",
        5002: "StatMods/StatModsArmorIcon.png",
        5003: "StatMods/StatModsMagicResIcon.png",
        5001: "StatMods/StatModsHealthScalingIcon.png",
        5011: "StatMods/StatModsHealthPlusIcon.png",
        5013: "StatMods/StatModsTenacityIcon.png",
        5010: "StatMods/StatModsMovementSpeedIcon.png"
    };
    return map[id] ? `https://ddragon.leagueoflegends.com/cdn/img/perk-images/${map[id]}` : '';
};
