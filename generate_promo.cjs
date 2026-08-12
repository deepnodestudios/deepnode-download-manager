const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    frame: false,
    show: false,
    webPreferences: { nodeIntegration: true }
  });

  const iconBase64 = fs.readFileSync(path.join(__dirname, 'electron', 'icon.png')).toString('base64');
  const html = `
    <html>
      <body style="margin:0; padding:0; background: linear-gradient(135deg, #1e1e2f, #2a2a40); color: white; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; font-family: 'Segoe UI', sans-serif;">
        <div style="background: rgba(255,255,255,0.05); padding: 60px; border-radius: 30px; display: flex; flex-direction: column; align-items: center; box-shadow: 0 20px 50px rgba(0,0,0,0.3);">
            <img src="data:image/png;base64,${iconBase64}" style="width: 200px; height: 200px; border-radius: 40px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);" />
            <h1 style="font-size: 56px; margin-top: 40px; margin-bottom: 10px; font-weight: bold; letter-spacing: 1px;">DeepNode Download Manager</h1>
            <p style="font-size: 26px; color: #a0a0b0; margin: 0;">Official Browser Integration</p>
        </div>
      </body>
    </html>
  `;

  
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  
  setTimeout(async () => {
    // Need to strictly enforce 1280x800 capture.
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1280, height: 800 });
    fs.writeFileSync('promo-1280x800.png', image.toPNG());
    console.log('Saved promo-1280x800.png');
    app.quit();
  }, 1000);
});
