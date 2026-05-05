import { useEffect, useMemo, useState } from 'react'
import { BarChart2, Bell, Briefcase, ChevronLeft, ChevronRight, HelpCircle, Star, X } from 'lucide-react'
import { useApp } from '../contexts/AppContext'
import type { Page } from '../types'

function getWelcomeKey(email: string) {
  return `oa_welcome_seen_${email.trim().toLowerCase()}`
}

export default function FirstLoginHelpModal() {
  const { user, navigate, userDataLoaded, needsAdvisoryAcknowledgement } = useApp()
  const [open, setOpen] = useState(false)
  const [currentStep, setCurrentStep] = useState(0)
  const storageKey = useMemo(() => user?.email ? getWelcomeKey(user.email) : null, [user?.email])

  const steps: Array<{
    icon: JSX.Element
    title: string
    body: string
    action: string
    page: Page
  }> = [
    {
      icon: <BarChart2 size={22} />,
      title: 'Start with Option Trade',
      body: 'Enter a ticker to see market signals, option chain data, scored recommendations, and entry or exit guidance.',
      action: 'Analyze a ticker',
      page: 'ticker',
    },
    {
      icon: <Star size={22} />,
      title: 'Create your watchlist',
      body: 'Add tickers you want to follow. OptionAdvisor refreshes watched tickers and uses cached data for alerts.',
      action: 'Open Watchlist',
      page: 'watchlist',
    },
    {
      icon: <Bell size={22} />,
      title: 'Review GO alerts',
      body: 'The Alerts page shows trades that pass the pre-trade checklist. Email alerts can be enabled with SendGrid or SMTP in server settings.',
      action: 'View Alerts',
      page: 'alerts',
    },
    {
      icon: <Briefcase size={22} />,
      title: 'Track portfolio positions',
      body: 'Save recommendations to Portfolio so you can track open positions, strategy, expiry, contracts, and close status.',
      action: 'Open Portfolio',
      page: 'portfolio',
    },
    {
      icon: <HelpCircle size={22} />,
      title: 'Learn the trading logic',
      body: 'The Help page explains strategy selection, scoring, filters, and what makes a trade pass or fail.',
      action: 'Open Help',
      page: 'help',
    },
  ]

  const step = steps[currentStep]
  const isLastStep = currentStep === steps.length - 1

  useEffect(() => {
    if (!storageKey || !userDataLoaded || needsAdvisoryAcknowledgement) return
    try {
      setOpen(localStorage.getItem(storageKey) !== 'true')
      setCurrentStep(0)
    } catch {
      setOpen(false)
    }
  }, [storageKey, userDataLoaded, needsAdvisoryAcknowledgement])

  const close = () => {
    if (storageKey) {
      try { localStorage.setItem(storageKey, 'true') } catch {}
    }
    setOpen(false)
  }

  const openPage = (page: Page) => {
    close()
    navigate(page)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-950/75 px-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl">
        <div className="flex items-start justify-between border-b border-gray-800 px-6 py-5">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-violet-700/50 bg-violet-950/50 px-3 py-1 text-xs font-semibold text-violet-300">
              <HelpCircle size={14} />
              Interactive quick start
            </div>
            <h2 className="text-xl font-bold text-white">Welcome to OptionAdvisor</h2>
            <p className="mt-1 text-sm text-gray-400">
              Step {currentStep + 1} of {steps.length}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200"
            aria-label="Close welcome message"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-6">
          <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-6 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-900/70 text-violet-300">
              {step.icon}
            </div>
            <h3 className="text-lg font-bold text-gray-100">{step.title}</h3>
            <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-gray-400">{step.body}</p>
            <button
              type="button"
              onClick={() => openPage(step.page)}
              className="mt-5 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
            >
              {step.action}
            </button>
          </div>

          <div className="mt-5 flex justify-center gap-2">
            {steps.map((item, index) => (
              <button
                key={item.title}
                type="button"
                onClick={() => setCurrentStep(index)}
                className={`h-2.5 rounded-full transition-all ${
                  index === currentStep ? 'w-8 bg-violet-400' : 'w-2.5 bg-gray-700 hover:bg-gray-600'
                }`}
                aria-label={`Show step ${index + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-gray-800 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={close}
            className="text-sm font-semibold text-gray-500 transition-colors hover:text-gray-300"
          >
            Skip tour
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setCurrentStep(step => Math.max(0, step - 1))}
              disabled={currentStep === 0}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={16} />
              Back
            </button>
            <button
              type="button"
              onClick={() => isLastStep ? close() : setCurrentStep(step => Math.min(steps.length - 1, step + 1))}
              className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
            >
              {isLastStep ? 'Finish' : 'Next'}
              {!isLastStep && <ChevronRight size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
