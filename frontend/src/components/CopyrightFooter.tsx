const ZETAYU_LINKEDIN = 'https://www.linkedin.com/company/112456281/'

export default function CopyrightFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-gray-800/50 px-4 py-4 text-center text-xs text-gray-600" role="contentinfo">
      <span className="text-gray-500">OptionAdvisor</span>
      <span> by </span>
      <a
        href={ZETAYU_LINKEDIN}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-gray-500 underline underline-offset-2 hover:text-gray-300"
      >
        Zetayu LLC
      </a>
      <span>. © {year} Zetayu LLC. All rights reserved.</span>
    </footer>
  )
}
