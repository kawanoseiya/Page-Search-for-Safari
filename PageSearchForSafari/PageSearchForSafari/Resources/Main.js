//
//  Main.js
//  Page Search for Safari
//
//  Bridges the guide page to the host app.
//

document.getElementById("open-settings").addEventListener("click", function () {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.controller) {
        window.webkit.messageHandlers.controller.postMessage("open-settings");
    }
});
