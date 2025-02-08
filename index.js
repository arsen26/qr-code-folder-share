const { app, BrowserWindow, ipcMain, dialog,screen  } = require('electron');
const express = require('express');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const os = require('os');
const net = require('net'); // Shto këtë import në fillim të skedarit tuaj

let mainWindow;
let server;
let selectedPort = null;
const expressApp = express();
app.commandLine.appendSwitch('disable-features', 'AutofillServerCommunication, AutofillEnablePayments');

// Funksioni për krijimin e dritares
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
  });
  mainWindow.loadFile('index.html');
  return mainWindow;
}
console.log('Main process is running');

// Funksioni për krijimin e dritares të dytë (për mini monitor)
function createSecondaryWindow(qrCodeData) {
  const displays = screen.getAllDisplays();
  const secondaryDisplay = displays.length > 1 ? displays[1] : displays[0]; // Përdorim ekranin e dytë nëse ekziston
  console.log(displays[1],'=-=>> displays[1]')

  const secondaryWindow = new BrowserWindow({
    width: 500,
    height: 300,
    x: secondaryDisplay.bounds.x + 100, // Vendosni përmasat dhe pozicionin në ekranin e dytë
    y: secondaryDisplay.bounds.y + 100,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true,
    },
  });

  return secondaryWindow;
}

// Merr IP-në lokale të kompjuterit
function getLocalIPAddress() {
  const networkInterfaces = os.networkInterfaces();
  for (const interfaceName in networkInterfaces) {
    for (const iface of networkInterfaces[interfaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const ipAddress = getLocalIPAddress();

// End-point për shkarkimin e folderit në format ZIP
// End-point për shkarkimin e folderit në format ZIP ose skedarët individualë
expressApp.get('/download', async (req, res) => {
  const folderPath = req.query.folder;
  const isZip = req.query.zip === 'true';

  if (!folderPath || !fs.existsSync(folderPath)) {
    return res.status(400).send('Folder not found.');
  }

  if (isZip) {
    const folderName = path.basename(folderPath);
    res.attachment(`${folderName}.zip`);
    const archive = archiver('zip', { zlib: { level: 2 } });

    const files = fs.readdirSync(folderPath);
    let totalSize = 0;
    
    files.forEach(file => {
      const filePath = path.join(folderPath, file);
      const stats = fs.statSync(filePath);

      if (stats.isFile()) {
        totalSize += stats.size;
        archive.file(filePath, {
          name: file,
          stats: stats // Ruajtja e metadata (timestamps)
        });
      }
    });

    archive.on('progress', (data) => {
      mainWindow.webContents.send('download-complete', '');
      let progress = (data.fs.processedBytes / totalSize) * 100;
      console.log(`Progress: ${progress.toFixed(2)}%`);
      mainWindow.webContents.send('download-progress', progress.toFixed(2));
    });

    archive.on('progress', (data) => {
      secondaryWindow.webContents.send('download-complete', '');
      let progress = (data.fs.processedBytes / totalSize) * 100;
      console.log(`Progress: ${progress.toFixed(2)}%`);
      secondaryWindow.webContents.send('download-progress', progress.toFixed(2));
    });

    archive.on('end', () => {
      console.log('Transferimi u krye me sukses!');
      mainWindow.webContents.send('download-complete', 'Transferimi u krye me sukses!');
      secondaryWindow.webContents.send('download-complete', 'Transferimi u krye me sukses!');

    });

    archive.pipe(res);
    await archive.finalize();
  }
});

const getAvailablePort = async (startingPort = 4040) => {
  if (selectedPort) return selectedPort; // Përdor portin ekzistues
  let port = startingPort;
  while (true) {
    const isPortOpen = await isPortInUse(port);
    if (!isPortOpen) {
      selectedPort = port;
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
// Logjika për zgjedhjen e folderit dhe krijimin e QR kodit
let secondaryWindow = null; // Mbajmë referencën e dritares së dytë

ipcMain.handle('select-folder', async () => {
  mainWindow.webContents.send('download-complete', '');
  mainWindow.webContents.send('download-progress', 0);
  mainWindow.webContents.send('transfer-message-clear');

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });

  if (!result.canceled) {
    const folderPath = result.filePaths[0];
    const folderName = folderPath.split('/').pop();
    const folderNameDisplay = path.basename(folderPath);

    if (!server) {
      const availablePort = await getAvailablePort();
      server = expressApp.listen(availablePort, () => console.log(`Server running on port ${availablePort}`));
    }

    // URL për shkarkimin e folderit ZIP për Android
    const urlZip = `http://${ipAddress}:${selectedPort}/download?folder=${encodeURIComponent(folderPath)}&zip=true`;

    // URL për shkarkimin e skedarëve individuale për iPhone
    const urlFolder = `http://${ipAddress}:${selectedPort}/download?folder=${encodeURIComponent(folderPath)}&zip=true`;

    // Generimi i QR kodeve për të dyja opsionet
    const qrCodeZip = await qrcode.toDataURL(urlZip);
    const qrCodeFolder = await qrcode.toDataURL(urlFolder);

    // Shfaq QR kodin në dritaren kryesore
    mainWindow.webContents.send('show-qr-code', qrCodeZip);

    // Mbyll dritaren e vjetër nëse ekziston
    if (secondaryWindow) {
      secondaryWindow.close();
      secondaryWindow = null;
    }

    // Funksioni për krijimin e dritares të dytë (për mini monitor)
    const displays = screen.getAllDisplays();
    const secondaryDisplay = displays.length > 1 ? displays[0] : displays[1]; // Përdorim ekranin e dytë nëse ekziston

    secondaryWindow = new BrowserWindow({
      width: 700,
      height: 870,
      x: secondaryDisplay.bounds.x + 100, // Vendosni përmasat dhe pozicionin në ekranin e dytë
      y: secondaryDisplay.bounds.y + 100,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true,
      },
    });

    secondaryWindow.loadFile('display.html');

    secondaryWindow.webContents.once('did-finish-load', () => {
      secondaryWindow.webContents.send('update-qr-codes', { 
        android: qrCodeZip,
        iphone: qrCodeFolder,
        folderName: folderNameDisplay
      });
    });

    return [
      { title: 'Android ZIP', qrCode: qrCodeZip }, // QR kodi për shkarkimin e ZIP
      { title: 'iPhone Jo ZIP', qrCode: qrCodeFolder }, // QR kodi për shkarkimin e skedarëve individualë
      {folderName: folderNameDisplay}
    ];
  }

  return null;
});



// Krijo dritaren kur aplikacioni është gati
app.whenReady().then(() => {
  mainWindow = createWindow();
});

// Dërgo ndodhinë për mbylljen e aplikacionit kur dritaret mbyllen
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
