import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { readPrefs } from "../prefs";
import { enUS, zhCN } from "./catalog";

const prefs = readPrefs();

void i18n.use(initReactI18next).init({
  resources: {
    "zh-CN": { translation: zhCN },
    "en-US": { translation: enUS },
  },
  lng: prefs.locale,
  fallbackLng: "en-US",
  supportedLngs: ["zh-CN", "en-US"],
  keySeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});

export { i18n };
