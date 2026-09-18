// レビュー依頼バナー（popup内）。価格比較リンク for Safari の型の横展開。
// 使い方:
//   - 価値の瞬間（開始操作など）で reviewRecordUse() を呼ぶ
//   - popupのi18n読み込み後に reviewMaybeShow(t) を呼ぶ（tは翻訳関数）
//   - popup.htmlに <div id="reviewRequest"></div> を置く
const REVIEW_REQUEST_CONFIG = {
    appStoreId: '6798515519',
    minUseCount: 15,          // 最小使用回数（開始操作の累計）
    minDaysFromFirstUse: 30,  // 初回使用から最低日数
    minDaysFromLastRequest: 90, // 前回依頼からの最低日数
    snoozeDays: 30            // 「また今度」の抑制期間
};

const REVIEW_APP_STORE_URL =
    'https://apps.apple.com/app/id' + REVIEW_REQUEST_CONFIG.appStoreId + '?action=write-review';

async function reviewGetData() {
    try {
        const result = await browser.storage.local.get('reviewData');
        return result.reviewData || {
            useCount: 0,
            firstUseDate: null,
            lastRequestDate: null,
            snoozeUntil: null
        };
    } catch (e) {
        return { useCount: 0, firstUseDate: null, lastRequestDate: null, snoozeUntil: null };
    }
}

async function reviewSaveData(data) {
    try {
        await browser.storage.local.set({ reviewData: data });
    } catch (e) {}
}

// 価値の瞬間に呼ぶ。使用回数を加算し、初回使用日を記録する。
async function reviewRecordUse() {
    const data = await reviewGetData();
    data.useCount = (data.useCount || 0) + 1;
    if (!data.firstUseDate) data.firstUseDate = Date.now();
    await reviewSaveData(data);
}

async function reviewShouldShow() {
    const data = await reviewGetData();
    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;

    if ((data.useCount || 0) < REVIEW_REQUEST_CONFIG.minUseCount) return false;
    if (!data.firstUseDate) return false;
    if ((now - data.firstUseDate) / dayInMs < REVIEW_REQUEST_CONFIG.minDaysFromFirstUse) return false;
    if (data.lastRequestDate &&
        (now - data.lastRequestDate) / dayInMs < REVIEW_REQUEST_CONFIG.minDaysFromLastRequest) return false;
    if (data.snoozeUntil && now < data.snoozeUntil) return false;
    return true;
}

// 条件を満たす場合のみpopup内にレビュー依頼バナーを表示する。
// t: i18n翻訳関数（reviewPromptText / reviewWrite / reviewLater を解決できること）
async function reviewMaybeShow(t) {
    const container = document.getElementById('reviewRequest');
    if (!container) return;
    if (!(await reviewShouldShow())) return;

    const data = await reviewGetData();
    data.lastRequestDate = Date.now();
    await reviewSaveData(data);

    const box = document.createElement('div');
    box.style.cssText = [
        'margin-top: 12px',
        'padding: 12px',
        'background: linear-gradient(135deg, #fff9e6 0%, #fff3cc 100%)',
        'border: 1px solid #f0d78c',
        'border-radius: 8px',
        'font-size: 12px',
        'line-height: 1.5',
        'color: #333'
    ].join(';');

    const text = document.createElement('div');
    text.textContent = '🙏 ' + (t('reviewPromptText') || 'Thank you for using this extension!');
    text.style.marginBottom = '8px';
    box.appendChild(text);

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap;';

    const writeBtn = document.createElement('button');
    writeBtn.textContent = '⭐ ' + (t('reviewWrite') || 'Write a review');
    writeBtn.style.cssText =
        'background: #ff9500; color: #fff; border: none; padding: 6px 12px;' +
        'border-radius: 6px; font-size: 12px; font-weight: bold; cursor: pointer;';
    writeBtn.addEventListener('click', () => {
        try {
            browser.tabs.create({ url: REVIEW_APP_STORE_URL });
        } catch (e) {
            window.open(REVIEW_APP_STORE_URL, '_blank');
        }
        box.remove();
        window.close();
    });
    buttons.appendChild(writeBtn);

    const laterBtn = document.createElement('button');
    laterBtn.textContent = t('reviewLater') || 'Not now';
    laterBtn.style.cssText =
        'background: #e0e0e0; color: #666; border: none; padding: 6px 12px;' +
        'border-radius: 6px; font-size: 12px; cursor: pointer;';
    laterBtn.addEventListener('click', async () => {
        const d = await reviewGetData();
        d.snoozeUntil = Date.now() + REVIEW_REQUEST_CONFIG.snoozeDays * 24 * 60 * 60 * 1000;
        await reviewSaveData(d);
        box.remove();
    });
    buttons.appendChild(laterBtn);

    box.appendChild(buttons);
    container.appendChild(box);
}
