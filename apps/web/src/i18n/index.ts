import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from './en.ts'
import { hu } from './hu.ts'

export const browserLanguage = () =>
  navigator.language.toLowerCase().startsWith('hu') ? 'hu' : 'en'

await i18n.use(initReactI18next).init({
  resources: { hu: { translation: hu }, en: { translation: en } },
  lng: browserLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})

i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language
})
document.documentElement.lang = i18n.language
