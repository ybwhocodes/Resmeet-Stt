const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("resmeetDesktop", {
  isDesktop: true,
  platform: process.platform,
  version: "1.0.0",
});
