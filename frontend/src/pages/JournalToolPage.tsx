/**
 * EOD Trade Journal — embeds the self-contained Day/Swing trade journal tool
 * (public/trade-journal.html). The tool ships its own header, sidebar, and
 * dark theme, so this page is a full-height frame with no extra chrome.
 * Same-origin iframe: the tool reads the app's bearer token from localStorage
 * to load the user's My Tickers watchlist and live prices from the backend.
 */
export default function JournalToolPage() {
  return (
    <div className="h-[calc(100svh-3rem)] min-h-[600px]">
      <iframe
        src="/trade-journal.html"
        title="EOD Trade Journal"
        className="block h-full w-full border-0"
      />
    </div>
  )
}
