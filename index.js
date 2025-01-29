const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const express = require('express');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const os = require('os');
const net = require('net'); // Shto këtë import në fillim të skedarit tuaj

let mainWindow;
let server;
const expressApp = express();

// Funksioni për krijimin e dritares
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true, // Aktivizon Node.js në procesin e renderimit
      contextIsolation: false, // Çaktivizon izolimin për të përdorur `require` direkt
      enableRemoteModule: true, // Opsionale: përdoret për module të vjetra
    },
     });
  // mainWindow.webContents.on('did-finish-load', () => {
  //   mainWindow.webContents.openDevTools();
  // });
    mainWindow.loadFile('index.html');
}
console.log('Main process is running');

// Merr IP-në lokale të kompjuterit
function getLocalIPAddress() {
  const networkInterfaces = os.networkInterfaces();
  for (const interfaceName in networkInterfaces) {
    for (const iface of networkInterfaces[interfaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        console.log('arsen c')
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const ipAddress = getLocalIPAddress();

// End-point për shkarkimin e folderit në format ZIP
expressApp.get('/download', (req, res) => {
  const folderPath = req.query.folder;
  const folderName = path.basename(folderPath);
  const zipPath = path.join(app.getPath('userData'), `${folderName}.zip`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  const output = fs.createWriteStream(zipPath);

  output.on('close', async () => {
    try {
      res.download(zipPath, `${folderName}.zip`, async () => {
        try {
          await fs.promises.unlink(zipPath);
        } catch (err) {
          console.error('Error deleting ZIP:', err);
        }
      });

      // Dërgo një ngjarje për të treguar që transferimi ka mbaruar
      mainWindow.webContents.send('transfer-complete', 'Transferimi u krye me sukses!');
    } catch (err) {
      console.error('Error during file download:', err);
      res.status(500).send('Error downloading file');
    }
  });

  archive.on('progress', (progress) => {
    if (progress.entries && progress.entries.total) {
      mainWindow.webContents.send('zip-progress', progress.entries.total);
    }
  });

  archive.pipe(output);
  archive.directory(folderPath, false);
  archive.finalize();
});

const getAvailablePort = async (startingPort = 4040) => {
  let port = startingPort;
  while (true) {
    const isPortOpen = await isPortInUse(port);
    if (!isPortOpen) {
      // console.log(port,'=-=>> port open')
      return port;
    }
    port++;
  }
};
const isPortInUse = (port) => {
  return new Promise((resolve) => {
    const server = net.createServer().listen(port, () => {
      server.close();
      resolve(false); // Porti është i lirë
    });
    server.on('error', () => resolve(true)); // Porti është i zënë
  });
};
// Logjika për zgjedhjen e folderit dhe krijimin e QR kodit
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });

  if (!result.canceled) {
    const folderPath = result.filePaths[0];
    const folderName = folderPath.split('/').pop();  // Merr emrin e folderit

    // Kërko një port të lirë dhe starto serverin
    if (!server) {
      const availablePort = await getAvailablePort();
      server = expressApp.listen(availablePort, () => console.log(`Server running on port ${availablePort}`));
    }

    // Gjenero URL dhe QR kod
    const localURL = `http://${ipAddress}:${server.address().port}/download?folder=${encodeURIComponent(folderPath)}`;
    const qrCodeData = await qrcode.toDataURL(localURL);

    return { qrCodeData, folderName };  // Dërgo QR kodin dhe emrin e folderit
  }

  return null;
});

// Krijo dritaren kur aplikacioni është gati
app.whenReady().then(() => {
  console.log('App is ready!'); // Ky log do të shfaqet përpara krijimit të dritares
  createWindow();
});console.log('App is ready!')

// Dërgo ndodhinë për mbylljen e aplikacionit kur dritaret mbyllen
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
