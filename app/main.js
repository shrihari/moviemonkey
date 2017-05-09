const electron = require('electron')
// Module to control application life.
const app = electron.app
// Module to create native browser window.
const BrowserWindow = electron.BrowserWindow
const Menu = electron.Menu
const ipcMain = electron.ipcMain
const dialog = electron.dialog

const path = require('path')
const url = require('url')

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow

function createWindow () {
  // Create the browser window.
  // , titleBarStyle: 'hidden-inset'
  mainWindow = new BrowserWindow({title: "Movie Monkey", titleBarStyle: 'hidden-inset', show: false})
  
  // and load the index.html of the app.
  mainWindow.loadURL(url.format({
    pathname: path.join(__dirname, 'index.html'),
    protocol: 'file:',
    slashes: true
  }))

  mainWindow.maximize()

  // Create the Application's main menu
  var menuTemplate = [{
      label: app.getName(),
      submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "quit" }
      ]}, {
      label: "File",
      submenu: [
          { label: "Import Movies", click: importMovies },
          { type: "separator" },
          { label: "Unidentified Movies", click: createUnWindow }
      ]}, {
      label: "Edit",
      submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectall" }
      ]}, {
      label: 'View',
      submenu: [
        {role: 'reload'},
        {role: 'forcereload'},
        {role: 'toggledevtools'},
        {type: 'separator'},
        {role: 'resetzoom'},
        {role: 'zoomin'},
        {role: 'zoomout'},
        {type: 'separator'},
        {role: 'togglefullscreen'}
      ]}, {
        role: 'window',
        submenu: [
          {role: 'minimize'},
          {role: 'close'}
        ]
      }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  // Open the DevTools.
  // mainWindow.webContents.openDevTools()
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })


  // Emitted when the window is closed.
  mainWindow.on('closed', function () {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null
  })
}

function createUnWindow() {
  let unWindow = new BrowserWindow({title: "Movie Monkey - Unidentified Files"});

  unWindow.loadURL(url.format({
    pathname: path.join(app.getAppPath(), 'unidentified.html'),
    protocol: 'file:',
    slashes: true
  }));

  unWindow.once('ready-to-show', () => {
    unWindow.show()
  });
}

function importMovies() {
  dialog.showOpenDialog({properties: ['openFile', 'openDirectory', 'multiSelections']}, function(filePaths) {
    mainWindow.webContents.send('import-movies', filePaths)
  });
}

ipcMain.on('open-unwindow', (event, arg) => {
  createUnWindow();
})

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow)

// Quit when all windows are closed.
app.on('window-all-closed', function () {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', function () {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
