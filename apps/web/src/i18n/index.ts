import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from './en.ts'
import { hu } from './hu.ts'

await i18n.use(initReactI18next).init({
  resources: { hu: { translation: hu }, en: { translation: en } },
  lng: navigator.language.toLowerCase().startsWith('en') ? 'en' : 'hu',
  fallbackLng: 'hu',
  interpolation: { escapeValue: false },
})
