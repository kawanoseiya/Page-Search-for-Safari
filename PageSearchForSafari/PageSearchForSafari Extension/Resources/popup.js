//
//  popup.js
//  Page Search for Safari
//
//  The search UI itself lives in the page, so that the page stays visible while
//  searching. This popup only toggles that bar and gets out of the way.
//

(function () {
    "use strict";

    var api = (typeof browser !== "undefined") ? browser : chrome;
    var status = document.getElementById("status");

    function message(key) {
        try { return api.i18n.getMessage(key) || ""; } catch (e) { return ""; }
    }

    // Shown inside the popup sheet: without it a missing website permission or a
    // page Safari refuses to inject into just looks like "nothing happened".
    function fail(error) {
        status.textContent = message("unavailable");
        var detail = document.createElement("small");
        detail.textContent = error ? String(error.message || error) : "";
        status.appendChild(document.createElement("br"));
        status.appendChild(detail);
    }

    api.tabs.query({ active: true, currentWindow: true }).then(function (tabs) {
        if (!tabs || tabs.length === 0) { throw new Error("no active tab"); }
        var tabId = tabs[0].id;

        function toggle() {
            return api.tabs.sendMessage(tabId, { type: "toggle" });
        }

        function inject() {
            return api.scripting.insertCSS({ target: { tabId: tabId }, files: ["content.css"] })
                .then(function () {
                    return api.scripting.executeScript({ target: { tabId: tabId }, files: ["content.js"] });
                })
                .then(toggle);
        }

        // Two cases need the script injected by hand: tabs that were already open
        // when the extension was enabled (sendMessage rejects), and tabs still
        // running a content script from a previous version of the extension,
        // which answers the message without understanding it.
        return toggle().then(function (response) {
            if (response && typeof response.open === "boolean") { return response; }
            return inject();
        }, inject);
    }).then(function () {
        window.close();
    }).catch(fail);
}());
