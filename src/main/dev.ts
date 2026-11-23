import { app } from "electron";

export const devFeatures = () => !app.isPackaged || process.env.HYAN_DEV === "1";
