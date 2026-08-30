//
//  content.js
//  Page Search for Safari
//
//  Draws a floating, draggable search bar inside the page itself so the page
//  stays visible while searching, highlights every match and lets the user jump
//  between them either with the arrows or from the list of hits.
//

(function () {
    "use strict";

    // Version, not a boolean: after the extension is updated an old copy of this
    // script may still be alive in a tab, and a plain flag would keep the new
    // one from ever installing itself.
    var VERSION = 2;
    if (window.__pageSearchVersion === VERSION) { return; }
    window.__pageSearchVersion = VERSION;

    var api = (typeof browser !== "undefined") ? browser : chrome;

    var HIGHLIGHT_CLASS = "pgs-highlight";
    var CURRENT_CLASS = "pgs-current";
    var HOST_ID = "__page-search-for-safari__";

    // Safety valve: a very generic keyword on a very long page would otherwise
    // create tens of thousands of elements and freeze the tab.
    var MAX_MATCHES = 2000;
    var SNIPPET_CONTEXT = 34;
    var SEARCH_DELAY = 150;

    var SKIP_TAGS = {
        SCRIPT: true, STYLE: true, NOSCRIPT: true, TEMPLATE: true,
        IFRAME: true, FRAME: true, OBJECT: true, EMBED: true,
        TEXTAREA: true, SELECT: true, OPTION: true, OPTGROUP: true,
        CANVAS: true, VIDEO: true, AUDIO: true, TITLE: true
    };

    // matches[i] is the list of <mark> elements belonging to the i-th match.
    // A single match spans several elements when it crosses a text node border.
    var matches = [];
    var snippets = [];
    var currentIndex = -1;
    var ui = null;
    var searchTimer = null;

    function t(key) {
        try { return api.i18n.getMessage(key) || ""; } catch (e) { return ""; }
    }

    // ------------------------------------------------------------- searching

    // Lower-cases while keeping the string length identical, so that offsets in
    // the lower-cased haystack still point at the right place in the DOM.
    function foldCase(text) {
        var lowered = text.toLowerCase();
        if (lowered.length === text.length) { return lowered; }
        var out = "";
        for (var i = 0; i < text.length; i++) {
            var ch = text[i];
            var lc = ch.toLowerCase();
            out += (lc.length === 1) ? lc : ch;
        }
        return out;
    }

    var visibilityCache = new WeakMap();

    function isVisible(element) {
        if (!element || element === document.documentElement) { return true; }
        var cached = visibilityCache.get(element);
        if (cached !== undefined) { return cached; }

        var visible = true;
        var style = window.getComputedStyle(element);
        if (style) {
            if (style.display === "none" ||
                style.visibility === "hidden" ||
                style.visibility === "collapse" ||
                parseFloat(style.opacity) === 0) {
                visible = false;
            }
        }
        if (visible && element.hasAttribute("hidden")) { visible = false; }
        // getComputedStyle does not inherit an ancestor's display:none, so the
        // whole chain has to be checked. The cache keeps this linear.
        if (visible) { visible = isVisible(element.parentElement); }

        visibilityCache.set(element, visible);
        return visible;
    }

    // The floating bar lives in a shadow root, so the tree walker never sees it.
    function collectTextNodes() {
        var nodes = [];
        var starts = [];
        var pieces = [];
        var total = 0;

        if (!document.body) { return { nodes: nodes, starts: starts, text: "" }; }

        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode: function (node) {
                if (!node.nodeValue || node.nodeValue.length === 0) {
                    return NodeFilter.FILTER_REJECT;
                }
                var parent = node.parentElement;
                if (!parent) { return NodeFilter.FILTER_REJECT; }
                if (SKIP_TAGS[parent.tagName]) { return NodeFilter.FILTER_REJECT; }
                if (!isVisible(parent)) { return NodeFilter.FILTER_REJECT; }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        var node;
        while ((node = walker.nextNode())) {
            nodes.push(node);
            starts.push(total);
            pieces.push(node.nodeValue);
            total += node.nodeValue.length;
        }

        return { nodes: nodes, starts: starts, text: pieces.join("") };
    }

    // Index of the last text node starting at or before `offset`.
    function nodeIndexAt(starts, offset) {
        var low = 0;
        var high = starts.length - 1;
        var found = 0;
        while (low <= high) {
            var mid = (low + high) >> 1;
            if (starts[mid] <= offset) {
                found = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return found;
    }

    // Splits a global [start, end) range into per-text-node segments.
    function segmentsFor(nodes, starts, start, end) {
        var segments = [];
        var i = nodeIndexAt(starts, start);
        while (i < nodes.length && starts[i] < end) {
            var nodeStart = starts[i];
            var nodeEnd = nodeStart + nodes[i].nodeValue.length;
            var from = Math.max(start, nodeStart) - nodeStart;
            var to = Math.min(end, nodeEnd) - nodeStart;
            if (to > from) {
                segments.push({ node: nodes[i], start: from, end: to });
            }
            i++;
        }
        return segments;
    }

    function wrap(segment) {
        var range = document.createRange();
        range.setStart(segment.node, segment.start);
        range.setEnd(segment.node, segment.end);
        var mark = document.createElement("mark");
        mark.className = HIGHLIGHT_CLASS;
        try {
            range.surroundContents(mark);
        } catch (e) {
            return null;
        }
        return mark;
    }

    function collapseSpaces(text) {
        return text.replace(/\s+/g, " ");
    }

    // Only the outer edges are trimmed: the spaces next to the match itself have
    // to survive, otherwise the snippet reads as "iPhonetest page".
    function snippetFor(text, start, end) {
        var from = Math.max(0, start - SNIPPET_CONTEXT);
        var to = Math.min(text.length, end + SNIPPET_CONTEXT);
        var before = collapseSpaces(text.slice(from, start)).replace(/^\s+/, "");
        var after = collapseSpaces(text.slice(end, to)).replace(/\s+$/, "");
        return {
            before: (from > 0 ? "…" : "") + before,
            match: collapseSpaces(text.slice(start, end)),
            after: after + (to < text.length ? "…" : "")
        };
    }

    function clearHighlights() {
        var marks = document.querySelectorAll("mark." + HIGHLIGHT_CLASS);
        var parents = [];
        for (var i = 0; i < marks.length; i++) {
            var mark = marks[i];
            var parent = mark.parentNode;
            if (!parent) { continue; }
            while (mark.firstChild) {
                parent.insertBefore(mark.firstChild, mark);
            }
            parent.removeChild(mark);
            if (parents.indexOf(parent) === -1) { parents.push(parent); }
        }
        // Merge the text nodes that were split apart by the highlighting.
        for (var j = 0; j < parents.length; j++) {
            parents[j].normalize();
        }
        matches = [];
        snippets = [];
        currentIndex = -1;
    }

    function search(query) {
        clearHighlights();
        if (!query) { return; }

        visibilityCache = new WeakMap();

        var collected = collectTextNodes();
        var haystack = foldCase(collected.text);
        var needle = foldCase(query);
        if (needle.length === 0) { return; }

        // Locate every occurrence first; the DOM is only touched afterwards.
        var ranges = [];
        var from = 0;
        while (ranges.length < MAX_MATCHES) {
            var at = haystack.indexOf(needle, from);
            if (at === -1) { break; }
            ranges.push([at, at + needle.length]);
            from = at + needle.length;
        }

        // Highlighting runs backwards: wrapping a segment splits its text node,
        // which would invalidate the offsets of anything that follows.
        var wrapped = [];
        var texts = [];
        for (var i = ranges.length - 1; i >= 0; i--) {
            var segments = segmentsFor(collected.nodes, collected.starts, ranges[i][0], ranges[i][1]);
            var elements = [];
            for (var s = segments.length - 1; s >= 0; s--) {
                var mark = wrap(segments[s]);
                if (mark) { elements.unshift(mark); }
            }
            if (elements.length > 0) {
                wrapped.unshift(elements);
                texts.unshift(snippetFor(collected.text, ranges[i][0], ranges[i][1]));
            }
        }

        matches = wrapped;
        snippets = texts;
        currentIndex = matches.length > 0 ? 0 : -1;
    }

    function applyCurrent(scroll) {
        var previous = document.querySelectorAll("mark." + CURRENT_CLASS);
        for (var i = 0; i < previous.length; i++) {
            previous[i].classList.remove(CURRENT_CLASS);
        }
        if (currentIndex < 0 || currentIndex >= matches.length) { return; }

        var elements = matches[currentIndex];
        for (var j = 0; j < elements.length; j++) {
            elements[j].classList.add(CURRENT_CLASS);
        }
        if (scroll && elements[0]) {
            elements[0].scrollIntoView({ block: "center", inline: "nearest" });
        }
    }

    function goTo(index, scroll) {
        if (matches.length === 0) { return; }
        currentIndex = (index + matches.length) % matches.length;
        applyCurrent(scroll !== false);
        renderCounter();
        markActiveRow();
    }

    // ------------------------------------------------------------------- UI

    var PANEL_CSS = [
        ":host { all: initial; }",
        "* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }",
        ".panel {",
        "  position: fixed; z-index: 2147483647; top: 12px; left: 12px;",
        "  width: min(360px, calc(100vw - 24px));",
        "  border-radius: 14px; overflow: hidden;",
        "  background: #ffffff; color: #1c1c1e;",
        "  box-shadow: 0 6px 28px rgba(0,0,0,0.28);",
        "  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;",
        "  font-size: 15px; line-height: 1.4;",
        "  touch-action: none;",
        "}",
        /* Collapsed: just a magnifier and a chevron to open the search bar. */
        ".panel.collapsed { width: auto; border-radius: 999px; }",
        ".panel.collapsed .body { display: none; }",
        ".bubble { display: none; align-items: center; gap: 2px; padding: 9px 12px 9px 14px;",
        "  cursor: pointer; user-select: none; -webkit-user-select: none; }",
        ".panel.collapsed .bubble { display: flex; }",
        ".bubble svg { fill: none; stroke: currentColor; stroke-width: 2;",
        "  stroke-linecap: round; stroke-linejoin: round; }",
        ".bubble .lens { width: 22px; height: 22px; }",
        ".bubble .chev { width: 16px; height: 16px; opacity: 0.45; }",
        ".row { display: flex; align-items: center; gap: 6px; padding: 8px; }",
        ".grip { flex: 0 0 auto; width: 26px; height: 40px; display: flex; align-items: center;",
        "  justify-content: center; cursor: grab; color: #9c9ca1; }",
        ".grip svg { width: 14px; height: 22px; }",
        "input {",
        "  flex: 1 1 auto; min-width: 0; height: 40px; padding: 0 12px;",
        "  border: none; border-radius: 10px; background: #f2f2f7; color: inherit;",
        "  font: inherit; font-size: 16px; -webkit-appearance: none; appearance: none;",
        "}",
        "input:focus { outline: 2px solid #0a84ff; outline-offset: -1px; }",
        ".nav { display: flex; align-items: center; justify-content: center; gap: 8px;",
        "  padding: 0 8px 8px; }",
        ".counter { min-width: 78px; text-align: center; font-size: 14px;",
        "  font-variant-numeric: tabular-nums; color: #6b6b70; }",
        "button { flex: 0 0 auto; width: 40px; height: 40px; display: flex; align-items: center;",
        "  justify-content: center; padding: 0; border: none; border-radius: 10px;",
        "  background: transparent; color: inherit; cursor: pointer; }",
        "button:active { background: rgba(60,60,67,0.12); }",
        "button:disabled { opacity: 0.3; cursor: default; }",
        "button svg { width: 20px; height: 20px; fill: none; stroke: currentColor;",
        "  stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }",
        "button.toggle[aria-expanded='true'] { background: rgba(10,132,255,0.16); color: #0a84ff; }",
        ".list { display: none; max-height: 44vh; overflow-y: auto;",
        "  border-top: 1px solid rgba(60,60,67,0.18); -webkit-overflow-scrolling: touch; }",
        ".list.open { display: block; }",
        ".hit { display: flex; gap: 10px; width: 100%; padding: 10px 12px; text-align: left;",
        "  border: none; border-radius: 0; height: auto; background: transparent;",
        "  border-bottom: 1px solid rgba(60,60,67,0.10); font: inherit; }",
        ".hit:last-child { border-bottom: none; }",
        ".hit .n { flex: 0 0 auto; min-width: 22px; color: #9c9ca1; font-size: 13px;",
        "  font-variant-numeric: tabular-nums; padding-top: 1px; }",
        ".hit .s { flex: 1 1 auto; font-size: 14px; color: #6b6b70;",
        "  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;",
        "  overflow: hidden; }",
        ".hit .s b { color: #1c1c1e; background: #ffe14d; border-radius: 2px; }",
        ".hit.active { background: rgba(10,132,255,0.12); }",
        ".hit.active .s { color: #1c1c1e; }",
        ".empty { padding: 14px 12px; font-size: 14px; color: #6b6b70; text-align: center; }",
        "@media (prefers-color-scheme: dark) {",
        "  .panel { background: #1c1c1e; color: #f2f2f7; box-shadow: 0 6px 28px rgba(0,0,0,0.6); }",
        "  input { background: #2c2c2e; }",
        "  .counter, .hit .s, .hit .n, .empty { color: #9c9ca1; }",
        "  .hit { border-bottom-color: rgba(235,235,245,0.12); }",
        "  .list { border-top-color: rgba(235,235,245,0.22); }",
        "  .hit .s b { color: #1c1c1e; }",
        "  .hit.active .s { color: #f2f2f7; }",
        "  button:active { background: rgba(235,235,245,0.16); }",
        "}"
    ].join("\n");

    function icon(paths) {
        return "<svg viewBox='0 0 24 24' aria-hidden='true'>" + paths + "</svg>";
    }

    function buildUI() {
        var host = document.createElement("div");
        host.id = HOST_ID;
        var root = host.attachShadow({ mode: "open" });

        var style = document.createElement("style");
        style.textContent = PANEL_CSS;
        root.appendChild(style);

        var panel = document.createElement("div");
        panel.className = "panel collapsed";
        panel.innerHTML =
            "<div class='bubble'>" +
            "  <svg class='lens' viewBox='0 0 24 24' aria-hidden='true'>" +
            "    <circle cx='10.5' cy='10.5' r='6.5'/><path d='M15.5 15.5 L21 21'/></svg>" +
            "  <svg class='chev' viewBox='0 0 24 24' aria-hidden='true'><path d='M8 10 L12 14 L16 10'/></svg>" +
            "</div>" +
            "<div class='body'>" +
            "<div class='row'>" +
            "  <div class='grip' part='grip'>" +
            icon("<circle cx='9' cy='6' r='1.4' fill='currentColor' stroke='none'/>" +
                 "<circle cx='9' cy='12' r='1.4' fill='currentColor' stroke='none'/>" +
                 "<circle cx='9' cy='18' r='1.4' fill='currentColor' stroke='none'/>" +
                 "<circle cx='15' cy='6' r='1.4' fill='currentColor' stroke='none'/>" +
                 "<circle cx='15' cy='12' r='1.4' fill='currentColor' stroke='none'/>" +
                 "<circle cx='15' cy='18' r='1.4' fill='currentColor' stroke='none'/>") +
            "  </div>" +
            "  <input type='search' autocomplete='off' autocorrect='off' autocapitalize='none'" +
            "         spellcheck='false' enterkeyhint='search'>" +
            "  <button class='close' type='button'>" + icon("<path d='M6 6 L18 18 M18 6 L6 18'/>") + "</button>" +
            "</div>" +
            "<div class='nav'>" +
            "  <button class='prev' type='button' disabled>" + icon("<path d='M15 5 L8 12 L15 19'/>") + "</button>" +
            "  <span class='counter'></span>" +
            "  <button class='next' type='button' disabled>" + icon("<path d='M9 5 L16 12 L9 19'/>") + "</button>" +
            "  <button class='toggle' type='button' aria-expanded='false' disabled>" +
            icon("<path d='M4 6h16 M4 12h16 M4 18h10'/>") + "</button>" +
            "</div>" +
            "<div class='list'></div>" +
            "</div>";
        root.appendChild(panel);

        ui = {
            host: host,
            panel: panel,
            bubble: panel.querySelector(".bubble"),
            input: panel.querySelector("input"),
            grip: panel.querySelector(".grip"),
            counter: panel.querySelector(".counter"),
            prev: panel.querySelector(".prev"),
            next: panel.querySelector(".next"),
            toggle: panel.querySelector(".toggle"),
            close: panel.querySelector(".close"),
            list: panel.querySelector(".list")
        };

        ui.input.placeholder = t("searchPlaceholder");
        ui.input.setAttribute("aria-label", t("searchPlaceholder"));
        ui.prev.setAttribute("aria-label", t("previousLabel"));
        ui.next.setAttribute("aria-label", t("nextLabel"));
        ui.close.setAttribute("aria-label", t("closeLabel"));
        ui.toggle.setAttribute("aria-label", t("listLabel"));
        ui.bubble.setAttribute("role", "button");
        ui.bubble.setAttribute("aria-label", t("expandLabel"));
        ui.bubble.title = t("expandLabel");

        wireEvents();
        (document.body || document.documentElement).appendChild(host);
        clampIntoView();
        return ui;
    }

    function wireEvents() {
        ui.input.addEventListener("input", function () {
            if (searchTimer !== null) { clearTimeout(searchTimer); }
            searchTimer = setTimeout(function () {
                searchTimer = null;
                runSearch();
            }, SEARCH_DELAY);
        });

        ui.input.addEventListener("keydown", function (event) {
            if (event.key !== "Enter") { return; }
            event.preventDefault();
            if (searchTimer !== null) {
                clearTimeout(searchTimer);
                searchTimer = null;
                runSearch();
                return;
            }
            goTo(currentIndex + (event.shiftKey ? -1 : 1));
        });

        ui.prev.addEventListener("click", function () { goTo(currentIndex - 1); });
        ui.next.addEventListener("click", function () { goTo(currentIndex + 1); });
        ui.close.addEventListener("click", collapse);

        ui.toggle.addEventListener("click", function () {
            var open = ui.list.classList.toggle("open");
            ui.toggle.setAttribute("aria-expanded", open ? "true" : "false");
            if (open) { scrollActiveRowIntoView(); }
        });

        ui.list.addEventListener("click", function (event) {
            var row = event.target.closest ? event.target.closest(".hit") : null;
            if (!row) { return; }
            goTo(parseInt(row.dataset.index, 10));
        });

        makeDraggable(ui.grip, null);
        // The bubble is both the drag handle and the button that opens the bar,
        // so a tap only counts as a tap when the pointer barely moved.
        makeDraggable(ui.bubble, expand);
        window.addEventListener("resize", clampIntoView);
        if (window.visualViewport) {
            window.visualViewport.addEventListener("resize", clampIntoView);
            window.visualViewport.addEventListener("scroll", clampIntoView);
        }
    }

    var TAP_SLOP = 6;

    // The bar is dragged by its grip so that selecting text in the field still
    // works. `onTap` turns the handle into a button when it was not dragged.
    function makeDraggable(handle, onTap) {
        var dragging = false;
        var moved = false;
        var offsetX = 0;
        var offsetY = 0;
        var startX = 0;
        var startY = 0;

        // The move/up listeners sit on the window: pointer capture is not
        // reliable here, and the finger routinely leaves the small handle.
        function onMove(event) {
            if (!dragging) { return; }
            if (!moved &&
                Math.abs(event.clientX - startX) < TAP_SLOP &&
                Math.abs(event.clientY - startY) < TAP_SLOP) {
                return;
            }
            moved = true;
            moveTo(event.clientX - offsetX, event.clientY - offsetY);
            event.preventDefault();
        }

        function onUp() {
            if (!dragging) { return; }
            dragging = false;
            window.removeEventListener("pointermove", onMove, true);
            window.removeEventListener("pointerup", onUp, true);
            window.removeEventListener("pointercancel", onUp, true);
            if (!moved && onTap) { onTap(); }
        }

        handle.addEventListener("pointerdown", function (event) {
            dragging = true;
            moved = false;
            var rect = ui.panel.getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            startX = event.clientX;
            startY = event.clientY;
            window.addEventListener("pointermove", onMove, true);
            window.addEventListener("pointerup", onUp, true);
            window.addEventListener("pointercancel", onUp, true);
            event.preventDefault();
        });
    }

    function moveTo(left, top) {
        var rect = ui.panel.getBoundingClientRect();
        var viewport = window.visualViewport;
        var width = viewport ? viewport.width : window.innerWidth;
        var height = viewport ? viewport.height : window.innerHeight;
        var minTop = viewport ? viewport.offsetTop : 0;
        var minLeft = viewport ? viewport.offsetLeft : 0;

        var maxLeft = minLeft + width - rect.width - 8;
        var maxTop = minTop + height - rect.height - 8;

        ui.panel.style.left = Math.max(minLeft + 8, Math.min(left, maxLeft)) + "px";
        ui.panel.style.top = Math.max(minTop + 8, Math.min(top, maxTop)) + "px";
    }

    // Keeps the bar reachable when the keyboard opens or the page is zoomed.
    function clampIntoView() {
        if (!ui) { return; }
        var rect = ui.panel.getBoundingClientRect();
        moveTo(rect.left, rect.top);
    }

    function renderCounter() {
        var count = matches.length;
        if (!ui.input.value) {
            ui.counter.textContent = "";
        } else if (count === 0) {
            ui.counter.textContent = t("noResults");
        } else {
            ui.counter.textContent = (currentIndex + 1) + " / " + count;
        }
        ui.prev.disabled = count === 0;
        ui.next.disabled = count === 0;
        ui.toggle.disabled = count === 0;
        if (count === 0) {
            ui.list.classList.remove("open");
            ui.toggle.setAttribute("aria-expanded", "false");
        }
    }

    function renderList() {
        ui.list.textContent = "";
        if (matches.length === 0) { return; }

        var fragment = document.createDocumentFragment();
        for (var i = 0; i < snippets.length; i++) {
            var row = document.createElement("button");
            row.type = "button";
            row.className = "hit";
            row.dataset.index = String(i);

            var number = document.createElement("span");
            number.className = "n";
            number.textContent = String(i + 1);

            var snippet = document.createElement("span");
            snippet.className = "s";
            // textContent everywhere: page text must never be parsed as markup.
            snippet.appendChild(document.createTextNode(snippets[i].before));
            var strong = document.createElement("b");
            strong.textContent = snippets[i].match;
            snippet.appendChild(strong);
            snippet.appendChild(document.createTextNode(snippets[i].after));

            row.appendChild(number);
            row.appendChild(snippet);
            fragment.appendChild(row);
        }
        ui.list.appendChild(fragment);
        markActiveRow();
    }

    function markActiveRow() {
        var rows = ui.list.querySelectorAll(".hit");
        for (var i = 0; i < rows.length; i++) {
            rows[i].classList.toggle("active", i === currentIndex);
        }
        scrollActiveRowIntoView();
    }

    function scrollActiveRowIntoView() {
        if (!ui.list.classList.contains("open")) { return; }
        var active = ui.list.querySelector(".hit.active");
        if (active) { active.scrollIntoView({ block: "nearest" }); }
    }

    function runSearch() {
        search(ui.input.value);
        applyCurrent(true);
        renderCounter();
        renderList();
    }

    function expand() {
        ui.panel.classList.remove("collapsed");
        clampIntoView();
        ui.input.focus();
        ui.input.select();
    }

    // Folds the bar back into the magnifier bubble and ends the search.
    function collapse() {
        if (searchTimer !== null) { clearTimeout(searchTimer); searchTimer = null; }
        clearHighlights();
        ui.input.value = "";
        ui.input.blur();
        ui.list.textContent = "";
        ui.list.classList.remove("open");
        ui.toggle.setAttribute("aria-expanded", "false");
        renderCounter();
        ui.panel.classList.add("collapsed");
        clampIntoView();
    }

    function showUI() {
        if (!ui) {
            buildUI();
            return;
        }
        ui.host.style.display = "";
        clampIntoView();
    }

    function hideUI() {
        if (!ui) { return; }
        collapse();
        ui.host.style.display = "none";
    }

    function isVisiblePanel() {
        return ui !== null && ui.host.style.display !== "none";
    }

    // --------------------------------------------------------------- messages

    api.runtime.onMessage.addListener(function (message, sender, sendResponse) {
        if (!message || !message.type) { return false; }

        switch (message.type) {
            case "toggle":
                if (isVisiblePanel()) { hideUI(); } else { showUI(); }
                sendResponse({ open: isVisiblePanel() });
                break;
            case "open":
                showUI();
                sendResponse({ open: true });
                break;
            case "close":
                hideUI();
                sendResponse({ open: false });
                break;
            default:
                sendResponse(null);
                break;
        }
        return false;
    });
}());
