/**
 * Journal Workbench — embeds the self-contained Day/Swing trade journal tool
 * (public/trade-journal.html). The tool ships its own header, sidebar, and
 * dark theme, so this page is a full-height frame with no extra chrome.
 */
export default function JournalToolPage() {
  return (
    <div className="h-[calc(100svh-3rem)] min-h-[600px]">
      <iframe
        src="/trade-journal.html"
        title="Journal Workbench"
        className="block h-full w-full border-0"
      />
    </div>
  )
}
