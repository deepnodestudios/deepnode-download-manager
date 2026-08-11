chrome.downloads.onDeterminingFilename.addListener((item, suggest) => { (async () => { await new Promise(r => setTimeout(r, 1000)); suggest(); })(); return true; });
