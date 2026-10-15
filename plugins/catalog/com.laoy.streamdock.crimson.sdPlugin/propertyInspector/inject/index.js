/// <reference path="../utils/common.js" />
/// <reference path="../utils/action.js" />

const $dom = {
    buildIndex: $('#buildIndex')
};

const $propEvent = {
    didReceiveSettings(data) {
        console.log("PI: Received settings data", data);
        if ($settings && $settings.buildIndex) {
            $dom.buildIndex.value = $settings.buildIndex.toString();
        } else {
            $dom.buildIndex.value = "1"; // Fallback to 1
        }
    }
};

$dom.buildIndex.addEventListener('change', function () {
    const val = parseInt(this.value);
    console.log("PI: User changed buildIndex to", val);
    $settings.buildIndex = val;
    $websocket.saveData($settings);
});
