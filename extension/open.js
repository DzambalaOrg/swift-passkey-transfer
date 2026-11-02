// Opens only the bundled remainder page. No background balances/signing/submission.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('remainder.html') });
});
