import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { ApiError, meQuery, setupStatusQuery } from './api.ts'
import { Shell } from './components/shell.tsx'
import { EntryPage } from './routes/entry.tsx'
import { HomePage } from './routes/home.tsx'
import { LoginPage } from './routes/login.tsx'
import { RecorderPage } from './routes/recorder.tsx'
import { SettingsPage } from './routes/settings.tsx'
import { SetupPage } from './routes/setup.tsx'
import { TimelinePage } from './routes/timeline.tsx'
import { UploadPage } from './routes/upload.tsx'
import { WriterPage } from './routes/writer.tsx'
import { ErrorNotice } from './components/error-notice.tsx'

function RequireAuth() {
  const { i18n } = useTranslation()
  const location = useLocation()
  const me = useQuery(meQuery)

  useEffect(() => {
    if (me.data) void i18n.changeLanguage(me.data.uiLanguage)
  }, [me.data, i18n])

  if (me.isPending) return null
  if (me.error instanceof ApiError && me.error.status === 401) {
    return <Navigate to="/login" replace state={{ next: location.pathname + location.search }} />
  }
  if (me.isError) return <ErrorNotice bare />
  return <Shell />
}

export function App() {
  const { t } = useTranslation()
  const setup = useQuery(setupStatusQuery)

  if (setup.isPending) return null
  if (setup.isError) return <ErrorNotice bare />

  if (setup.data.needed) {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/setup" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<HomePage />} />
        <Route path="timeline" element={<TimelinePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="write" element={<WriterPage />} />
        <Route path="record" element={<RecorderPage />} />
        <Route path="upload" element={<UploadPage />} />
        <Route path="entries/:id" element={<EntryPage />} />
        <Route path="entries/:id/edit" element={<WriterPage />} />
        <Route path="*" element={<h1 className="title">{t('error.notFound')}</h1>} />
      </Route>
    </Routes>
  )
}
