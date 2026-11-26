import type { hu } from './hu.ts'

export const en: typeof hu = {
  common: {
    next: 'Next',
    back: 'Back',
    privacyNote: 'Your voice stays on your own server.',
  },
  field: {
    email: 'Email',
    password: 'Password',
    error: {
      email: 'Enter a valid email.',
      passwordShort: 'Use at least 8 characters.',
      passwordMismatch: "The passwords don't match.",
      code: 'Enter the setup code.',
    },
  },
  error: {
    generic: 'Something went wrong. Try again.',
    notFound: 'Page not found.',
    invalid_setup_code: 'Wrong setup code.',
    invalid_time_zone: 'Unknown time zone.',
  },
  setup: {
    step: 'Step {{n}} of 3',
    account: {
      title: 'Welcome to Nightjar',
      lead: "Create the first account. You'll also use it to manage the server.",
      passwordAgain: 'Password again',
      code: 'Setup code',
      codeHint: 'Find the code in the server log: <code>docker compose logs nightjar</code>',
    },
    lang: {
      title: 'Language and time zone',
      lead: 'You can change these any time in Settings.',
      uiLanguage: 'Interface language',
      timeZone: 'Time zone',
      tzHint: 'Picked from your browser. Entry days are counted in this time zone.',
    },
    transcription: {
      title: 'Turn recordings into text?',
      lead: 'Transcription runs on your own server. Nothing goes out to the internet.',
      later: 'Not now',
      laterHint:
        "You can listen to recordings, but they won't have text. Turn it on any time in Settings.",
      on: 'Turn on transcription',
      onHint:
        'Hungarian and English recordings become text. Needs a one-time download of about {{size}}, which starts after setup.',
    },
    finish: 'Finish',
    finishAndDownload: 'Finish and start download',
  },
  login: {
    title: 'Welcome back.',
    lead: 'Sign in to your journal.',
    submit: 'Sign in',
    error: {
      invalid: 'Wrong email or password. Check them and try again.',
      tooMany: 'Too many attempts. Wait a minute and try again.',
    },
  },
  auth: {
    logout: 'Sign out',
  },
  nav: {
    main: 'Main navigation',
    today: 'Today',
    settings: 'Settings',
  },
  settings: {
    title: 'Settings',
    personal: 'Personal',
    account: 'Account',
    uiLanguage: 'App language',
    entryLanguage: 'Default language for recordings',
    entryLanguageHint: 'You can change it per entry.',
    auto: 'Automatic',
    timeZone: 'Time zone',
    saveFailed: "Couldn't save the setting.",
  },
}
