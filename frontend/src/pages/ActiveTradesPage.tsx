import ActiveTradesPanel from '../components/ActiveTradesPanel'

export default function ActiveTradesPage() {
  return (
    <div className="active-trades-page mx-auto w-full max-w-2xl space-y-6 px-4 py-6 sm:px-6 pb-24">
      <ActiveTradesPanel variant="page" />
    </div>
  )
}
