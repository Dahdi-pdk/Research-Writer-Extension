// Membuka Workspace saat ikon ekstensi diklik. Jika Workspace sudah terbuka,
// tab itu yang diaktifkan (tidak membuat tab duplikat).
const WORKSPACE_URL = chrome.runtime.getURL('src/workspace/index.html');

chrome.action.onClicked.addListener(async () => {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['TAB'],
      documentUrls: [WORKSPACE_URL]
    });
    if (contexts.length > 0) {
      const ctx = contexts[0];
      await chrome.tabs.update(ctx.tabId, { active: true });
      await chrome.windows.update(ctx.windowId, { focused: true });
      return;
    }
  } catch (err) {
    console.warn('ResearchWriter: gagal mencari tab Workspace, membuat tab baru.', err);
  }
  await chrome.tabs.create({ url: WORKSPACE_URL });
});
